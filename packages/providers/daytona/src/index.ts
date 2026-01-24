import { Daytona } from "@daytonaio/sdk";
import type {
  CreateSandboxFromImageParams,
  CreateSandboxFromSnapshotParams,
  DaytonaConfig,
  Sandbox as DaytonaSandboxClient,
} from "@daytonaio/sdk";
import { ServiceUrlError, TcpProxyError } from "@usbx/core";
import type {
  CreateOptions,
  ExecOptions,
  ExecResult,
  ExecStream,
  GetServiceUrlOptions,
  GetTcpProxyOptions,
  Sandbox,
  SandboxId,
  SandboxProvider,
  ServiceUrl,
  TcpProxyInfo,
} from "@usbx/core";

export type DaytonaServiceUrlOptions = {
  preferSignedUrl?: boolean;
};

export type DaytonaProviderOptions = {
  client?: Daytona;
  config?: DaytonaConfig;
  createParams?: CreateSandboxFromImageParams | CreateSandboxFromSnapshotParams;
  createOptions?: {
    timeout?: number;
    onSnapshotCreateLogs?: (chunk: string) => void;
  };
} & DaytonaServiceUrlOptions;

type DaytonaExecOptions = never;

type DaytonaCreateParams = CreateSandboxFromImageParams | CreateSandboxFromSnapshotParams;

const escapeShellArg = (value: string): string => {
  if (/^[a-zA-Z0-9_./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
};

const buildCommand = (command: string, args: string[]): string =>
  [command, ...args].map(escapeShellArg).join(" ");

const buildShellCommand = (
  command: string,
  args: string[],
  options?: ExecOptions<DaytonaExecOptions>,
): string => {
  const baseCommand = buildCommand(command, args);
  const envEntries = options?.env ? Object.entries(options.env) : [];
  const envPrefix =
    envEntries.length > 0
      ? `env ${envEntries.map(([key, value]) => `${key}=${escapeShellArg(value)}`).join(" ")} `
      : "";
  const commandWithEnv = `${envPrefix}${baseCommand}`;

  const commandWithStdin =
    options?.stdin !== undefined
      ? `printf '%s' '${stdinToBase64(options.stdin)}' | base64 -d | ${commandWithEnv}`
      : commandWithEnv;

  if (options?.cwd) {
    return `cd ${escapeShellArg(options.cwd)} && ${commandWithStdin}`;
  }

  return commandWithStdin;
};

const stdinToBase64 = (stdin: string | Uint8Array): string =>
  (typeof stdin === "string" ? Buffer.from(stdin, "utf8") : Buffer.from(stdin)).toString("base64");

const createTextStream = () => {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  const readable = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });

  const enqueue = (chunk: string) => {
    if (!controller) {
      return;
    }
    controller.enqueue(encoder.encode(chunk));
  };

  const close = () => {
    controller?.close();
  };

  const error = (err: unknown) => {
    controller?.error(err);
  };

  return {
    readable,
    enqueue,
    close,
    error,
  };
};

export class DaytonaProvider implements SandboxProvider<
  DaytonaSandboxClient,
  Daytona,
  DaytonaExecOptions
> {
  private client: Daytona;
  private createParams?: CreateSandboxFromImageParams | CreateSandboxFromSnapshotParams;
  private createOptions?: DaytonaProviderOptions["createOptions"];
  private preferSignedUrl: boolean;

  native: Daytona;

  constructor(options: DaytonaProviderOptions = {}) {
    this.client = options.client ?? new Daytona(options.config);
    this.native = this.client;
    if (options.createParams !== undefined) {
      this.createParams = options.createParams;
    }
    if (options.createOptions !== undefined) {
      this.createOptions = options.createOptions;
    }
    this.preferSignedUrl = options.preferSignedUrl ?? false;
  }

  async create(
    options?: CreateOptions,
  ): Promise<Sandbox<DaytonaSandboxClient, DaytonaExecOptions>> {
    let createParams: DaytonaCreateParams | undefined = this.createParams
      ? { ...this.createParams }
      : undefined;
    if (options?.name) {
      createParams = createParams
        ? { ...createParams, name: options.name }
        : { name: options.name };
    }

    const sandbox = await this.client.create(createParams, this.createOptions);
    return new DaytonaSandbox(sandbox, this.preferSignedUrl);
  }

  async get(idOrName: string): Promise<Sandbox<DaytonaSandboxClient, DaytonaExecOptions>> {
    const sandbox = await this.client.get(idOrName);
    return new DaytonaSandbox(sandbox, this.preferSignedUrl);
  }

  async delete(idOrName: string): Promise<void> {
    const sandbox = await this.client.get(idOrName);
    await this.client.delete(sandbox);
  }
}

