import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false, // one shared draft — the spec owns its ordering
  workers: 1,
  use: { baseURL: 'http://localhost:5173' },
  // Chromium AND WebKit. The league drafts from phones, and on iOS every
  // browser is WebKit — so a suite that only ran Chromium was never testing
  // the engine most of the room uses on the one night it matters.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @fa/dev-api start',
      port: 8787,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @fa/web dev',
      port: 5173,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
