import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const todoToken = "TODO" as const;
const fixmeToken = "FIXME" as const;
type DebtToken = typeof todoToken | typeof fixmeToken;

export type TodoViolation = {
  file: string;
  line: number;
  column: number;
  token: DebtToken;
  lineText: string;
};

const tokenPattern = new RegExp(`\\b(${todoToken}|${fixmeToken})\\b`, "g");
const allowedPattern = new RegExp(
  `^(${todoToken}|${fixmeToken})\\([^\\s)]+\\):`,
);
const ignoredDirs = new Set([
  ".git",
  ".pnpm-store",
  ".turbo",
  "archive",
  "coverage",
  "dist",
  "logs",
  "memory",
  "node_modules",
  "reports",
  "tasks",
]);

const isBinary = (buffer: Buffer) => buffer.includes(0);

export const collectTodoViolations = (rootDir: string): TodoViolation[] => {
  const violations: TodoViolation[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        continue;
      }

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ignoredDirs.has(entry.name)) {
          continue;
        }
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      scanFile(fullPath, rootDir, violations);
    }
  };

  walk(rootDir);

  return violations;
};

const scanFile = (
  filePath: string,
  rootDir: string,
  violations: TodoViolation[],
) => {
  const buffer = readFileSync(filePath);
  if (isBinary(buffer)) {
    return;
  }

  const text = buffer.toString("utf8");
  const lines = text.split(/\r?\n/);
  const relativePath = relative(rootDir, filePath) || filePath;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    tokenPattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = tokenPattern.exec(line)) !== null) {
      const token = match[1] as TodoViolation["token"];
      const slice = line.slice(match.index);

      if (!allowedPattern.test(slice)) {
        violations.push({
          file: relativePath,
          line: index + 1,
          column: match.index + 1,
          token,
          lineText: line.trimEnd(),
        });
      }
    }
  }
};

const isCliInvocation = () => {
  if (!process.argv[1]) {
    return false;
  }
  return pathToFileURL(process.argv[1]).href === import.meta.url;
};

if (isCliInvocation()) {
  const rootDir = process.cwd();
  const violations = collectTodoViolations(rootDir);

  if (violations.length === 0) {
    process.stdout.write("No TODO/FIXME convention violations found.\n");
    process.exit(0);
  }

  process.stderr.write("Tech debt marker convention violations:\n");
  for (const violation of violations) {
    const todoExample = `${todoToken}(<ref>):`;
    const fixmeExample = `${fixmeToken}(<ref>):`;
    process.stderr.write(
      `- ${violation.file}:${violation.line}:${violation.column} ${violation.token} must use ${todoExample} or ${fixmeExample}\n` +
        `  ${violation.lineText}\n`,
    );
  }
  process.exit(1);
}
