## @usbx/local-docker

Local Docker provider for Universal Sandbox.

### Install

```
pnpm add @usbx/local-docker
```

### Usage

```ts
import { createSandboxClient } from "@usbx/core";
import { LocalDockerProvider } from "@usbx/local-docker";

const client = createSandboxClient({
  provider: new LocalDockerProvider({ defaultImage: "alpine" }),
});

const sbx = await client.create({ name: "my-container" });
const result = await sbx.exec("echo", ["hello"]);
```

### Image Building

```ts
const image = await client.images.build({
  contextPath: "./images/python",
  dockerfilePath: "Dockerfile",
  name: "usbx-python-dev",
});

const sbx = await client.create({ name: "my-container", image });
```

### ImageRef Mapping

| ImageRef.kind | Meaning                     |
| ------------- | --------------------------- |
| `built`       | Local Docker image tag      |
| `registry`    | Registry tag pulled locally |

### Notes

- Docker exec stdin is not supported in the unified API yet.
- Image builds require `contextPath`, and `dockerfilePath` must be within the context.
- `dockerfileContent` and `dockerfileCommands` are not supported in the unified build API for Local Docker.
- At most one tag is supported (use `name` or a single `tags` entry).

### Mounts (Native Volumes)

Local Docker supports native volume mounts via `CreateOptions.mounts` with `type: "volume"`.

```ts
const sbx = await client.create({
  name: "my-container",
  mounts: [
    {
      type: "volume",
      id: "my-volume",
      mountPath: "/data",
      readOnly: false,
    },
  ],
});
```

You can also mount a pre-resolved volume handle by passing `{ handle, mountPath }`.

### Mounts (Emulated Buckets)

You can emulate bucket mounts inside a container by running FUSE tooling via `type: "emulated"`.
This requires the container to have FUSE access (typically `/dev/fuse`) and appropriate capabilities
(often `CAP_SYS_ADMIN`). Provide these via `LocalDockerProviderOptions.hostConfig`.

```ts
const client = createSandboxClient({
  provider: new LocalDockerProvider({
    defaultImage: "ubuntu:24.04",
    hostConfig: {
      Privileged: true,
      Devices: [
        { PathOnHost: "/dev/fuse", PathInContainer: "/dev/fuse", CgroupPermissions: "rwm" },
      ],
    },
  }),
});

const sbx = await client.create({
  name: "my-container",
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

### Links

- https://docs.docker.com/
