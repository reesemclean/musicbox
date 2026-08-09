import { defineConfig } from 'vitest/config'

// Deliberately separate from vite.config.ts. The tests here are pure logic —
// they import no React and no database. Reusing the app config would drag the
// TanStack Start and Nitro plugin chain into the test run, which builds server
// environments that then fail to evaluate CJS dependencies (react,
// better-sqlite3) and leave the Vite server hanging at teardown.
export default defineConfig({
  // `@/` still has to resolve here, or the first test to import it fails in a
  // way that looks nothing like the missing config that caused it.
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // Matches .tsx too: with --passWithNoTests, a pattern that missed component
    // tests would skip them silently rather than fail.
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
