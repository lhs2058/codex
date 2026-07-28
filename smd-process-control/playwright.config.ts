import { defineConfig } from "@playwright/test";

const externalServer = process.env.PLAYWRIGHT_EXTERNAL_SERVER === "true";

export default defineConfig({
  testDir: "./tests/e2e",
  reporter: "line",
  webServer: externalServer ? undefined : {
    command: "node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173",
    env: { VITE_RESPONSIVE_TEST: "true" },
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: "chrome",
    screenshot: "only-on-failure",
  },
});
