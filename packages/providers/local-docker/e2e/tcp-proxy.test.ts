import { afterEach, describe, expect, it } from "vitest";

import { LocalDockerProvider } from "../src/index.js";

type CleanupTask = () => Promise<void>;

type SandboxWithExec = {
  exec: (
    command: string,
    args?: string[],
  ) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
  execStream: (
    command: string,
    args?: string[],
  ) => Promise<{ stdout: ReadableStream<Uint8Array>; stderr: ReadableStream<Uint8Array> }>;
  getTcpProxy: (options: { port: number; visibility?: "public" | "private" }) => Promise<{
    url: string;
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

const buildEchoServerScript = (port: number): string => `
node -e "const net=require('net');const server=net.createServer((socket)=>{socket.on('data',(data)=>socket.write(data));});server.listen(${port},'0.0.0.0');" >/tmp/tcp-echo.log 2>&1 &
`;

const startTcpEchoServer = async (sandbox: SandboxWithExec, port: number): Promise<void> => {
  await sandbox.exec("sh", ["-c", buildEchoServerScript(port)]);
  await new Promise((resolve) => setTimeout(resolve, 500));
};

const buildTcpProxyClientScript = (
  proxyPort: number,
  targetPort: number,
  message: string,
): string => `
cat <<'NODE' > /tmp/usbx-tcp-proxy-client.js
const net = require('net');
const crypto = require('crypto');

const proxyPort = ${proxyPort};
const targetPort = ${targetPort};
const payload = Buffer.from(${JSON.stringify(message)}, 'utf8');
const key = crypto.randomBytes(16).toString('base64');
const expectedAccept = crypto.createHash('sha1')
  .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
  .digest('base64');

const socket = net.connect(proxyPort, '127.0.0.1');
let buffer = Buffer.alloc(0);
let handshakeDone = false;
const timeout = setTimeout(() => {
  console.error('tcp proxy client timeout');
  process.exit(1);
}, 5000);

const buildFrame = (opcode, data) => {
  const length = data.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([header, data]);
};

const parseFrame = (buf) => {
  if (buf.length < 2) return null;
  const byte1 = buf[0];
  const byte2 = buf[1];
  const opcode = byte1 & 0x0f;
  const masked = (byte2 & 0x80) !== 0;
  let length = byte2 & 0x7f;
  let headerSize = 2;
  if (length === 126) {
    if (buf.length < 4) return null;
    length = buf.readUInt16BE(2);
    headerSize = 4;
  } else if (length === 127) {
    if (buf.length < 10) return null;
    length = Number(buf.readBigUInt64BE(2));
    headerSize = 10;
  }
  const maskOffset = headerSize;
  const dataOffset = maskOffset + (masked ? 4 : 0);
  const frameEnd = dataOffset + length;
  if (buf.length < frameEnd) return null;
  let payload = buf.subarray(dataOffset, frameEnd);
  if (masked) {
    const mask = buf.subarray(maskOffset, maskOffset + 4);
    const unmasked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i += 1) {
      unmasked[i] = payload[i] ^ mask[i % 4];
    }
    payload = unmasked;
  }
  return { opcode, payload, remaining: buf.subarray(frameEnd) };
};

const handshake = () => {
  const request = [
    'GET / HTTP/1.1',
    'Host: 127.0.0.1:' + proxyPort,
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Version: 13',
    'Sec-WebSocket-Key: ' + key,
    '',
    '',
  ].join('\\r\\n');
  socket.write(request);
};

socket.on('connect', () => {
  handshake();
});

socket.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  if (!handshakeDone) {
    const headerEnd = buffer.indexOf('\\r\\n\\r\\n');
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd + 4).toString('utf8');
    buffer = buffer.subarray(headerEnd + 4);
    if (!header.includes('101 Switching Protocols') || !header.toLowerCase().includes(expectedAccept.toLowerCase())) {
      console.error(header);
      clearTimeout(timeout);
      process.exit(1);
    }
    handshakeDone = true;
    const initPayload = Buffer.from(JSON.stringify({ host: 'localhost', port: targetPort }), 'utf8');
    socket.write(buildFrame(0x1, initPayload));
    return;
  }

  const frame = parseFrame(buffer);
  if (!frame) return;
  buffer = frame.remaining;

  if (frame.opcode === 0x1) {
    const data = frame.payload.toString('utf8');
    if (data.includes('connected')) {
      socket.write(buildFrame(0x2, payload));
    }
    return;
  }

  if (frame.opcode === 0x2) {
    process.stdout.write(frame.payload.toString('utf8'));
    clearTimeout(timeout);
    socket.end();
  }
});

socket.on('error', (error) => {
  console.error(error.message);
  clearTimeout(timeout);
  process.exit(1);
});
socket.on('end', () => {
  console.error('tcp proxy client ended');
  clearTimeout(timeout);
  process.exit(1);
});
NODE
if command -v timeout >/dev/null 2>&1; then
  timeout 8s node /tmp/usbx-tcp-proxy-client.js
else
  node /tmp/usbx-tcp-proxy-client.js
fi
rm -f /tmp/usbx-tcp-proxy-client.js
`;

const runTcpProxyClient = async (
  sandbox: SandboxWithExec,
  proxyPort: number,
  targetPort: number,
  message: string,
): Promise<string> => {
  const script = buildTcpProxyClientScript(proxyPort, targetPort, message);
  const result = await sandbox.exec("sh", ["-c", script]);
  if (result.exitCode !== 0) {
    throw new Error(`TCP proxy client failed: ${result.stderr || "no stderr"}`);
  }
  return result.stdout.trim();
};

const buildProxyServerScript = (proxyPort: number): string => `
node -e "const http=require('http');const crypto=require('crypto');const net=require('net');const MAGIC='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';const server=http.createServer();const sendFrame=(socket,opcode,payload)=>{const length=payload.length;let header;if(length<126){header=Buffer.alloc(2);header[1]=length;}else if(length<65536){header=Buffer.alloc(4);header[1]=126;header.writeUInt16BE(length,2);}else{header=Buffer.alloc(10);header[1]=127;header.writeBigUInt64BE(BigInt(length),2);}header[0]=0x80|(opcode&0x0f);socket.write(Buffer.concat([header,payload]));};const parseFrames=(buffer)=>{const frames=[];let offset=0;while(offset+2<=buffer.length){const byte1=buffer[offset];const byte2=buffer[offset+1];const fin=(byte1&0x80)!==0;const opcode=byte1&0x0f;const masked=(byte2&0x80)!==0;let length=byte2&0x7f;let headerSize=2;if(length===126){if(offset+4>buffer.length)break;length=buffer.readUInt16BE(offset+2);headerSize=4;}else if(length===127){if(offset+10>buffer.length)break;const value=buffer.readBigUInt64BE(offset+2);if(value>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Frame too large');length=Number(value);headerSize=10;}const maskOffset=offset+headerSize;const dataOffset=maskOffset+(masked?4:0);const frameEnd=dataOffset+length;if(frameEnd>buffer.length)break;let payload=buffer.subarray(dataOffset,frameEnd);if(masked){const mask=buffer.subarray(maskOffset,maskOffset+4);const unmasked=Buffer.alloc(payload.length);for(let i=0;i<payload.length;i+=1){unmasked[i]=payload[i]^mask[i%4];}payload=unmasked;}frames.push({fin,opcode,payload});offset=frameEnd;}return {frames,remaining:buffer.subarray(offset)};};server.on('upgrade',(req,socket)=>{const key=req.headers['sec-websocket-key'];if(typeof key!=='string'){socket.end('HTTP/1.1 400 Bad Request\\r\\n\\r\\n');return;}const accept=crypto.createHash('sha1').update(key+MAGIC).digest('base64');const response=['HTTP/1.1 101 Switching Protocols','Upgrade: websocket','Connection: Upgrade','Sec-WebSocket-Accept: '+accept,'\\r\\n'].join('\\r\\n');socket.write(response);socket.setNoDelay(true);let buffer=Buffer.alloc(0);let initialized=false;let tcp=null;const close=()=>{if(tcp)tcp.destroy();socket.end();};socket.on('data',(chunk)=>{buffer=Buffer.concat([buffer,chunk]);let parsed;try{parsed=parseFrames(buffer);}catch{close();return;}buffer=parsed.remaining;for(const frame of parsed.frames){if(!frame.fin){close();return;}if(frame.opcode===0x8){close();return;}if(frame.opcode===0x9){sendFrame(socket,0xA,frame.payload);continue;}if(!initialized){if(frame.opcode!==0x1){close();return;}let init;try{init=JSON.parse(frame.payload.toString('utf8'));}catch{close();return;}const host=typeof init.host==='string'?init.host:'localhost';const port=init.port;if(!Number.isInteger(port)||port<1||port>65535){close();return;}tcp=net.createConnection({host,port});tcp.on('connect',()=>{initialized=true;sendFrame(socket,0x1,Buffer.from(JSON.stringify({status:'connected',target:host+':'+port})));});tcp.on('data',(data)=>sendFrame(socket,0x2,data));tcp.on('error',close);tcp.on('close',close);continue;}if(frame.opcode===0x2&&tcp){tcp.write(frame.payload);}}});socket.on('close',close);socket.on('error',close);});server.listen(${proxyPort},'0.0.0.0');" >/tmp/usbx-tcp-proxy.log 2>&1
`;

const ensureProxyRunning = async (sandbox: SandboxWithExec, proxyPort: number): Promise<void> => {
  const probe = await sandbox.exec("sh", [
    "-c",
    `node -e "const net=require('net');const socket=net.connect(${proxyPort},'127.0.0.1');socket.on('connect',()=>{socket.end();process.exit(0);});socket.on('error',()=>process.exit(1));"`,
  ]);
  if (probe.exitCode === 0) {
    return;
  }

  await sandbox.execStream("sh", ["-c", buildProxyServerScript(proxyPort)]);
  await new Promise((resolve) => setTimeout(resolve, 500));
};

describe("local-docker e2e tcp proxy", () => {
  const cleanup = createCleanup();

  afterEach(async () => {
    await cleanup.run();
  });

  it("tunnels TCP traffic over the proxy", async () => {
    const name = `usbx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const provider = new LocalDockerProvider({
      defaultImage: "node:20-alpine",
      portExposure: { ports: [9000], publishMode: "random" },
    });
    const targetPort = 8127;

    const sandbox = await provider.create({ name });
    cleanup.add(() => provider.delete(sandbox.id));

    await startTcpEchoServer(sandbox, targetPort);
    const proxy = await sandbox.getTcpProxy({ port: targetPort, visibility: "private" });
    expect(proxy.url.startsWith("ws://")).toBe(true);
    await ensureProxyRunning(sandbox, 9000);
    const probe = await sandbox.exec("sh", [
      "-c",
      "node -e \"const net=require('net');const socket=net.connect(9000,'127.0.0.1');socket.on('connect',()=>{socket.end();process.exit(0);});socket.on('error',()=>process.exit(1));\"",
    ]);
    expect(probe.exitCode).toBe(0);

    try {
      const response = await runTcpProxyClient(sandbox, 9000, targetPort, "hello");
      expect(response).toBe("hello");
    } catch (error) {
      const logResult = await sandbox.exec("sh", [
        "-c",
        "cat /tmp/usbx-tcp-proxy.log 2>/dev/null || true",
      ]);
      const log = logResult.stdout.trim();
      const message = error instanceof Error ? error.message : String(error);
      const suffix = log.length > 0 ? ` Proxy log: ${log}` : "";
      throw new Error(`${message}.${suffix}`);
    }
  }, 40000);
});
