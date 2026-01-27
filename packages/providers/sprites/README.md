## @usbx/sprites

Sprites provider for Universal Sandbox.

### Install

```
pnpm add @usbx/sprites
```

### Usage

```ts
import { SandboxManager } from "@usbx/core";
import { SpritesProvider } from "@usbx/sprites";

const sandbox = new SandboxManager({
  provider: new SpritesProvider({ token: process.env.SPRITES_TOKEN }),
});

const sbx = await sandbox.create({ name: "my-sprite" });
const result = await sbx.exec("echo", ["hello"]);
```

### Notes

- Sprites exec stdin is not supported in the unified API yet. Use `sandbox.native` for streaming.

### Links

- https://sprites.dev/api
