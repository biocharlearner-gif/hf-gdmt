import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Forward the Patient Management module's FHIR calls to the Bun BFF
    // (server/index.ts) so they stay same-origin and the tenant Bearer token is
    // injected server-side. Point at a different BFF port via VITE_BFF_TARGET.
    proxy: {
      '/api': {
        target: process.env.VITE_BFF_TARGET || 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  test: {
    // Git worktrees under .claude/ are full checkouts, so their test files match the
    // default include glob and get collected alongside the real ones — duplicating every
    // suite and letting an unrelated worktree fail this one. Spread the defaults rather
    // than replacing them: `exclude` overwrites, and dropping node_modules/dist from it
    // would have vitest crawl the whole dependency tree.
    exclude: [...configDefaults.exclude, '**/.claude/worktrees/**'],
  },
})
