## @usbx/modal

Modal provider for Universal Sandbox.

### Install

```
pnpm add @usbx/modal
```

### Usage

```ts
import { SandboxClient } from "@usbx/core";
import { ModalProvider } from "@usbx/modal";

const client = new SandboxClient({
  provider: new ModalProvider({
    appName: "usbx-sandbox",
    imageRef: "python:3.13-slim",
  }),
});

const sbx = await client.create();
const result = await sbx.exec("echo", ["hello"]);
```

### Image Building

```ts
const image = await client.images?.build({
  name: "py-build",
  baseImage: "python:3.13-slim",
  dockerfileCommands: ["RUN pip install numpy"],
});

const sbx = await client.create({ image });
```

### ImageRef Mapping

| ImageRef.kind | Meaning                                  |
| ------------- | ---------------------------------------- |
| `built`       | Modal image id (built via `Image.build`) |
| `registry`    | Registry tag resolved by Modal           |

### Notes

- `get` expects a sandbox id (Modal does not resolve by name).
- Exec stdin and env are not supported in the unified API yet.
- Image builds use Modal `Image.build(app)` and require `baseImage` or `ModalProviderOptions.imageRef`.
- `dockerfilePath` is not supported in the unified build API for Modal.
- `dockerfileContent` is treated as Dockerfile commands (lines like `FROM ...` and comments are ignored).

### Links

- https://modal.com/docs
