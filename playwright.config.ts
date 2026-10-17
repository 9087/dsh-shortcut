import { defineConfig } from '@playwright/test'

/**
 * Real-browser E2E for dsh-shortcut.
 *
 * These tests drive the actual DSH Web GUI in Chromium, with a throwaway
 * `DSH_HOME` (see `e2e/helpers/host.ts`), so they never touch the user's own
 * sessions, their plugins, or the GUI on port 3080. They are deliberately NOT
 * part of `pnpm test`: the suite needs a downloaded Chromium and a bootable
 * `dsh`, so it runs only through `pnpm run e2e`.
 *
 * One worker, no parallelism: every test in the file shares one host process
 * and one page, and the later tests build on the story the earlier ones told
 * (capture, then deliver, then manage, then restart).
 */
export default defineConfig({
  testDir: 'e2e',
  // A test's first step can be a cold `dsh web` boot plus a Chromium launch.
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    viewport: { width: 1400, height: 900 },
    trace: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium' }],
})
