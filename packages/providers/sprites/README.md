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

### Mounts (Emulated)

Sprites does not expose native bucket mounts in the unified provider today. You can emulate bucket
mounts by installing a FUSE tool and running the mount command via `mounts` with `type: "emulated"`.
This is opt-in and can fail if the sandbox lacks FUSE support, required packages, or permissions.

```ts
const sbx = await client.create({
  name: "my-sprite",
  mounts: [
    {
      type: "emulated",
      mode: "bucket",
      provider: "r2",
      tool: "s3fs",
      mountPath: "/mnt/data",
      readOnly: true,
      setup: [
        { command: "apt-get", args: ["update"] },
        { command: "apt-get", args: ["install", "-y", "s3fs"] },
      ],
      command: {
        command: "s3fs",
        args: ["my-bucket", "/mnt/data", "-o", "passwd_file=/etc/s3fs.passwd"],
      },
    },
  ],
});
```

### Links

- https://sprites.dev/api
