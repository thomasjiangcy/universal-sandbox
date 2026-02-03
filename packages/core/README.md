## @usbx/core

Core types and runtime for Universal Sandbox.

### Install

```
pnpm add @usbx/core
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

### Building Images

```ts
import { createSandboxClient } from "@usbx/core";
import { LocalDockerProvider } from "@usbx/local-docker";

const client = createSandboxClient({
  provider: new LocalDockerProvider(),
});

const image = await client.images.build({
  contextPath: "./images/python",
  dockerfilePath: "Dockerfile",
  name: "usbx-python-dev",
});

const sbx = await client.create({ name: "py-sandbox", image });
```

### Pulling Registry Images

```ts
const image = await client.images.fromRegistry({
  ref: "python:3.13-slim",
});

const sbx = await client.create({ name: "py-sandbox", image });
```

### Mounts

The unified API supports attaching storage at sandbox creation time via `CreateOptions.mounts`. There
are two usage styles:

### Inline Mounts

```ts
const sbx = await client.create({
  mounts: [
    { type: "volume", id: "my-volume", mountPath: "/mnt/data" },
    {
      type: "bucket",
      provider: "r2",
      bucket: "my-bucket",
      mountPath: "/mnt/r2",
      credentialsRef: "r2-secret",
      endpointUrl: "https://<accountid>.r2.cloudflarestorage.com",
    },
  ],
});
```

### Handle-based Mounts

```ts
const volume = await client.provider.volumes?.create?.({ name: "my-volume" });
const bucket = await client.provider.buckets?.fromRef?.({
  provider: "r2",
  bucket: "my-bucket",
  credentialsRef: "r2-secret",
  endpointUrl: "https://<accountid>.r2.cloudflarestorage.com",
});

const sbx = await client.create({
  mounts: [
    { handle: volume!, mountPath: "/mnt/data" },
    { handle: bucket!, mountPath: "/mnt/r2" },
  ],
});
```

### Emulated Mounts

Some providers can emulate bucket mounts by running a FUSE command inside the sandbox:

```ts
const sbx = await client.create({
  mounts: [
    {
      type: "emulated",
      mode: "bucket",
      provider: "r2",
      tool: "s3fs",
      mountPath: "/mnt/r2",
      readOnly: true,
      setup: [
        { command: "apt-get", args: ["update"] },
        { command: "apt-get", args: ["install", "-y", "s3fs"] },
      ],
      command: {
        command: "s3fs",
        args: ["my-bucket", "/mnt/r2", "-o", "passwd_file=/etc/s3fs.passwd"],
      },
    },
  ],
});
```

### Notes

- Provider support varies. See provider READMEs for which mount types are supported.
- Emulated mounts depend on FUSE support and privileges in the runtime. `readOnly` is enforced by
  adding tool-specific flags to the mount command.

### ImageRef Mapping

| Provider     | ImageRef.kind | Meaning                                  |
| ------------ | ------------- | ---------------------------------------- |
| Local Docker | `built`       | Local Docker image tag                   |
| Local Docker | `registry`    | Registry tag pulled to local Docker      |
| Modal        | `built`       | Modal image id (built via `Image.build`) |
| Modal        | `registry`    | Registry tag resolved by Modal           |
| E2B          | `template`    | E2B template id                          |
| Daytona      | `snapshot`    | Daytona snapshot name                    |
| Daytona      | `registry`    | Registry tag used for sandbox creation   |
| Sprites      | N/A           | Image building not supported             |
