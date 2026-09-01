import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false, // one shared draft — the spec owns its ordering
  workers: 1,
  use: { baseURL: 'http://localhost:5173' },
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
