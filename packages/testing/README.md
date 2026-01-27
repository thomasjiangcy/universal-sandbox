## @usbx/testing

Testing helpers for Universal Sandbox.

### Install

```
pnpm add @usbx/testing -D
```

### Usage

```ts
import { SandboxManager } from "@usbx/core";
import { LocalProvider } from "@usbx/testing";

const sandbox = new SandboxManager({
  provider: new LocalProvider(),
});

const sbx = await sandbox.create({ name: "local" });
const result = await sbx.exec("echo", ["hello"]);
```
