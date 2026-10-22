import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: process.env.RTS_BASE_PATH ?? '/',
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
