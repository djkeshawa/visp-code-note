import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * The repository is split across three TypeScript projects (extension host, webview
 * bundles, tests). Listing all three lets type-aware rules resolve every source file,
 * including the ones shared between projects.
 */
const TS_PROJECTS = ["tsconfig.json", "tsconfig.webview.json", "tsconfig.test.json"];

export default tseslint.config(
  {
    ignores: [
      "out/**",
      "out-tests/**",
      "media/scripts/**",
      "media/codicons/**",
      "node_modules/**",
    ],
  },
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: TS_PROJECTS,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "separate-type-imports", disallowTypeAnnotations: false },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": "error",
    },
  },
  {
    // Extension host: Node runtime, may use the vscode API.
    files: ["src/extension.ts", "src/vscode/**/*.ts", "src/indexing/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    // Webviews: browser runtime, must never reach for the vscode API.
    files: ["src/webview/**/*.ts"],
    languageOptions: { globals: globals.browser },
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "vscode", message: "Webview code must stay free of the vscode API." }] },
      ],
    },
  },
  {
    files: ["test/**/*.ts"],
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      // node:test returns a promise callers are not expected to await.
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            { from: "package", package: "node:test", name: ["test", "it", "describe", "suite"] },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.mjs"],
    extends: [js.configs.recommended, tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
);
