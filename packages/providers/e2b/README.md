## @usbx/e2b

E2B provider for Universal Sandbox.

### Install

```
pnpm add @usbx/e2b
```

### Usage

```ts
import { SandboxClient } from "@usbx/core";
import { E2BProvider } from "@usbx/e2b";

const client = new SandboxClient({
  provider: new E2BProvider(),
});

const sbx = await client.create();
const result = await sbx.exec("echo", ["hello"]);
```

### Image Building

```ts
const image = await client.images?.build({
  name: "my-template",
  baseImage: "python:3.12-slim",
});

const sbx = await client.create({ image });
```

### ImageRef Mapping

| ImageRef.kind | Meaning         |
| ------------- | --------------- |
| `template`    | E2B template id |

### Notes

- `get` expects a sandbox id (E2B does not resolve by name).
- Exec stdin is not supported in the unified API yet. Use `sandbox.native` for streaming.
- Image builds create E2B templates. `ImageRef.id` is the template id.
- `ImageBuildSpec.name` is required (used as the template alias).
- Supported build inputs: `baseImage`, `dockerfilePath`, or `dockerfileContent`.
- `dockerfileCommands` are not supported in the unified build API for E2B.

### Links

- https://e2b.dev/docs
