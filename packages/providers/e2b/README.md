## @usbx/e2b

E2B provider for Universal Sandbox.

### Install

```
pnpm add @usbx/e2b
```

### Usage

```ts
import { createSandboxClient } from "@usbx/core";
import { E2BProvider } from "@usbx/e2b";

const client = createSandboxClient({
  provider: new E2BProvider(),
});

const sbx = await client.create();
const result = await sbx.exec("echo", ["hello"]);
```

### Image Building

```ts
const image = await client.images.build({
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

### Mounts (Emulated)

E2B does not expose native bucket mounts in the unified provider today. You can emulate bucket mounts
by installing a FUSE tool and running the mount command via `mounts` with `type: "emulated"`.
This is opt-in and can fail if the sandbox lacks FUSE support, required packages, or credentials.
If you restrict outbound networking, you must allow egress to the bucket endpoint host and any
package repos used during setup (or enable internet access).

```ts
import { Template } from "e2b";

const provider = new E2BProvider({
  createOptions: {
    allowInternetAccess: true,
  },
});

const template = Template().fromImage("ubuntu:latest").aptInstall(["s3fs"]);
const built = await Template.build(template, { alias: "usbx-s3fs" });

const sbx = await client.create({
  image: {
    provider: "e2b",
    kind: "template",
    id: built.templateId,
    metadata: { alias: built.alias },
  },
  provider,
  mounts: [
    {
      type: "emulated",
      mode: "bucket",
      provider: "s3",
      tool: "s3fs",
      mountPath: "/home/user/bucket",
      readOnly: true,
      setup: [
        { command: "sudo", args: ["mkdir", "-p", "/home/user/bucket"] },
        {
          command: "sudo",
          args: ["sh", "-lc", 'printf \'%s:%s\' "$ACCESS_KEY" "$SECRET_KEY" > /root/.passwd-s3fs'],
        },
        { command: "sudo", args: ["chmod", "600", "/root/.passwd-s3fs"] },
      ],
      command: {
        command: "sudo",
        args: [
          "s3fs",
          "-o",
          "url=https://<account>.r2.cloudflarestorage.com",
          "-o",
          "use_path_request_style",
          "-o",
          "allow_other",
          "my-bucket",
          "/home/user/bucket",
        ],
      },
    },
  ],
});
```

### Links

- https://e2b.dev/docs
