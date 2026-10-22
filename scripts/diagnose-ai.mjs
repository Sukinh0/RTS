import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/simulation/aiDiagnostics.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const source = bundle.outputFiles[0].text;
const { diagnoseAI } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--(seed|seconds|interval)=(\d+)$/.exec(arg);
  if (!match) throw new Error(`Unknown argument: ${arg}`);
  return [match[1], Number(match[2])];
}));
for (const line of diagnoseAI(args.seed ?? 123, args.seconds ?? 900, args.interval ?? 120)) {
  process.stdout.write(line + '\n');
}
