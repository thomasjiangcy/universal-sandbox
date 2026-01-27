## @usbx/local-docker

Local Docker provider for Universal Sandbox.

### Install

```
pnpm add @usbx/local-docker
```

### Usage

```ts
import { SandboxManager } from "@usbx/core";
import { LocalDockerProvider } from "@usbx/local-docker";

const sandbox = new SandboxManager({
  provider: new LocalDockerProvider({ defaultImage: "alpine" }),
});

const sbx = await sandbox.create({ name: "my-container" });
const result = await sbx.exec("echo", ["hello"]);
```

### Notes

- Docker exec stdin is not supported in the unified API yet.

### Links

- https://docs.docker.com/
