import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Avoid missing-asset HTTP requests on licensed-pack-free CI and public demos.
  // Restart Vite after installing the official ZIP on a local machine.
  define: {
    __TINY_SWORDS_INSTALLED__: JSON.stringify(existsSync(resolve(
      process.cwd(), 'public/assets/tiny-swords/Units/Yellow Units/Pawn/Pawn_Idle.png',
    ))),
  },
  base: process.env.RTS_BASE_PATH ?? '/',
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
