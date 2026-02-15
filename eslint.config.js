import sonarjs from "eslint-plugin-sonarjs";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";

const complexityThreshold = 15;

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".ralph-worktrees/**",
      "apps/admin/src-tauri/target/**",
    ],
  },
  {
    files: ["**/*.{js,cjs,mjs,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      sonarjs,
    },
    rules: {
      complexity: ["warn", complexityThreshold],
      "sonarjs/cognitive-complexity": ["warn", complexityThreshold],
    },
  },
];
