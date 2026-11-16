import { defineConfig, type ViteUserConfig } from "vitest/config";

const config: ViteUserConfig = defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Real-browser tests run with vitest.browser.config.ts (npm run test:browser).
    exclude: ["test/browser/**", "**/node_modules/**"],
  },
});

export default config;
