## @usbx/modal

Modal provider for Universal Sandbox.

### Install

```
pnpm add @usbx/modal
```

### Usage

```ts
import { UniversalSandbox } from "@usbx/core";
import { ModalProvider } from "@usbx/modal";

const sandbox = new UniversalSandbox({
  provider: new ModalProvider({
    appName: "usbx-sandbox",
    imageRef: "python:3.13-slim",
  }),
});

const sbx = await sandbox.create();
const result = await sbx.exec("echo", ["hello"]);
```

### Notes

- `get` expects a sandbox id (Modal does not resolve by name).
- Exec stdin and env are not supported in the unified API yet.
- `getTcpProxy` starts a lightweight WebSocket-to-TCP proxy inside the sandbox (Node.js required) and returns a Sprites-style tunnel URL.
- Modal TCP proxying uses public tunnels only; the proxy port (9000) is added to `encrypted_ports` on sandbox creation.

### Links

- https://modal.com/docs
