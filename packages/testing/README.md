## @universal-sandbox/testing

Testing helpers for Universal Sandbox.

### Install

```
pnpm add @universal-sandbox/testing -D
```

### Usage

```ts
import { UniversalSandbox } from "@universal-sandbox/core";
import { LocalProvider } from "@universal-sandbox/testing";

const sandbox = new UniversalSandbox({
  provider: new LocalProvider(),
});

const sbx = await sandbox.create({ name: "local" });
const result = await sbx.exec("echo", ["hello"]);
```