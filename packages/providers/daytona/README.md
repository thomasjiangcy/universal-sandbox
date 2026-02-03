## @usbx/daytona

Daytona provider for Universal Sandbox.

### Install

```
pnpm add @usbx/daytona
```

### Usage

```ts
import { createSandboxClient } from "@usbx/core";
import { DaytonaProvider } from "@usbx/daytona";

const client = createSandboxClient({
  provider: new DaytonaProvider({
    createParams: { language: "typescript" },
  }),
});

const sbx = await client.create({ name: "my-daytona-sbx" });
const result = await sbx.exec("echo", ["hello"]);
```

### Image Building

```ts
const image = await client.images.build({
  name: "py-snapshot",
  baseImage: "python:3.12-slim",
});

const sbx = await client.create({ name: "my-daytona-sbx", image });
```

### ImageRef Mapping

| ImageRef.kind | Meaning                      |
| ------------- | ---------------------------- |
| `snapshot`    | Daytona snapshot name        |
| `registry`    | Registry tag used for create |

### Notes

- Exec stdin is not supported in the unified API yet.
- `executeCommand` does not return stderr, so `stderr` is always empty.
- Image builds create Daytona snapshots. `ImageRef.kind` is `snapshot` and `id` is the snapshot name.
- `ImageBuildSpec.name` is required when building snapshots.
- Supported build inputs: `baseImage` or `dockerfilePath`.
- `dockerfileContent` and `dockerfileCommands` are not supported in the unified build API for Daytona.

### Mounts (Native Volumes)

Daytona supports native volume mounts via `CreateOptions.mounts` with `type: "volume"`.

```ts
const sbx = await client.create({
  name: "my-daytona-sbx",
  mounts: [
    {
      type: "volume",
      id: "volume-id",
      mountPath: "/home/daytona/data",
      subpath: "team/a",
    },
  ],
});
```

You can also mount a pre-resolved volume handle by passing `{ handle, mountPath }`.

### Links

- https://www.daytona.io/docs/en/typescript-sdk/
