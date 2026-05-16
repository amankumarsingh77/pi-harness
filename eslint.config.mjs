import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";
import tseslint from "typescript-eslint";

const sourceFiles = ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}", "subagents/**/*.{ts,tsx}"];
const dashboardFiles = ["apps/dashboard/**/*.{ts,tsx,js,jsx}"];
const testFiles = [
  "apps/**/test/**/*.{ts,tsx}",
  "packages/**/test/**/*.{ts,tsx}",
  "subagents/**/test/**/*.{ts,tsx}",
  "apps/**/*.{test,spec}.{ts,tsx}",
  "packages/**/*.{test,spec}.{ts,tsx}",
  "subagents/**/*.{test,spec}.{ts,tsx}",
  "apps/**/e2e/**/*.{ts,tsx}",
  "apps/**/vitest*.config.ts",
  "packages/**/vitest*.config.ts",
];

const vitestGlobals = {
  afterAll: "readonly",
  afterEach: "readonly",
  beforeAll: "readonly",
  beforeEach: "readonly",
  describe: "readonly",
  expect: "readonly",
  it: "readonly",
  test: "readonly",
  vi: "readonly",
};

const scopedNextVitals = nextVitals.map((config) => {
  if ("ignores" in config) {
    return config;
  }

  return {
    ...config,
    files: dashboardFiles,
    settings: {
      ...config.settings,
      next: {
        rootDir: ["apps/dashboard/"],
      },
    },
  };
});

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.turbo/**",
      "**/.worktrees/**",
      "**/.harness/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.reports/**",
      "**/test-results/**",
      "**/*.d.ts",
      "**/*.tsbuildinfo",
      "pnpm-lock.yaml",
      "subagents/_vendored/**",
      "packages/db/migrations/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: sourceFiles,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        sourceType: "module",
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
          minimumDescriptionLength: 12,
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSAsExpression > TSUnknownKeyword",
          message: "Avoid double assertions through unknown; use a runtime type guard instead.",
        },
      ],
    },
  },
  {
    files: ["**/*.config.{js,mjs,cjs,ts}", "**/next.config.mjs", "**/postcss.config.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: dashboardFiles,
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: testFiles,
    languageOptions: {
      globals: {
        ...globals.node,
        ...vitestGlobals,
      },
    },
  },
  ...scopedNextVitals,
  {
    files: dashboardFiles,
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "@next/next/no-img-element": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
);
