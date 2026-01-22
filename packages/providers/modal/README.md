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

### Links

- https://modal.com/docs
