import { describe, expect, it } from "vitest";

import { UniversalSandbox } from "../../../core/src/index.js";
import { LocalProvider } from "../index.js";

describe("UniversalSandbox", () => {
  it("creates and gets sandboxes through the provider", async () => {
    const provider = new LocalProvider({ defaultName: "local-test" });
    const runtime = new UniversalSandbox({ provider });

    const created = await runtime.create({ name: "sbx-1" });
    const fetched = await runtime.get("sbx-1");

    expect(created.id).toBe("sbx-1");
    expect(fetched.id).toBe("sbx-1");
  });

  it("executes a command through the provider", async () => {
    const provider = new LocalProvider({ defaultName: "local-test" });
    const runtime = new UniversalSandbox({ provider });
    const sandbox = await runtime.create({ name: "sbx-2" });

    const result = await sandbox.exec("echo", ["hello"]);

    expect(result.stdout).toContain("hello");
    expect(result.exitCode).toBe(0);
  });
});
