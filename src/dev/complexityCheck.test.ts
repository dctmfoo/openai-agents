import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("complexity checks", () => {
  it("wires ESLint complexity config and script", () => {
    const root = process.cwd();
    const pkgRaw = readFileSync(join(root, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(pkg.scripts?.["check:complexity"]).toBe("eslint .");
    expect(pkg.devDependencies?.eslint).toBeDefined();
    expect(pkg.devDependencies?.["@typescript-eslint/parser"]).toBeDefined();
    expect(pkg.devDependencies?.["eslint-plugin-sonarjs"]).toBeDefined();

    const eslintConfigRaw = readFileSync(
      join(root, "eslint.config.js"),
      "utf8",
    );

    expect(eslintConfigRaw).toContain("const complexityThreshold = 15;");
    expect(eslintConfigRaw).toContain('complexity: ["warn", complexityThreshold]');
    expect(eslintConfigRaw).toContain(
      '"sonarjs/cognitive-complexity": ["warn", complexityThreshold]',
    );
  });
});
