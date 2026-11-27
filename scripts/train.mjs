import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Worker threads need a real file, so the bundle goes to a temporary folder.
const folder = await mkdtemp(join(tmpdir(), 'rts-treino-'));
const bundle = join(folder, 'train.mjs');
try {
  await build({
    entryPoints: [resolve(import.meta.dirname, '../src/training/train.ts')],
    bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent',
  });
  const { runCli } = await import(pathToFileURL(bundle).href);
  await runCli(process.argv.slice(2), bundle);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await rm(folder, { recursive: true, force: true });
}
