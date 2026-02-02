## @usbx/sprites

Sprites provider for Universal Sandbox.

### Install

```
pnpm add @usbx/sprites
```

### Usage

```ts
import { createSandboxClient } from "@usbx/core";
import { SpritesProvider } from "@usbx/sprites";

const client = createSandboxClient({
  provider: new SpritesProvider({ token: process.env.SPRITES_TOKEN }),
});

const sbx = await client.create({ name: "my-sprite" });
const result = await sbx.exec("echo", ["hello"]);
```

### Image Building

Sprites does not support building base images through the unified API.

### ImageRef Mapping

| ImageRef.kind | Meaning     |
| ------------- | ----------- |
| N/A           | Unsupported |

### Notes

- Sprites exec stdin is not supported in the unified API yet. Use `sandbox.native` for streaming.

### Links

- https://sprites.dev/api
