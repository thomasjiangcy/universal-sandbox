## @usbx/core

Core types and runtime for Universal Sandbox.

### Install

```
pnpm add @usbx/core
```

### Usage

```ts
import { UniversalSandbox } from "@usbx/core";
import { SpritesProvider } from "@usbx/sprites";

const sandbox = new UniversalSandbox({
  provider: new SpritesProvider({ token: process.env.SPRITES_TOKEN }),
});

const sbx = await sandbox.create({ name: "my-sprite" });
const result = await sbx.exec("echo", ["hello"]);
```

### Notes

- `getServiceUrl` is currently unsupported for the Sprites provider.
