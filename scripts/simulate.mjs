import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/simulation/tournament.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const source = bundle.outputFiles[0].text;
const { runCli } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
await runCli(process.argv.slice(2));
