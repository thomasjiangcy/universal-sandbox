## @universal/testing

Testing helpers for Universal Sandbox.

### Install

```
pnpm add @universal/testing -D
```

### Usage

```ts
import { UniversalSandbox } from "@universal/core";
import { LocalProvider } from "@universal/testing";

const sandbox = new UniversalSandbox({
  provider: new LocalProvider(),
});

const sbx = await sandbox.create({ name: "local" });
const result = await sbx.exec("echo", ["hello"]);
```