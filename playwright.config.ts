import { defineConfig, devices } from "@playwright/test";

// E2E ต้องเปิด stack ก่อน: bash scripts/e2e-stack.sh แล้ว build + start แอปด้วย .env.e2e (ดู scripts/e2e.sh)
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", locale: "th-TH", timezoneId: "Asia/Bangkok", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
