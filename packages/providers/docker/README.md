## @universal-sandbox/docker

Docker provider for Universal Sandbox.

### Install

```
pnpm add @universal-sandbox/docker
```

### Usage

```ts
import { UniversalSandbox } from "@universal-sandbox/core";
import { DockerProvider } from "@universal-sandbox/docker";

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