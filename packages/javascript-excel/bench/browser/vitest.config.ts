// Chromium benchmark of the worker send cost (bench/browser): npx vitest run --config bench/browser/vitest.config.ts
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, type ViteUserConfig } from "vitest/config";

const executablePath = process.env["JSE_CHROMIUM"];

const config: ViteUserConfig = defineConfig({
  test: {
    include: ["bench/browser/**/*.bench.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(executablePath ? { launchOptions: { executablePath } } : {}),
      instances: [{ browser: "chromium" }],
      screenshotFailures: false,
    },
  },
});

export default config;
