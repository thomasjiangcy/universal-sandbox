import { App, Sandbox as ModalSandboxClient } from "modal";
import type { Image, SandboxCreateParams, SandboxExecParams, Secret } from "modal";
import { ServiceUrlError, TcpProxyError } from "@usbx/core";
import type {
  CreateOptions,
  ExecOptions as UniversalExecOptions,
  ExecResult,
  ExecStream,
  GetServiceUrlOptions,
  GetTcpProxyOptions,
  Sandbox,
  SandboxId,
  SandboxProvider,
  ServiceUrl,
  ServiceUrlVisibility,
  TcpProxyInfo,
} from "@usbx/core";
import { readTextOrEmpty } from "./internal.js";

export type ModalServiceUrlOptions = {
  authMode?: "header" | "query";
};

export type ModalProviderOptions = {
  app?: App;
  appName?: string;
  appLookupOptions?: {
    environment?: string;
    createIfMissing?: boolean;
  };
  image?: Image;
  imageRef?: string;
  imageRegistrySecret?: Secret;
  sandboxOptions?: SandboxCreateParams;
} & ModalServiceUrlOptions;

export type ModalExecOptions = SandboxExecParams;

export class ModalProvider implements SandboxProvider<
  ModalSandboxClient,
  App | undefined,
  ModalExecOptions
> {
  private app?: App;
  private appName?: string;
  private appLookupOptions?: ModalProviderOptions["appLookupOptions"];
  private image?: Image;
  private imageRef?: string;
  private imageRegistrySecret?: Secret;
  private sandboxOptions?: SandboxCreateParams;
  private authMode: ModalServiceUrlOptions["authMode"];

  native?: App;

  constructor(options: ModalProviderOptions = {}) {
    if (options.app !== undefined) {
      this.app = options.app;
      this.native = options.app;
    }
    if (options.appName !== undefined) {
      this.appName = options.appName;
    }
    if (options.appLookupOptions !== undefined) {
      this.appLookupOptions = options.appLookupOptions;
    }
    if (options.image !== undefined) {
      this.image = options.image;
    }
    if (options.imageRef !== undefined) {
      this.imageRef = options.imageRef;
    }
    if (options.imageRegistrySecret !== undefined) {
      this.imageRegistrySecret = options.imageRegistrySecret;
    }
    if (options.sandboxOptions !== undefined) {
      this.sandboxOptions = options.sandboxOptions;
    }
    this.authMode = options.authMode ?? "header";
  }

  async create(options?: CreateOptions): Promise<Sandbox<ModalSandboxClient, ModalExecOptions>> {
    const app = await this.resolveApp();
    const image = await this.resolveImage(app);
    const sandbox = await app.createSandbox(image, ensureTcpProxyPorts(this.sandboxOptions));
    return new ModalSandbox(sandbox, options?.name, this.authMode);
  }

  async get(idOrName: string): Promise<Sandbox<ModalSandboxClient, ModalExecOptions>> {
    const sandbox = await ModalSandboxClient.fromId(idOrName);
    return new ModalSandbox(sandbox, undefined, this.authMode);
  }

  async delete(idOrName: string): Promise<void> {
    const sandbox = await ModalSandboxClient.fromId(idOrName);
    await sandbox.terminate();
  }

  private async resolveApp(): Promise<App> {
    if (this.app) {
      return this.app;
    }
    if (!this.appName) {
      throw new Error("ModalProvider requires app or appName.");
    }
    const app = await App.lookup(this.appName, {
      createIfMissing: this.appLookupOptions?.createIfMissing ?? true,
      ...(this.appLookupOptions?.environment !== undefined
        ? { environment: this.appLookupOptions.environment }
        : {}),
    });
    this.app = app;
    this.native = app;
    return app;
  }

  private async resolveImage(app: App): Promise<Image> {
    if (this.image) {
      return this.image;
    }
    if (!this.imageRef) {
      throw new Error("ModalProvider requires image or imageRef.");
    }
    const image = await app.imageFromRegistry(this.imageRef, this.imageRegistrySecret);
    this.image = image;
    return image;
  }
}

class ModalSandbox implements Sandbox<ModalSandboxClient, ModalExecOptions> {
  id: SandboxId;
  name?: string;
  native: ModalSandboxClient;

  private sandbox: ModalSandboxClient;
  private authMode: ModalServiceUrlOptions["authMode"];
  private serviceUrlCache = new Map<number, ServiceUrl>();

  constructor(
    sandbox: ModalSandboxClient,
    name: string | undefined,
    authMode: ModalServiceUrlOptions["authMode"],
  ) {
    this.id = sandbox.sandboxId;
    if (name) {
      this.name = name;
    }
    this.sandbox = sandbox;
    this.authMode = authMode;
    this.native = sandbox;
  }

  async exec(
    command: string,
    args: string[] = [],
    options?: UniversalExecOptions<ModalExecOptions>,
  ): Promise<ExecResult> {
    if (options?.stdin !== undefined) {
      throw new Error("ModalProvider.exec does not support stdin.");
    }
    if (options?.env !== undefined) {
      throw new Error("ModalProvider.exec does not support env; use secrets or images instead.");
    }

    const { mode: _mode, ...providerOptions } = options?.providerOptions ?? {};
    const execOptions: SandboxExecParams & { mode?: "text" } = {
      ...providerOptions,
      mode: "text",
      stdout: options?.providerOptions?.stdout ?? "pipe",
      stderr: options?.providerOptions?.stderr ?? "pipe",
    };

    if (options?.cwd !== undefined) {
      execOptions.workdir = options.cwd;
    }
    if (options?.timeoutSeconds !== undefined) {
      execOptions.timeoutMs = options.timeoutSeconds * 1000;
    }

    const process = await this.sandbox.exec([command, ...args], execOptions);
    const [stdout, stderr, exitCode] = await Promise.all([
      readTextOrEmpty(process.stdout),
      readTextOrEmpty(process.stderr),
      process.wait(),
    ]);

    return {
      stdout,
      stderr,
      exitCode,
    };
  }

