## @usbx/testing

Testing helpers for Universal Sandbox.

### Install

```
pnpm add @usbx/testing -D
```

### Usage

```ts
import { createSandboxClient } from "@usbx/core";
import { LocalProvider } from "@usbx/testing";

const client = createSandboxClient({
  provider: new LocalProvider(),
});

const sbx = await client.create({ name: "local" });
const result = await sbx.exec("echo", ["hello"]);
```
