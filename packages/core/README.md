## @universal-sandbox/core

Core types and runtime for Universal Sandbox.

### Install

```
pnpm add @universal-sandbox/core
```

### Usage

```ts
import { UniversalSandbox } from "@universal-sandbox/core";
import { SpritesProvider } from "@universal-sandbox/sprites";

const sandbox = new UniversalSandbox({
  provider: new SpritesProvider({ token: process.env.SPRITES_TOKEN }),
});

const sbx = await sandbox.create({ name: "my-sprite" });
const result = await sbx.exec("echo", ["hello"]);
```