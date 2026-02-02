import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("duplicate code checks", () => {
  it("wires jscpd config and script", () => {
    const root = process.cwd();
    const pkgRaw = readFileSync(join(root, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(pkg.scripts?.["check:dup"]).toBe("jscpd --config jscpd.json");
    expect(pkg.devDependencies?.jscpd).toBeDefined();

    const jscpdRaw = readFileSync(join(root, "jscpd.json"), "utf8");
    const jscpd = JSON.parse(jscpdRaw) as {
      ignore?: string[];
      reporters?: string[];
      minTokens?: number;
      minLines?: number;
    };

    expect(jscpd.reporters).toEqual(expect.arrayContaining(["console"]));
    expect(jscpd.minTokens).toBeGreaterThanOrEqual(50);
    expect(jscpd.minLines).toBeGreaterThanOrEqual(5);
    expect(jscpd.ignore).toEqual(
      expect.arrayContaining([
        "**/node_modules/**",
        "**/dist/**",
        "**/logs/**",
        "**/memory/**",
        "**/reports/**",
        "**/tasks/**",
        "**/archive/**",
        "**/docs/**",
      ]),
    );
  });
});
