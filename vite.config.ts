import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: process.env.RTS_PAGES_BASE || '/',
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
