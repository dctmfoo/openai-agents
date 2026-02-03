import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("dead code checks", () => {
  it("wires Knip config and script", () => {
    const root = process.cwd();
    const pkgRaw = readFileSync(join(root, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(pkg.scripts?.["check:deadcode"]).toBe("knip");
    expect(pkg.devDependencies?.knip).toBeDefined();

    const knipRaw = readFileSync(join(root, "knip.json"), "utf8");
    const knip = JSON.parse(knipRaw) as {
      entry?: string[];
      project?: string[];
      tags?: string[];
    };

    expect(knip.entry).toEqual(
      expect.arrayContaining([
        "src/interfaces/telegram/start.ts",
        "src/interfaces/cli/run.ts",
        "src/gateway/start.ts",
      ]),
    );

    expect(knip.project).toEqual(
      expect.arrayContaining([
        "src/**/*.ts",
        "!dist/**",
        "!node_modules/**",
        "!apps/admin/src-tauri/target/**",
      ]),
    );

    expect(knip.tags).toEqual(expect.arrayContaining(["-lintignore"]));
  });
});
