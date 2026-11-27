import { readFile, writeFile } from 'node:fs/promises';

const input = process.argv[2] ?? 'reports/performance/v1-3-combat.json';
const output = process.argv[3] ?? input.replace(/\.json$/, '-summary.md');
const data = JSON.parse(await readFile(input, 'utf8'));
if (!Array.isArray(data.results) || data.results.length === 0) throw new Error('Benchmark sem cenários');
const fmt = value => Number.isFinite(value) ? Number(value).toFixed(1) : 'n/d';
const rows = data.results.map(r => {
  const frame = r.metrics?.frameInterval ?? {};
  const mem = r.heapAfterGCBytes;
  return { load: r.unitsPerTeam, scenario: r.scenario, fps: r.fps, p95: frame.p95Ms,
    max: frame.maxMs, memory: mem, command: r.commandMs };
});
const baseline = new Map(rows.filter(r => r.load === Math.min(...rows.map(v => v.load))).map(r => [r.scenario, r]));
const lines = [
  '# RTS V1.3 — relatório comparativo de performance',
  '',
  `- Ambiente: ${data.cpu ?? 'não informado'} / ${data.gpu?.renderer ?? 'GPU não identificada'}`,
  `- Chromium: ${data.browser ?? 'não informado'}; headless: ${data.headless}; instrumentado: ${data.instrumented}`,
  `- Duração por cenário: ${data.durationMs ?? 'n/d'} ms. Amostras de FPS em CI não equivalem a GPU real.`,
  '',
  '| Unidades (por equipe) | Cenário | FPS | p95 frame (ms) | Máx. frame (ms) | Memória pós-GC (MiB) | Δ FPS vs menor carga |',
  '|---:|---|---:|---:|---:|---:|---:|',
];
for (const r of rows) {
  const base = baseline.get(r.scenario);
  const drop = base?.fps > 0 && Number.isFinite(r.fps) ? (r.fps / base.fps - 1) * 100 : NaN;
  lines.push(`| ${r.load} | ${r.scenario} | ${fmt(r.fps)} | ${fmt(r.p95)} | ${fmt(r.max)} | ${fmt(r.memory / 1048576)} | ${Number.isFinite(drop) ? (drop > 0 ? '+' : '') + fmt(drop) + '%' : 'n/d'} |`);
}
lines.push('', '## Observações automáticas', '');
const issues = [];
for (const r of rows) {
  if (Number.isFinite(r.p95) && r.p95 > 33.3) issues.push(`${r.load}v${r.load} ${r.scenario}: p95 do frame acima de 33,3 ms`);
}
if (data.errors?.length) issues.push(...data.errors.map(e => `Erro JS: ${e}`));
lines.push(...(issues.length ? issues.map(v => '- ' + v) : ['- Nenhum alerta automático identificado. Isso não substitui playtest nem benchmark com GPU física.']));
lines.push('', '## Próxima análise', '', 'Compare os perfis CPU por cenário; investigue renderização e efeitos quando o custo aparece em idle/combat, e simulação/pathfinding quando aparece em move/formation. Não atribua causalidade apenas pelo FPS.');
await writeFile(output, lines.join('\n') + '\n');
console.log(`Relatório: ${output}`);
