import { DEFAULT_STRATEGY } from '../core/ai/AIStrategy';
import { GENES } from './genome';
import type { Tally, TrainingState } from './evolution';

const percent = (value: number) => `${Math.round(value * 100)}%`;

function chart(state: TrainingState): string {
  const points = state.history;
  if (points.length === 0) return '<p>Aguardando a primeira geração.</p>';
  const x = (i: number) => 40 + (points.length === 1 ? 0 : i * 720 / (points.length - 1));
  const y = (score: number) => 220 - score * 200;
  const line = (color: string, pick: (i: number) => number) => `<polyline fill="none" stroke="${color}" stroke-width="2" points="${points.map((_, i) => `${x(i)},${y(pick(i))}`).join(' ')}"/>`
    + points.map((_, i) => `<circle cx="${x(i)}" cy="${y(pick(i))}" r="2.5" fill="${color}"/>`).join('');
  const grid = [0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1="40" x2="760" y1="${y(v)}" y2="${y(v)}" stroke="#ddd"/><text x="4" y="${y(v) + 4}" font-size="11">${percent(v)}</text>`).join('');
  return `<svg viewBox="0 0 780 235" role="img" aria-label="Taxa de vitória da campeã por geração">${grid}${
    line('#1668dc', (i) => points[i].benchmark.againstDefault.wins / games(points[i].benchmark.againstDefault))}${
    line('#d46b08', (i) => points[i].benchmark.againstLegacy.wins / games(points[i].benchmark.againstLegacy))}</svg>
  <p><span style="color:#1668dc">&#9632;</span> vitórias contra a IA atual &nbsp; <span style="color:#d46b08">&#9632;</span> vitórias contra a IA antiga</p>`;
}

const games = (t: Tally) => t.wins + t.losses + t.draws;

function row(label: string, t: Tally | undefined): string {
  if (!t) return '';
  return `<tr><td>${label}</td><td>${percent(t.wins / games(t))}</td><td>${t.wins} / ${t.losses} / ${t.draws}</td><td>${t.winsBlue} / ${t.winsRed}</td></tr>`;
}

export function renderReport(state: TrainingState, elapsedSeconds: number, running: boolean): string {
  const genes = GENES.map((gene) => {
    const now = state.champion[gene.key];
    const before = DEFAULT_STRATEGY[gene.key];
    return `<tr${now === before ? '' : ' class="changed"'}><td>${gene.key}</td><td>${before}</td><td>${now}</td></tr>`;
  }).join('');
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8">${running ? '<meta http-equiv="refresh" content="20">' : ''}
<title>Treino da IA</title><style>body{font:15px system-ui,sans-serif;max-width:820px;margin:24px auto;padding:0 12px}table{border-collapse:collapse;width:100%;margin:8px 0 24px}td,th{border:1px solid #ddd;padding:5px 8px;text-align:left}.changed{background:#fff7e6}svg{width:100%}</style>
<h1>Treino da IA</h1><p>${running ? 'Treinando (a página se atualiza sozinha).' : 'Treino parado.'} Geração <b>${state.generation}</b> · <b>${state.totalMatches}</b> partidas · nova campeã <b>${state.championVersion}</b> vez(es) · ${Math.round(elapsedSeconds / 60)} min nesta sessão.</p>
<h2>A campeã está melhorando?</h2><p>Medida em partidas com seeds fixas, que o treino nunca usa.</p>${chart(state)}
<table><tr><th>Campeã atual contra</th><th>Vitórias</th><th>V / D / E</th><th>Vitórias azul / vermelho</th></tr>${row('IA atual do jogo', state.benchmark?.againstDefault)}${row('IA antiga', state.benchmark?.againstLegacy)}</table>
<h3>Ponto de partida (antes do treino)</h3><table><tr><th>Contra</th><th>Vitórias</th><th>V / D / E</th><th>Vitórias azul / vermelho</th></tr>${row('IA atual do jogo', state.initialBenchmark?.againstDefault)}${row('IA antiga', state.initialBenchmark?.againstLegacy)}</table>
<h2>O que a campeã aprendeu</h2><table><tr><th>Decisão</th><th>IA atual</th><th>Campeã</th></tr>${genes}</table></html>`;
}
