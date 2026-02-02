## @usbx/core

Core types and runtime for Universal Sandbox.

### Install

```
pnpm add @usbx/core
```

### Usage

```ts
import { SandboxClient } from "@usbx/core";
import { SpritesProvider } from "@usbx/sprites";

const client = new SandboxClient({
  provider: new SpritesProvider({ token: process.env.SPRITES_TOKEN }),
});

const sbx = await client.create({ name: "my-sprite" });
const result = await sbx.exec("echo", ["hello"]);
```

### Building Images

```ts
import { SandboxClient } from "@usbx/core";
import { LocalDockerProvider } from "@usbx/local-docker";

const client = new SandboxClient({
  provider: new LocalDockerProvider(),
});

const image = await client.images?.build({
  contextPath: "./images/python",
  dockerfilePath: "Dockerfile",
  name: "usbx-python-dev",
});

const sbx = await client.create({ name: "py-sandbox", image });
```

### Pulling Registry Images

```ts
const image = await client.images?.fromRegistry({
  ref: "python:3.13-slim",
});

const sbx = await client.create({ name: "py-sandbox", image });
```

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
