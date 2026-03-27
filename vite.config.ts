// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import { defineConfig } from "vite-plus"

export default defineConfig({
  // Oxlint — replaces Biome linting
  lint: {
    ignorePatterns: [
      "dist/**",
      "dist-test-page/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
    plugins: ["oxc", "typescript"],
    categories: {
      correctness: "warn",
    },
    rules: {
      "typescript/consistent-type-imports": "error",
    },
    options: {
      typeAware: false,
      typeCheck: false,
    },
    overrides: [
      {
        files: ["**/tests/**", "**/test-page/**"],
        rules: {
          "typescript/no-explicit-any": "off",
          "typescript/no-non-null-assertion": "off",
          "typescript/no-non-null-asserted-optional-chain": "off",
        },
      },
      {
        files: ["examples/**"],
        rules: {
          "typescript/no-explicit-any": "off",
          "typescript/no-non-null-assertion": "off",
        },
      },
    ],
  },

  // Oxfmt — replaces Biome formatting
  // Style: no semicolons, double quotes, 2-space indent, 80 cols, trailing commas
  fmt: {
    semi: false,
    singleQuote: false,
    printWidth: 80,
    tabWidth: 2,
    trailingComma: "all",
    ignorePatterns: [
      "dist/**",
      "dist-test-page/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "pnpm-lock.yaml",
    ],
  },

  // Pre-commit staged file checks
  staged: {
    "*.{js,ts,tsx,json}": "vp check --fix",
  },
})
