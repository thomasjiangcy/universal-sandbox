import { Sandbox as E2BSandboxClient } from "e2b";
import type { CommandStartOpts, SandboxConnectOpts, SandboxOpts } from "e2b";
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

export type E2BServiceUrlOptions = {
  allowPublicTraffic?: boolean;
};

export type E2BProviderOptions = {
  template?: string;
  createOptions?: SandboxOpts;
  connectOptions?: SandboxConnectOpts;
} & E2BServiceUrlOptions;

export type E2BExecOptions = Omit<
  CommandStartOpts,
  "background" | "cwd" | "envs" | "timeoutMs" | "stdin"
>;

const escapeShellArg = (value: string): string => {
  if (/^[a-zA-Z0-9_./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
};

const buildCommand = (command: string, args: string[]): string =>
  [command, ...args].map(escapeShellArg).join(" ");

const buildCommandWithStdin = (
  command: string,
  args: string[],
  stdin: string | Uint8Array,
): string => {
  const baseCommand = buildCommand(command, args);
  const payload = typeof stdin === "string" ? Buffer.from(stdin, "utf8") : Buffer.from(stdin);
  const base64 = payload.toString("base64");

  return `printf '%s' '${base64}' | base64 -d | ${baseCommand}`;
};

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

export class E2BProvider implements SandboxProvider<
  E2BSandboxClient,
  typeof E2BSandboxClient,
  E2BExecOptions
> {
  private template?: string;
  private createOptions?: SandboxOpts;
  private connectOptions?: SandboxConnectOpts;
  private allowPublicTraffic?: boolean;

  native: typeof E2BSandboxClient;

  constructor(options: E2BProviderOptions = {}) {
    if (options.template !== undefined) {
      this.template = options.template;
    }
    if (options.createOptions !== undefined) {
      this.createOptions = options.createOptions;
    }
    if (options.connectOptions !== undefined) {
      this.connectOptions = options.connectOptions;
    }
    if (options.allowPublicTraffic !== undefined) {
      this.allowPublicTraffic = options.allowPublicTraffic;
    }
    this.native = E2BSandboxClient;
  }

  async create(options?: CreateOptions): Promise<Sandbox<E2BSandboxClient, E2BExecOptions>> {
    let createOptions = this.createOptions ? { ...this.createOptions } : undefined;
    if (this.allowPublicTraffic !== undefined) {
      const network = createOptions?.network
        ? { ...createOptions.network, allowPublicTraffic: this.allowPublicTraffic }
        : { allowPublicTraffic: this.allowPublicTraffic };
      createOptions = createOptions ? { ...createOptions, network } : { network };
    }
    if (options?.name) {
      const metadata = createOptions?.metadata
        ? { ...createOptions.metadata, name: options.name }
        : { name: options.name };
      createOptions = createOptions ? { ...createOptions, metadata } : { metadata };
    }

    let sandbox: E2BSandboxClient;
    if (this.template) {
      sandbox =
        createOptions === undefined
          ? await E2BSandboxClient.create(this.template)
          : await E2BSandboxClient.create(this.template, createOptions);
    } else if (createOptions) {
      sandbox = await E2BSandboxClient.create(createOptions);
    } else {
      sandbox = await E2BSandboxClient.create();
    }

    return new E2BSandbox(sandbox, options?.name, this.allowPublicTraffic);
  }

  async get(idOrName: string): Promise<Sandbox<E2BSandboxClient, E2BExecOptions>> {
    const sandbox = await E2BSandboxClient.connect(idOrName, this.connectOptions);
    return new E2BSandbox(sandbox);
  }

  async delete(idOrName: string): Promise<void> {
    const sandbox = await E2BSandboxClient.connect(idOrName, this.connectOptions);
    await sandbox.kill();
  }
}

class E2BSandbox implements Sandbox<E2BSandboxClient, E2BExecOptions> {
  id: SandboxId;
  name?: string;
  native: E2BSandboxClient;

  private sandbox: E2BSandboxClient;
  private allowPublicTraffic?: boolean;
  private serviceUrlCache = new Map<number, ServiceUrl>();

  constructor(sandbox: E2BSandboxClient, name?: string, allowPublicTraffic?: boolean) {
    this.id = sandbox.sandboxId;
    if (name) {
      this.name = name;
    }
    this.sandbox = sandbox;
    if (allowPublicTraffic !== undefined) {
      this.allowPublicTraffic = allowPublicTraffic;
    }
    this.native = sandbox;
  }

  async exec(
    command: string,
    args: string[] = [],
    options?: ExecOptions<E2BExecOptions>,
  ): Promise<ExecResult> {
    if (options?.stdin !== undefined) {
      throw new Error("E2BProvider.exec does not support stdin; use native for streaming.");
    }

    const commandString = buildCommand(command, args);
    const providerOptions: CommandStartOpts & { background: false } = {
      ...options?.providerOptions,
      background: false,
    };

    if (options?.cwd !== undefined) {
      providerOptions.cwd = options.cwd;
    }
    if (options?.env !== undefined) {
      providerOptions.envs = options.env;
    }
    if (options?.timeoutSeconds !== undefined) {
      providerOptions.timeoutMs = options.timeoutSeconds * 1000;
    }

    const result = await this.sandbox.commands.run(commandString, providerOptions);

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  async execStream(
    command: string,
    args: string[] = [],
    options?: ExecOptions<E2BExecOptions>,
  ): Promise<ExecStream> {
    const providerOnStdout = options?.providerOptions?.onStdout;
    const providerOnStderr = options?.providerOptions?.onStderr;

    const stdoutStream = createTextStream();
    const stderrStream = createTextStream();

    const commandString =
      options?.stdin !== undefined
        ? buildCommandWithStdin(command, args, options.stdin)
        : buildCommand(command, args);

    const providerOptions: CommandStartOpts & { background: false } = {
      ...options?.providerOptions,
      background: false,
      onStdout: (data) => {
        stdoutStream.enqueue(data);
        if (providerOnStdout) {
          void providerOnStdout(data);
        }
      },
      onStderr: (data) => {
        stderrStream.enqueue(data);
        if (providerOnStderr) {
          void providerOnStderr(data);
        }
      },
    };

    if (options?.cwd !== undefined) {
      providerOptions.cwd = options.cwd;
    }
    if (options?.env !== undefined) {
      providerOptions.envs = options.env;
    }
    if (options?.timeoutSeconds !== undefined) {
      providerOptions.timeoutMs = options.timeoutSeconds * 1000;
    }

    const resultPromise = this.sandbox.commands.run(commandString, providerOptions);

    resultPromise
      .then(() => {
        stdoutStream.close();
        stderrStream.close();
      })
      .catch((error) => {
        stdoutStream.error(error);
        stderrStream.error(error);
      });

    return {
      stdout: stdoutStream.readable,
      stderr: stderrStream.readable,
      exitCode: resultPromise.then((result) => result.exitCode ?? null),
    };
  }

  async getServiceUrl(options: GetServiceUrlOptions): Promise<ServiceUrl> {
    const token = this.sandbox.trafficAccessToken;
    const resolvedVisibility =
      options.visibility ??
      (this.allowPublicTraffic === false
        ? "private"
        : this.allowPublicTraffic === true
          ? "public"
          : token
            ? "private"
            : "public");
    const cached = this.serviceUrlCache.get(options.port);
    if (cached && cached.visibility === resolvedVisibility) {
      return cached;
    }

    if (this.allowPublicTraffic === undefined && options.visibility !== undefined) {
      if (options.visibility === "public" && token) {
        throw new ServiceUrlError(
          "visibility_mismatch",
          'Requested "public" URL, but the sandbox requires private access (traffic access token is present). Recreate the sandbox with allowPublicTraffic=true or request a private URL.',
        );
      }
      if (options.visibility === "private" && !token) {
        throw new ServiceUrlError(
          "visibility_mismatch",
          'Requested "private" URL, but the sandbox is configured for public traffic (no access token). Recreate the sandbox with allowPublicTraffic=false or request a public URL.',
        );
      }
    }

    if (this.allowPublicTraffic === false && resolvedVisibility === "public") {
      throw new ServiceUrlError(
        "visibility_mismatch",
        'Requested "public" URL, but the sandbox was created with allowPublicTraffic=false. Create a new sandbox with allowPublicTraffic=true to enable public URLs.',
      );
    }
    if (this.allowPublicTraffic === true && resolvedVisibility === "private") {
      throw new ServiceUrlError(
        "visibility_mismatch",
        'Requested "private" URL, but the sandbox was created with allowPublicTraffic=true. Create a new sandbox with allowPublicTraffic=false to require private access.',
      );
    }

    const url = `https://${this.sandbox.getHost(options.port)}`;
    let result: ServiceUrl;

    if (resolvedVisibility === "private") {
      if (!token) {
        throw new ServiceUrlError(
          "service_not_ready",
          "Sandbox traffic access token is not available yet.",
        );
      }
      result = {
        url,
        headers: { "e2b-traffic-access-token": token },
        visibility: "private",
      };
    } else {
      result = {
        url,
        visibility: "public",
      };
    }

    this.serviceUrlCache.set(options.port, result);
    return result;
  }

  async getTcpProxy(options: GetTcpProxyOptions): Promise<TcpProxyInfo> {
    const token = this.sandbox.trafficAccessToken;
    const resolvedVisibility =
      options.visibility ??
      (this.allowPublicTraffic === false
        ? "private"
        : this.allowPublicTraffic === true
          ? "public"
          : token
            ? "private"
            : "public");

    if (this.allowPublicTraffic === undefined && options.visibility !== undefined) {
      if (options.visibility === "public" && token) {
        throw new TcpProxyError(
          "visibility_mismatch",
          'Requested "public" TCP proxy, but the sandbox requires private access (traffic access token is present). Recreate the sandbox with allowPublicTraffic=true or request a private proxy.',
        );
      }
      if (options.visibility === "private" && !token) {
        throw new TcpProxyError(
          "visibility_mismatch",
          'Requested "private" TCP proxy, but the sandbox is configured for public traffic (no access token). Recreate the sandbox with allowPublicTraffic=false or request a public proxy.',
        );
      }
    }

    if (this.allowPublicTraffic === false && resolvedVisibility === "public") {
      throw new TcpProxyError(
        "visibility_mismatch",
        'Requested "public" TCP proxy, but the sandbox was created with allowPublicTraffic=false. Create a new sandbox with allowPublicTraffic=true to enable public proxies.',
      );
    }
    if (this.allowPublicTraffic === true && resolvedVisibility === "private") {
      throw new TcpProxyError(
        "visibility_mismatch",
        'Requested "private" TCP proxy, but the sandbox was created with allowPublicTraffic=true. Create a new sandbox with allowPublicTraffic=false to require private access.',
      );
    }

    await this.ensureTcpProxyRunning(options.port, options.timeoutSeconds);

    const url = `wss://${this.sandbox.getHost(TCP_PROXY_PORT)}`;

    if (resolvedVisibility === "private") {
      if (!token) {
        throw new TcpProxyError(
          "service_not_ready",
          "Sandbox traffic access token is not available yet.",
        );
      }
      return {
        url,
        headers: { "e2b-traffic-access-token": token },
        visibility: "private",
        protocol: "sprites-tcp-proxy-v1",
        init: {
          hostDefault: "localhost",
          requiresHost: false,
        },
      };
    }

    return {
      url,
      visibility: "public",
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

    await this.ensureNodeAvailable();

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
    try {
      const result = await this.exec("sh", ["-c", script]);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  private async waitForPortListening(port: number, timeoutSeconds?: number): Promise<void> {
    const retries = timeoutSeconds ? Math.max(0, Math.ceil(timeoutSeconds)) : 5;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const isListening = await this.checkPortListening(port);
      if (isListening) {
        return;
      }
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw new TcpProxyError(
      "proxy_unavailable",
      `TCP proxy port ${port} is not listening inside the sandbox.`,
    );
  }

  private async ensureNodeAvailable(): Promise<void> {
    try {
      const result = await this.exec("node", ["-v"]);
      if (result.exitCode === 0) {
        return;
      }
    } catch {
      throw new TcpProxyError(
        "unsupported",
        "TCP proxy requires Node.js to be available inside the sandbox.",
      );
    }
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
