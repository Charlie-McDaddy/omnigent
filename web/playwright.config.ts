import { defineConfig, devices } from "@playwright/test";
import { loadEnvLocal } from "./e2e/helpers/loadEnv";

loadEnvLocal();

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";
const cdp = process.env.PLAYWRIGHT_CDP_URL;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 60_000 },
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "off",
    ...(cdp ? { connectOptions: { wsEndpoint: cdp } } : {}),
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(cdp ? {} : { launchOptions: { headless: true } }),
      },
    },
  ],
});
