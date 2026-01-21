## @universal/sprites

Sprites provider for Universal Sandbox.

### Install

```
pnpm add @universal/sprites
```

### Usage

```ts
import { UniversalSandbox } from "@universal/core";
import { SpritesProvider } from "@universal/sprites";

const sandbox = new UniversalSandbox({
  provider: new SpritesProvider({ token: process.env.SPRITES_TOKEN }),
});

const sbx = await sandbox.create({ name: "my-sprite" });
const result = await sbx.exec("echo", ["hello"]);
```

### Notes

- Sprites exec stdin is not supported in the unified API yet. Use `sandbox.native` for streaming.

### Links

- https://sprites.dev/api