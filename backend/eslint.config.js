const globals = Object.fromEntries([
  "AbortController",
  "Blob",
  "Buffer",
  "URL",
  "URLSearchParams",
  "TextDecoder",
  "TextEncoder",
  "clearInterval",
  "clearTimeout",
  "console",
  "fetch",
  "process",
  "setInterval",
  "setTimeout",
  "structuredClone",
].map((name) => [name, "readonly"]));

export default [
  {
    ignores: [
      "data/**",
      "generated/**",
      "models/**",
      "node_modules/**",
      "graphify-out/**",
    ],
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals,
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        caughtErrors: "none",
        varsIgnorePattern: "^_",
      }],
    },
  },
];
