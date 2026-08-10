// ESLint 9 flat config. `expo-module-scripts@~56` ships ESLint 9, which no longer reads
// `.eslintrc.js`; this replaces it.
const { defineConfig } = require("eslint/config");
const baseConfig = require("expo-module-scripts/eslint.config.base");

module.exports = defineConfig([
  { ignores: ["build/**", "example/**", "android/**"] },
  baseConfig,
]);
