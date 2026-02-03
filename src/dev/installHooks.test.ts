import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("install-hooks.sh", () => {
  it("writes an executable pre-commit hook with fast checks", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "hooks-"));
    const hooksDir = join(tempRoot, "hooks");

    execFileSync("bash", ["scripts/dev/install-hooks.sh"], {
      env: {
        ...process.env,
        HOOKS_DIR: hooksDir,
      },
    });

    const hookPath = join(hooksDir, "pre-commit");
    const contents = readFileSync(hookPath, "utf8");

    expect(contents).toContain("pnpm test");
    expect(contents).toContain("pnpm build");
    expect(contents).toContain("SKIP_PRECOMMIT");

    const mode = statSync(hookPath).mode;
    expect(mode & 0o111).not.toBe(0);
  });
});
