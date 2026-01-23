import { afterEach, describe, expect, it } from "vitest";

import { ModalClient } from "modal";

import { ModalProvider } from "../src/index.js";

const getModalClient = (): ModalClient => {
  const tokenId = process.env.MODAL_TOKEN_ID;
  const tokenSecret = process.env.MODAL_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) {
    throw new Error("Modal credentials missing: set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET.");
  }
  return new ModalClient({ tokenId, tokenSecret });
};

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
    ws.addEventListener(
      "message",
      (event) => {
        resolve(event);
      },
      { once: true },
    );
    ws.addEventListener("error", onError, { once: true });
  });

const waitForOpen = (ws: WebSocketLike): Promise<void> =>
  new Promise((resolve, reject) => {
    const onError = () => reject(new Error("WebSocket error before open."));
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", onError, { once: true });
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
  const ws = proxy.headers
    ? new WebSocketCtor(proxy.url, { headers: proxy.headers })
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
  await sandbox.exec("sh", ["-c", buildEchoServerScript(port)]);
  await new Promise((resolve) => setTimeout(resolve, 500));
};

const createModalSandbox = async () => {
  const client = getModalClient();
  const app = await client.apps.fromName("usbx-e2e-tcp-proxy", { createIfMissing: true });
  const provider = new ModalProvider({
    app,
    imageRef: "node:20-slim",
  });

  const sandbox = await provider.create();
  return { client, app, provider, sandbox };
};

const cleanupModalSandbox = async (resources: {
  client: ModalClient;
  app: { appId: string };
  provider: ModalProvider;
  sandbox: { id: string };
}) => {
  await resources.provider.delete(resources.sandbox.id);
  try {
    const appStopSource = 1; // AppStopSource.APP_STOP_SOURCE_CLI (not exported)
    await resources.client.cpClient.appStop({
      appId: resources.app.appId,
      source: appStopSource,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Modal app stop failed: ${message}`);
  } finally {
    resources.client.close();
  }
};

describe("modal e2e tcp proxy", () => {
  const cleanup = createCleanup();

  afterEach(async () => {
    await cleanup.run();
  });

  it("tunnels TCP traffic over the proxy", async () => {
    const resources = await createModalSandbox();
    const port = 8125;

    cleanup.add(() => cleanupModalSandbox(resources));

    await startTcpEchoServer(resources.sandbox, port);
    const proxy = await resources.sandbox.getTcpProxy({ port, visibility: "public" });
    const response = await connectAndEcho(proxy, port, "hello");

    expect(response).toBe("hello");
  }, 40000);
});
