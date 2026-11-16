/// <reference types="node" />
// Real-browser tests (test/browser) with Vitest browser mode and Playwright Chromium.
//   npm run test:browser
// JSE_CHROMIUM points Playwright at a local Chromium binary instead of its own download.
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, type ViteUserConfig } from "vitest/config";

const executablePath = process.env["JSE_CHROMIUM"];

const config: ViteUserConfig = defineConfig({
  test: {
    include: ["test/browser/**/*.test.ts"],
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
