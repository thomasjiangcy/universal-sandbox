## @usbx/docker

Docker provider for Universal Sandbox.

### Install

```
pnpm add @usbx/docker
```

### Usage

```ts
import { UniversalSandbox } from "@usbx/core";
import { DockerProvider } from "@usbx/docker";

const sandbox = new UniversalSandbox({
  provider: new DockerProvider({ defaultImage: "alpine" }),
});

const sbx = await sandbox.create({ name: "my-container" });
const result = await sbx.exec("echo", ["hello"]);
```

### Notes

- Docker exec stdin is not supported in the unified API yet.

### Links

- https://docs.docker.com/
