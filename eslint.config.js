import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "build/**",
      ".react-router/**",
      "drizzle/**",
      "node_modules/**",
      ".pg-embedded/**",
      "coverage/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        URL: "readonly",
        fetch: "readonly",
        globalThis: "readonly",
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@server/*", "@server"], message: "domain/ must not import server code" },
            { group: ["~/*", "~"], message: "domain/ must not import app code" },
            { group: ["react", "react-router", "pg", "drizzle-orm", "drizzle-orm/*"], message: "domain/ must have zero runtime deps" },
          ],
        },
      ],
    },
  },
  {
    files: ["app/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{ group: ["@server/*", "@server"], message: "app/components must not import server code" }],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
