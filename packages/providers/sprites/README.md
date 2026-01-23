## @usbx/sprites

Sprites provider for Universal Sandbox.

### Install

```
pnpm add @usbx/sprites
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

- Sprites exec stdin is not supported in the unified API yet. Use `sandbox.native` for streaming.
- `getServiceUrl` is best-effort for Sprites. It uses the sprite URL plus the requested port and confirms the port is listening via `ss` or `lsof`.
- Private sprite URLs may require an `Authorization: Bearer <token>` header; the caller is responsible for providing it.

### Links

- https://sprites.dev/api
