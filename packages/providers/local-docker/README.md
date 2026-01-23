## @usbx/local-docker

Local Docker provider for Universal Sandbox.

### Install

```
pnpm add @usbx/local-docker
```

### Usage

```ts
import { UniversalSandbox } from "@usbx/core";
import { LocalDockerProvider } from "@usbx/local-docker";

const sandbox = new UniversalSandbox({
  provider: new LocalDockerProvider({ defaultImage: "alpine" }),
});

const sbx = await sandbox.create({ name: "my-container" });
const result = await sbx.exec("echo", ["hello"]);
```

### Notes

- Docker exec stdin is not supported in the unified API yet.
- `getServiceUrl` is supported for ports published at container creation time.
- Public service URLs are not supported; Docker is intended for local development.

### Links

- https://docs.docker.com/
