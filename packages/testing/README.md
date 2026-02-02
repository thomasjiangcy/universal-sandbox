## @usbx/testing

Testing helpers for Universal Sandbox.

### Install

```
pnpm add @usbx/testing -D
```

### Usage

```ts
import { SandboxClient } from "@usbx/core";
import { LocalProvider } from "@usbx/testing";

const client = new SandboxClient({
  provider: new LocalProvider(),
});

const sbx = await client.create({ name: "local" });
const result = await sbx.exec("echo", ["hello"]);
```