class DaytonaSandbox implements Sandbox<DaytonaSandboxClient, DaytonaExecOptions> {
  id: SandboxId;
  name?: string;
  native: DaytonaSandboxClient;

  private sandbox: DaytonaSandboxClient;
  private preferSignedUrl: boolean;
  private serviceUrlCache = new Map<number, ServiceUrl>();

  constructor(sandbox: DaytonaSandboxClient, preferSignedUrl: boolean) {
    this.id = sandbox.id;
    this.name = sandbox.name;
    this.sandbox = sandbox;
    this.preferSignedUrl = preferSignedUrl;
    this.native = sandbox;
  }

  async exec(
    command: string,
    args: string[] = [],
    options?: ExecOptions<DaytonaExecOptions>,
  ): Promise<ExecResult> {
    if (options?.stdin !== undefined) {
      throw new Error("DaytonaProvider.exec does not support stdin.");
    }

    const commandString = buildCommand(command, args);
    const result = await this.sandbox.process.executeCommand(
      commandString,
      options?.cwd,
      options?.env,
      options?.timeoutSeconds,
    );

    return {
      stdout: result.artifacts?.stdout ?? result.result ?? "",
      stderr: "",
      exitCode: result.exitCode ?? null,
    };
  }

  async execStream(
    command: string,
    args: string[] = [],
    options?: ExecOptions<DaytonaExecOptions>,
  ): Promise<ExecStream> {
    const stdoutStream = createTextStream();
    const stderrStream = createTextStream();

    const sessionId = `usbx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await this.sandbox.process.createSession(sessionId);

    const commandString = buildShellCommand(command, args, options);
    const response = await this.sandbox.process.executeSessionCommand(
      sessionId,
      {
        command: commandString,
        runAsync: true,
      },
      options?.timeoutSeconds,
    );

    if (!response.cmdId) {
      await this.sandbox.process.deleteSession(sessionId);
      throw new Error("DaytonaProvider.execStream did not return a command id.");
    }

    const logsPromise = this.sandbox.process.getSessionCommandLogs(
      sessionId,
      response.cmdId,
      (chunk) => stdoutStream.enqueue(chunk),
      (chunk) => stderrStream.enqueue(chunk),
    );

    logsPromise
      .then(() => {
        stdoutStream.close();
        stderrStream.close();
      })
      .catch((error) => {
        stdoutStream.error(error);
        stderrStream.error(error);
      });

    const exitCode = logsPromise
      .then(async () => {
        const commandInfo = await this.sandbox.process.getSessionCommand(sessionId, response.cmdId);
        return commandInfo.exitCode ?? null;
      })
      .finally(async () => {
        try {
          await this.sandbox.process.deleteSession(sessionId);
        } catch {
          // Best-effort cleanup.
        }
      });

    return {
      stdout: stdoutStream.readable,
      stderr: stderrStream.readable,
      exitCode,
    };
  }

  async getServiceUrl(options: GetServiceUrlOptions): Promise<ServiceUrl> {
    const resolvedVisibility = options.visibility ?? (this.sandbox.public ? "public" : "private");
    const cached = this.serviceUrlCache.get(options.port);
    if (cached && cached.visibility === resolvedVisibility) {
      return cached;
    }

    if (resolvedVisibility === "private" && this.sandbox.public) {
      throw new ServiceUrlError(
        "visibility_mismatch",
        'Requested "private" URL, but the sandbox is public. Create a private sandbox or use a signed preview URL if supported.',
      );
    }
    if (resolvedVisibility === "public" && !this.sandbox.public) {
      throw new ServiceUrlError(
        "visibility_mismatch",
        'Requested "public" URL, but the sandbox is private. Create a public sandbox or request a private URL.',
      );
    }

    const previewInfo = await this.sandbox.getPreviewLink(options.port);
    let result: ServiceUrl;

    if (resolvedVisibility === "public") {
      result = {
        url: previewInfo.url,
        visibility: "public",
      };
    } else if (this.preferSignedUrl) {
      const signedPreview = await this.sandbox.getSignedPreviewUrl(options.port);
      result = {
        url: signedPreview.url,
        visibility: "private",
      };
    } else {
      result = {
        url: previewInfo.url,
        headers: { "x-daytona-preview-token": previewInfo.token },
        visibility: "private",
      };
    }

    this.serviceUrlCache.set(options.port, result);
    return result;
  }

  async getTcpProxy(options: GetTcpProxyOptions): Promise<TcpProxyInfo> {
    const resolvedVisibility = options.visibility ?? (this.sandbox.public ? "public" : "private");

    if (resolvedVisibility === "private" && this.sandbox.public) {
      throw new TcpProxyError(
        "visibility_mismatch",
        'Requested "private" TCP proxy, but the sandbox is public. Create a private sandbox or use a signed preview URL if supported.',
      );
    }
    if (resolvedVisibility === "public" && !this.sandbox.public) {
      throw new TcpProxyError(
        "visibility_mismatch",
        'Requested "public" TCP proxy, but the sandbox is private. Create a public sandbox or request a private proxy.',
      );
    }

    await this.ensureTcpProxyRunning(options.port, options.timeoutSeconds);

    if (resolvedVisibility === "public") {
      const previewInfo = await this.sandbox.getPreviewLink(TCP_PROXY_PORT);
      return {
        url: previewInfo.url.replace(/^https:\/\//, "wss://"),
        visibility: "public",
        protocol: "sprites-tcp-proxy-v1",
        init: {
          hostDefault: "localhost",
          requiresHost: false,
        },
      };
    }

    if (this.preferSignedUrl) {
      const signedPreview = await this.sandbox.getSignedPreviewUrl(TCP_PROXY_PORT);
      return {
        url: signedPreview.url.replace(/^https:\/\//, "wss://"),
        visibility: "private",
        protocol: "sprites-tcp-proxy-v1",
        init: {
          hostDefault: "localhost",
          requiresHost: false,
        },
      };
    }

    const previewInfo = await this.sandbox.getPreviewLink(TCP_PROXY_PORT);
    return {
      url: previewInfo.url.replace(/^https:\/\//, "wss://"),
      headers: { "x-daytona-preview-token": previewInfo.token },
      visibility: "private",
      protocol: "sprites-tcp-proxy-v1",
      init: {
        hostDefault: "localhost",
        requiresHost: false,
      },
    };
  }

  private async ensureTcpProxyRunning(targetPort: number, timeoutSeconds?: number): Promise<void> {
    const listening = await this.checkPortListening(TCP_PROXY_PORT);
    if (listening) {
      return;
    }

    const startResult = await this.exec("sh", [
      "-c",
      buildProxyStartScript(TCP_PROXY_PORT, targetPort),
    ]);
    if (startResult.exitCode === 3) {
      throw new TcpProxyError(
        "unsupported",
        "TCP proxy requires Node.js to be available inside the sandbox.",
      );
    }
    if (startResult.exitCode !== 0) {
      throw new TcpProxyError("proxy_start_failed", "Failed to start TCP proxy.");
    }

    await this.waitForPortListening(TCP_PROXY_PORT, timeoutSeconds);
  }

  private async checkPortListening(port: number): Promise<boolean> {
    const script = buildPortCheckScript(port, 0);
    const result = await this.exec("sh", ["-c", script]);
    return result.exitCode === 0;
  }

  private async waitForPortListening(port: number, timeoutSeconds?: number): Promise<void> {
    const retries = timeoutSeconds ? Math.max(0, Math.ceil(timeoutSeconds)) : 5;
    const script = buildPortCheckScript(port, retries);
    const result = await this.exec("sh", ["-c", script]);
    if (result.exitCode === 0) {
      return;
    }
    throw new TcpProxyError(
      "proxy_unavailable",
      `TCP proxy port ${port} is not listening inside the sandbox.`,
    );
  }
}

const TCP_PROXY_PORT = 9000;

const TCP_PROXY_SCRIPT = [
  "const http = require('http');",
  "const crypto = require('crypto');",
  "const net = require('net');",
  "const PORT = Number(process.env.US_BX_TCP_PROXY_PORT || '9000');",
  "const TARGET_PORT = process.env.US_BX_TCP_PROXY_TARGET_PORT ? Number(process.env.US_BX_TCP_PROXY_TARGET_PORT) : null;",
  "const INIT_TIMEOUT_MS = 5000;",
  "const MAX_INIT_BYTES = 4096;",
  "const server = http.createServer();",
  "const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';",
  "const sendFrame = (socket, opcode, payload) => {",
  "  const length = payload.length;",
  "  let header;",
  "  if (length < 126) {",
  "    header = Buffer.alloc(2);",
  "    header[1] = length;",
  "  } else if (length < 65536) {",
  "    header = Buffer.alloc(4);",
  "    header[1] = 126;",
  "    header.writeUInt16BE(length, 2);",
  "  } else {",
  "    header = Buffer.alloc(10);",
  "    header[1] = 127;",
  "    header.writeBigUInt64BE(BigInt(length), 2);",
  "  }",
  "  header[0] = 0x80 | (opcode & 0x0f);",
  "  socket.write(Buffer.concat([header, payload]));",
  "};",
  "const parseFrames = (buffer) => {",
  "  const frames = [];",
  "  let offset = 0;",
  "  while (offset + 2 <= buffer.length) {",
  "    const byte1 = buffer[offset];",
  "    const byte2 = buffer[offset + 1];",
  "    const fin = (byte1 & 0x80) !== 0;",
  "    const opcode = byte1 & 0x0f;",
  "    const masked = (byte2 & 0x80) !== 0;",
  "    let length = byte2 & 0x7f;",
  "    let headerSize = 2;",
  "    if (length === 126) {",
  "      if (offset + 4 > buffer.length) break;",
  "      length = buffer.readUInt16BE(offset + 2);",
  "      headerSize = 4;",
  "    } else if (length === 127) {",
  "      if (offset + 10 > buffer.length) break;",
  "      const value = buffer.readBigUInt64BE(offset + 2);",
  "      if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Frame too large');",
  "      length = Number(value);",
  "      headerSize = 10;",
  "    }",
  "    const maskOffset = offset + headerSize;",
  "    const dataOffset = maskOffset + (masked ? 4 : 0);",
  "    const frameEnd = dataOffset + length;",
  "    if (frameEnd > buffer.length) break;",
  "    let payload = buffer.subarray(dataOffset, frameEnd);",
  "    if (masked) {",
  "      const mask = buffer.subarray(maskOffset, maskOffset + 4);",
  "      const unmasked = Buffer.alloc(payload.length);",
  "      for (let i = 0; i < payload.length; i += 1) {",
  "        unmasked[i] = payload[i] ^ mask[i % 4];",
  "      }",
  "      payload = unmasked;",
  "    }",
  "    frames.push({ fin, opcode, payload });",
  "    offset = frameEnd;",
  "  }",
  "  return { frames, remaining: buffer.subarray(offset) };",
  "};",
  "server.on('upgrade', (req, socket) => {",
  "  const key = req.headers['sec-websocket-key'];",
  "  if (typeof key !== 'string') {",
  "    socket.end('HTTP/1.1 400 Bad Request\\r\\n\\r\\n');",
  "    return;",
  "  }",
  "  const accept = crypto.createHash('sha1').update(key + MAGIC).digest('base64');",
  "  const response = [",
  "    'HTTP/1.1 101 Switching Protocols',",
  "    'Upgrade: websocket',",
  "    'Connection: Upgrade',",
  "    'Sec-WebSocket-Accept: ' + accept,",
  "    '\\r\\n',",
  "  ].join('\\r\\n');",
  "  socket.write(response);",
  "  socket.setNoDelay(true);",
  "  let buffer = Buffer.alloc(0);",
  "  let initialized = false;",
  "  let tcp = null;",
  "  const initTimer = setTimeout(() => {",
  "    socket.end();",
  "    if (tcp) tcp.destroy();",
  "  }, INIT_TIMEOUT_MS);",
  "  const close = () => {",
  "    clearTimeout(initTimer);",
  "    if (tcp) tcp.destroy();",
  "    socket.end();",
  "  };",
  "  socket.on('data', (chunk) => {",
  "    buffer = Buffer.concat([buffer, chunk]);",
  "    let parsed;",
  "    try {",
  "      parsed = parseFrames(buffer);",
  "    } catch {",
  "      close();",
  "      return;",
  "    }",
  "    buffer = parsed.remaining;",
  "    for (const frame of parsed.frames) {",
  "      if (!frame.fin) {",
  "        close();",
  "        return;",
  "      }",
  "      if (frame.opcode === 0x8) {",
  "        close();",
  "        return;",
  "      }",
  "      if (frame.opcode === 0x9) {",
  "        sendFrame(socket, 0xA, frame.payload);",
  "        continue;",
  "      }",
  "      if (!initialized) {",
  "        if (frame.opcode !== 0x1 || frame.payload.length > MAX_INIT_BYTES) {",
  "          close();",
  "          return;",
  "        }",
  "        let init;",
  "        try {",
  "          init = JSON.parse(frame.payload.toString('utf8'));",
  "        } catch {",
  "          close();",
  "          return;",
  "        }",
  "        const host = typeof init.host === 'string' ? init.host : 'localhost';",
  "        const port = init.port;",
  "        if (!Number.isInteger(port) || port < 1 || port > 65535) {",
  "          close();",
  "          return;",
  "        }",
  "        if (TARGET_PORT && port !== TARGET_PORT) {",
  "          close();",
  "          return;",
  "        }",
  "        if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {",
  "          close();",
  "          return;",
  "        }",
  "        tcp = net.createConnection({ host, port });",
  "        tcp.on('connect', () => {",
  "          initialized = true;",
  "          clearTimeout(initTimer);",
  "          sendFrame(socket, 0x1, Buffer.from(JSON.stringify({ status: 'connected', target: host + ':' + port })));",
  "        });",
  "        tcp.on('data', (data) => sendFrame(socket, 0x2, data));",
  "        tcp.on('error', close);",
  "        tcp.on('close', close);",
  "        continue;",
  "      }",
  "      if (frame.opcode === 0x2 && tcp) {",
  "        tcp.write(frame.payload);",
  "      }",
  "    }",
  "  });",
  "  socket.on('close', close);",
  "  socket.on('error', close);",
  "});",
  "server.listen(PORT, '0.0.0.0');",
].join("\n");

const buildProxyStartScript = (proxyPort: number, targetPort: number): string => {
  const scriptPath = "/tmp/usbx-tcp-proxy.js";
  return [
    "if ! command -v node >/dev/null 2>&1; then",
    "  exit 3",
    "fi",
    `cat <<'US_BX_TCP_PROXY' > ${scriptPath}`,
    TCP_PROXY_SCRIPT,
    "US_BX_TCP_PROXY",
    "if command -v nohup >/dev/null 2>&1; then",
    `  US_BX_TCP_PROXY_PORT=${proxyPort} US_BX_TCP_PROXY_TARGET_PORT=${targetPort} nohup node ${scriptPath} >/tmp/usbx-tcp-proxy.log 2>&1 &`,
    "else",
    `  US_BX_TCP_PROXY_PORT=${proxyPort} US_BX_TCP_PROXY_TARGET_PORT=${targetPort} node ${scriptPath} >/tmp/usbx-tcp-proxy.log 2>&1 &`,
    "fi",
  ].join("\n");
};

const buildPortCheckScript = (port: number, retries: number): string => `
check_port() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :${port}" | awk 'NR>1 {found=1} END {exit found?0:1}'
    return $?
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -nPiTCP:${port} -sTCP:LISTEN -t >/dev/null 2>&1
    return $?
  fi
  if command -v node >/dev/null 2>&1; then
    node -e "const net=require('net');const socket=net.connect(${port},'127.0.0.1');socket.on('connect',()=>{socket.end();process.exit(0);});socket.on('error',()=>process.exit(1));"
    return $?
  fi
  return 2
}

i=0
while [ $i -le ${retries} ]; do
  check_port
  rc=$?
  if [ $rc -eq 0 ]; then
    exit 0
  fi
  if [ $rc -eq 2 ]; then
    exit 2
  fi
  i=$((i+1))
  if [ $i -le ${retries} ]; then
    sleep 1
  fi
done
exit 1
`;
