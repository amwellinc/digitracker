import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // A git worktree nested under .worktrees/ has its own node_modules, so
    // without this exclude vitest discovers and runs that copy's test files
    // too — two separate react-dom instances end up loaded in one process,
    // producing spurious "Invalid hook call" crashes unrelated to any real
    // code change.
    exclude: ['**/node_modules/**', '**/.worktrees/**'],
  },
})
