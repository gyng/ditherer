import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    plugins: { react },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      // Relaxed for migration — tighten over time
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-console": "off",
      "no-unused-vars": "off",
    },
  },
  {
    ignores: ["build/", "node_modules/", "src/wasm/"],
  },
];
