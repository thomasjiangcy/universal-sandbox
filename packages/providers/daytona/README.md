## @usbx/daytona

Daytona provider for Universal Sandbox.

### Install

```
pnpm add @usbx/daytona
```

### Usage

```ts
import { SandboxManager } from "@usbx/core";
import { DaytonaProvider } from "@usbx/daytona";

const sandbox = new SandboxManager({
  provider: new DaytonaProvider({
    createParams: { language: "typescript" },
  }),
});

const sbx = await sandbox.create({ name: "my-daytona-sbx" });
const result = await sbx.exec("echo", ["hello"]);
```

### Notes

- Exec stdin is not supported in the unified API yet.
- `executeCommand` does not return stderr, so `stderr` is always empty.
- `getTcpProxy` starts a lightweight WebSocket-to-TCP proxy inside the sandbox (Node.js required) and returns a Sprites-style tunnel URL.

### Links

- https://www.daytona.io/docs/en/typescript-sdk/