  async execStream(
    command: string,
    args: string[] = [],
    options?: UniversalExecOptions<ModalExecOptions>,
  ): Promise<ExecStream> {
    if (options?.env !== undefined) {
      throw new Error(
        "ModalProvider.execStream does not support env; use secrets or images instead.",
      );
    }

    const { mode: _mode, ...providerOptions } = options?.providerOptions ?? {};
    const execOptions: SandboxExecParams & { mode: "binary" } = {
      ...providerOptions,
      mode: "binary",
      stdout: options?.providerOptions?.stdout ?? "pipe",
      stderr: options?.providerOptions?.stderr ?? "pipe",
    };

    if (options?.cwd !== undefined) {
      execOptions.workdir = options.cwd;
    }
    if (options?.timeoutSeconds !== undefined) {
      execOptions.timeoutMs = options.timeoutSeconds * 1000;
    }

    const process = await this.sandbox.exec([command, ...args], execOptions);

    if (options?.stdin !== undefined) {
      await writeToWebStream(process.stdin, options.stdin);
    }

    return {
      stdout: process.stdout,
      stderr: process.stderr,
      stdin: process.stdin,
      exitCode: process.wait(),
    };
  }

  async getServiceUrl(options: GetServiceUrlOptions): Promise<ServiceUrl> {
    const resolvedVisibility: ServiceUrlVisibility = options.visibility ?? "public";
    const cached = this.serviceUrlCache.get(options.port);
    if (cached && cached.visibility === resolvedVisibility) {
      return cached;
    }

    if (resolvedVisibility === "public") {
      const timeoutMs = options.timeoutSeconds ? options.timeoutSeconds * 1000 : undefined;
      const tunnels = timeoutMs
        ? await this.sandbox.tunnels(timeoutMs)
        : await this.sandbox.tunnels();
      const tunnel = tunnels[options.port];
      if (!tunnel) {
        throw new ServiceUrlError(
          "tunnel_unavailable",
          "Public URLs require forwarded ports. Create the sandbox with forwarded ports enabled to access public URLs.",
        );
      }

      const result: ServiceUrl = {
        url: tunnel.url,
        visibility: "public",
      };
      this.serviceUrlCache.set(options.port, result);
      return result;
    }

    if (options.port !== 8080) {
      throw new ServiceUrlError(
        "port_unavailable",
        "Private URLs use Modal connect tokens, which only support port 8080. Start your HTTP server on port 8080 or request a public URL.",
      );
    }

    const tokenInfo = await this.sandbox.createConnectToken();
    let url = tokenInfo.url;
    let headers: Record<string, string> | undefined;

    if (this.authMode === "query") {
      url = appendQueryToken(url, "_modal_connect_token", tokenInfo.token);
      headers = undefined;
    } else {
      headers = { Authorization: `Bearer ${tokenInfo.token}` };
    }

    const result: ServiceUrl = headers
      ? { url, headers, visibility: "private" }
      : { url, visibility: "private" };

    this.serviceUrlCache.set(options.port, result);
    return result;
  }

  async getTcpProxy(options: GetTcpProxyOptions): Promise<TcpProxyInfo> {
    const resolvedVisibility: ServiceUrlVisibility = options.visibility ?? "public";
    if (resolvedVisibility === "private") {
      throw new TcpProxyError(
        "visibility_mismatch",
        "Modal TCP proxy requires public tunnels; private access is not supported.",
      );
    }

    await this.ensureTcpProxyRunning(options.port, options.timeoutSeconds);

    const timeoutMs = options.timeoutSeconds ? options.timeoutSeconds * 1000 : undefined;
    const tunnels = timeoutMs
      ? await this.sandbox.tunnels(timeoutMs)
      : await this.sandbox.tunnels();
    const tunnel = tunnels[TCP_PROXY_PORT];
    if (!tunnel) {
      throw new TcpProxyError(
        "tunnel_unavailable",
        "TCP proxy requires forwarded ports. Create the sandbox with encrypted_ports including the proxy port.",
      );
    }

    return {
      url: tunnel.url.replace(/^https:\/\//, "wss://"),
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

const writeToWebStream = async (
  stream: WritableStream<Uint8Array>,
  input: string | Uint8Array,
): Promise<void> => {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const writer = stream.getWriter();
  await writer.write(bytes);
  await writer.close();
  writer.releaseLock();
};

const appendQueryToken = (url: string, key: string, value: string): string => {
  const parsed = new URL(url);
  parsed.searchParams.set(key, value);
  return parsed.toString();
};

const TCP_PROXY_PORT = 9000;

const ensureTcpProxyPorts = (options?: SandboxCreateParams): SandboxCreateParams | undefined => {
  if (!options) {
    return { encryptedPorts: [TCP_PROXY_PORT] };
  }
  const existing = options.encryptedPorts ?? [];
  if (existing.includes(TCP_PROXY_PORT)) {
    return options;
  }
  return { ...options, encryptedPorts: [...existing, TCP_PROXY_PORT] };
};

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
