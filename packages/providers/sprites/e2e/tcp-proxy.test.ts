import { afterEach, describe, expect, it } from "vitest";

import { SpritesProvider } from "../src/index.js";

type CleanupTask = () => Promise<void>;

type WebSocketMessageEvent = {
  data?: unknown;
};

type WebSocketLike = {
  binaryType: "arraybuffer";
  addEventListener: (
    type: "open" | "message" | "error" | "close",
    listener: (event: WebSocketMessageEvent) => void,
    options?: { once?: boolean },
  ) => void;
  send: (data: string | ArrayBuffer | Uint8Array) => void;
  close: () => void;
};

type WebSocketConstructor = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => WebSocketLike;

type SandboxWithExec = {
  exec: (command: string, args?: string[]) => Promise<unknown>;
  getTcpProxy: (options: { port: number; visibility?: "public" | "private" }) => Promise<{
    url: string;
    headers?: Record<string, string>;
  }>;
};

const createCleanup = () => {
  let tasks: CleanupTask[] = [];

  return {
    add(task: CleanupTask) {
      tasks.push(task);
    },
    async run() {
      const current = tasks;
      tasks = [];
      for (const task of current) {
        try {
          await task();
        } catch {
          // Best-effort cleanup.
        }
      }
    },
  };
};

const getWebSocketConstructor = (): WebSocketConstructor => {
  const ws = (globalThis as unknown as { WebSocket?: WebSocketConstructor }).WebSocket;
  if (!ws) {
    throw new Error("WebSocket is not available in this runtime.");
  }
  return ws;
};

const waitForMessage = (ws: WebSocketLike): Promise<WebSocketMessageEvent> =>
  new Promise((resolve, reject) => {
    const onError = () => reject(new Error("WebSocket error."));
    const onClose = () => reject(new Error("WebSocket closed before message."));
    ws.addEventListener(
      "message",
      (event) => {
        resolve(event);
      },
      { once: true },
    );
    ws.addEventListener("error", onError, { once: true });
    ws.addEventListener("close", onClose, { once: true });
  });

const waitForOpen = (ws: WebSocketLike): Promise<void> =>
  new Promise((resolve, reject) => {
    const onError = () => reject(new Error("WebSocket error before open."));
    const onClose = () => reject(new Error("WebSocket closed before open."));
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", onError, { once: true });
    ws.addEventListener("close", onClose, { once: true });
  });

const toBytes = (data: unknown): Uint8Array | null => {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  return null;
};

const connectAndEcho = async (
  proxy: { url: string; headers?: Record<string, string> },
  port: number,
  message: string,
): Promise<string> => {
  const WebSocketCtor = getWebSocketConstructor();
  const options = proxy.headers ? { headers: proxy.headers } : undefined;
  const ws = options
    ? new WebSocketCtor(proxy.url, undefined, options)
    : new WebSocketCtor(proxy.url);
  ws.binaryType = "arraybuffer";

  await waitForOpen(ws);
  ws.send(JSON.stringify({ host: "localhost", port }));

  const initMessage = await waitForMessage(ws);
  if (typeof initMessage.data === "string") {
    // ignore handshake response
  }

  const payload = new TextEncoder().encode(message);
  ws.send(payload);

  const response = await waitForMessage(ws);
  const bytes = toBytes(response.data);
  ws.close();

  if (!bytes) {
    throw new Error("No response data received from TCP proxy.");
  }

  return new TextDecoder().decode(bytes);
};

const connectAndEchoWithRetry = async (
  proxy: { url: string; headers?: Record<string, string> },
  port: number,
  message: string,
  attempts = 5,
): Promise<string> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await connectAndEcho(proxy, port, message);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Failed to connect to Sprites TCP proxy.");
};

const buildEchoServerScript = (port: number): string => `
if command -v node >/dev/null 2>&1; then
  node -e "const net=require('net');const server=net.createServer((socket)=>{socket.on('data',(data)=>socket.write(data));});server.listen(${port},'0.0.0.0');" >/tmp/tcp-echo.log 2>&1 &
  exit 0
fi
if command -v python3 >/dev/null 2>&1; then
  python3 - <<'PY' >/tmp/tcp-echo.log 2>&1 &
import socket
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("0.0.0.0", ${port}))
s.listen()
while True:
    conn, _ = s.accept()
    while True:
        data = conn.recv(4096)
        if not data:
            break
        conn.sendall(data)
    conn.close()
PY
  exit 0
fi
if command -v python >/dev/null 2>&1; then
  python - <<'PY' >/tmp/tcp-echo.log 2>&1 &
import socket
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("0.0.0.0", ${port}))
s.listen()
while True:
    conn, _ = s.accept()
    while True:
        data = conn.recv(4096)
        if not data:
            break
        conn.sendall(data)
    conn.close()
PY
  exit 0
fi
exit 1
`;

const startTcpEchoServer = async (sandbox: SandboxWithExec, port: number): Promise<void> => {
  const result = await sandbox.exec("sh", ["-c", buildEchoServerScript(port)]);
  if (
    typeof result === "object" &&
    result !== null &&
    "exitCode" in result &&
    result.exitCode !== 0
  ) {
    throw new Error("Failed to start TCP echo server inside sprite.");
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
};

describe("sprites e2e tcp proxy", () => {
  const cleanup = createCleanup();

  afterEach(async () => {
    await cleanup.run();
  });

  it("tunnels TCP traffic over the proxy", async () => {
    const name = `usbx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const token = process.env.SPRITES_TOKEN;
    if (!token) {
      throw new Error("SPRITES_TOKEN is required for the tcp proxy test.");
    }
    const provider = new SpritesProvider({ token });
    const port = 8126;

    const sandbox = await provider.create({ name });
    cleanup.add(() => provider.delete(sandbox.id));

    await startTcpEchoServer(sandbox, port);
    const proxy = await sandbox.getTcpProxy({ port, visibility: "private" });
    expect(proxy.headers?.Authorization).toBeTruthy();
    const response = await connectAndEchoWithRetry(proxy, port, "hello");

    expect(response).toBe("hello");
  }, 40000);
});
