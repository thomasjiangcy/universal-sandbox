## @usbx/local-docker

Local Docker provider for Universal Sandbox.

### Install

```
pnpm add @usbx/local-docker
```

### Usage

```ts
import { SandboxClient } from "@usbx/core";
import { LocalDockerProvider } from "@usbx/local-docker";

const client = new SandboxClient({
  provider: new LocalDockerProvider({ defaultImage: "alpine" }),
});

const sbx = await client.create({ name: "my-container" });
const result = await sbx.exec("echo", ["hello"]);
```

### Image Building

```ts
const image = await client.images?.build({
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

### Links

- https://docs.docker.com/
