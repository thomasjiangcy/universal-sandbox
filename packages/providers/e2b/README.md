## @usbx/e2b

E2B provider for Universal Sandbox.

### Install

```
pnpm add @usbx/e2b
```

### Usage

```ts
import { UniversalSandbox } from "@usbx/core";
import { E2BProvider } from "@usbx/e2b";

const sandbox = new UniversalSandbox({
  provider: new E2BProvider(),
});

const sbx = await sandbox.create();
const result = await sbx.exec("echo", ["hello"]);
```

### Notes

- `get` expects a sandbox id (E2B does not resolve by name).
- Exec stdin is not supported in the unified API yet. Use `sandbox.native` for streaming.

### Links

- https://e2b.dev/docs
