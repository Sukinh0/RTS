import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BALANCE } from '../config/balance';
import { TICKS_PER_SECOND } from '../config/runtime';
import { Simulation } from '../core/game/Simulation';
import type { Team } from '../map/MapGrid';

export interface MatchReport {
  seed: number;
  aiOrder: 'blue-first' | 'red-first';
  winner: Team | null;
  durationSeconds: number;
  firstBarracksSeconds: Record<Team, number | null>;
  firstHouseSeconds: Record<Team, number | null>;
  firstMilitarySeconds: Record<Team, number | null>;
  firstStoneSeconds: Record<Team, number | null>;
  firstTowerSeconds: Record<Team, number | null>;
  firstBarricadeSeconds: Record<Team, number | null>;
  firstCombatSeconds: number | null;
  firstBaseAttackSeconds: number | null;
  baseAttacks: Record<Team, number>;
  baseDamageDealt: Record<Team, number>;
  attacks: Record<Team, number>;
  damage: Record<Team, number>;
  finalUnits: Record<Team, number>;
  finalCoins: Record<Team, number>;
  finalWood: Record<Team, number>;
  finalStone: Record<Team, number>;
  baseHp: Record<Team, number>;
}

export interface TournamentReport {
  balanceVersion: string;
  games: number;
  initialSeed: number;
  maxSeconds: number;
  wins: Record<Team, number>;
  draws: number;
  averageDurationSeconds: number;
  medianDurationSeconds: number;
  matches: MatchReport[];
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

export function runMatch(seed: number, maxSeconds = 900, aiOrder: MatchReport['aiOrder'] = 'blue-first'): MatchReport {
  const simulation = new Simulation(seed);
  if (aiOrder === 'blue-first') {
    simulation.enableAI('blue');
    simulation.enableAI('red');
  } else {
    simulation.enableAI('red');
    simulation.enableAI('blue');
  }
  const firstBarracksSeconds: Record<Team, number | null> = { blue: null, red: null };
  const firstHouseSeconds: Record<Team, number | null> = { blue: null, red: null };
  const firstMilitarySeconds: Record<Team, number | null> = { blue: null, red: null };
  const firstStoneSeconds: Record<Team, number | null> = { blue: null, red: null };
  const firstTowerSeconds: Record<Team, number | null> = { blue: null, red: null };
  const firstBarricadeSeconds: Record<Team, number | null> = { blue: null, red: null };
  const attacks: Record<Team, number> = { blue: 0, red: 0 };
  const damage: Record<Team, number> = { blue: 0, red: 0 };
  const baseAttacks: Record<Team, number> = { blue: 0, red: 0 };
  const baseDamageDealt: Record<Team, number> = { blue: 0, red: 0 };
  let firstCombatSeconds: number | null = null;
  let firstBaseAttackSeconds: number | null = null;

  for (let second = 1; second <= maxSeconds && !simulation.result; second += 1) {
    simulation.advance(1000);
    simulation.movement.drainEvents();
    simulation.movement.drainFailures();
    simulation.map.drainDirtyCells();
    const elapsed = simulation.clock.ticks / TICKS_PER_SECOND;
    for (const event of simulation.combat.drainEvents()) {
      const team = event.attackerTeam as Team;
      attacks[team] += 1;
      damage[team] += event.damage;
      if (firstCombatSeconds === null) firstCombatSeconds = elapsed;
      if (event.targetId === `${event.targetTeam}-base`) {
        baseAttacks[team]++;
        baseDamageDealt[team] += event.damage;
        if (firstBaseAttackSeconds === null) firstBaseAttackSeconds = elapsed;
      }
    }
    for (const team of ['blue', 'red'] as const) {
      const entities = simulation.entities.all().filter((entity) => entity.team === team);
      if (firstBarracksSeconds[team] === null && entities.some((entity) => entity.kind === 'barracks' && entity.category === 'building' && !entity.underConstruction)) {
        firstBarracksSeconds[team] = elapsed;
      }
      if (firstHouseSeconds[team] === null && entities.some((entity) => entity.kind === 'house' && entity.category === 'building' && !entity.underConstruction)) {
        firstHouseSeconds[team] = elapsed;
      }
      if (firstMilitarySeconds[team] === null && entities.some((entity) => entity.category === 'unit' && entity.kind !== 'worker' && entity.kind !== 'builder')) {
        firstMilitarySeconds[team] = elapsed;
      }
      if (firstStoneSeconds[team] === null && (simulation.teams[team].stone > 0 || simulation.stats.snapshot()[team].stoneCollected > 0)) {
        firstStoneSeconds[team] = elapsed;
      }
      if (firstTowerSeconds[team] === null && entities.some((entity) => entity.kind === 'tower' && entity.category === 'building' && !entity.underConstruction)) {
        firstTowerSeconds[team] = elapsed;
      }
      if (firstBarricadeSeconds[team] === null && entities.some((entity) => entity.kind === 'barricade' && entity.category === 'building' && !entity.underConstruction)) {
        firstBarricadeSeconds[team] = elapsed;
      }
    }
  }

  const entities = simulation.entities.all();
  const baseHp = (team: Team): number => simulation.entities.get(`${team}-base`)?.hp ?? 0;
  return {
    seed,
    aiOrder,
    winner: simulation.result?.winner ?? null,
    durationSeconds: rounded(simulation.clock.ticks / TICKS_PER_SECOND),
    firstBarracksSeconds,
    firstHouseSeconds,
    firstMilitarySeconds,
    firstStoneSeconds,
    firstTowerSeconds,
    firstBarricadeSeconds,
    firstCombatSeconds,
    firstBaseAttackSeconds,
    baseAttacks,
    baseDamageDealt,
    attacks,
    damage,
    finalUnits: {
      blue: entities.filter((entity) => entity.team === 'blue' && entity.category === 'unit').length,
      red: entities.filter((entity) => entity.team === 'red' && entity.category === 'unit').length,
    },
    finalCoins: { blue: simulation.teams.blue.coins, red: simulation.teams.red.coins },
    finalWood: { blue: simulation.teams.blue.wood, red: simulation.teams.red.wood },
    finalStone: { blue: simulation.teams.blue.stone, red: simulation.teams.red.stone },
    baseHp: { blue: baseHp('blue'), red: baseHp('red') },
  };
}

export function runTournament(
  games = 100, initialSeed = 123, maxSeconds = 900,
  onMatch?: (completed: number, match: MatchReport) => void,
): TournamentReport {
  if (!Number.isSafeInteger(games) || games < 1 || games > 1000) throw new RangeError('games must be an integer from 1 to 1000');
  if (!Number.isSafeInteger(initialSeed)) throw new RangeError('seed must be a safe integer');
  if (!Number.isSafeInteger(maxSeconds) || maxSeconds < 1) throw new RangeError('max-seconds must be a positive integer');
  const matches: MatchReport[] = [];
  for (let index = 0; index < games; index += 1) {
    const match = runMatch(initialSeed + Math.floor(index / 2), maxSeconds,
      index % 2 === 0 ? 'blue-first' : 'red-first');
    matches.push(match);
    onMatch?.(index + 1, match);
  }
  const durations = matches.map((match) => match.durationSeconds).sort((a, b) => a - b);
  return {
    balanceVersion: BALANCE.version,
    games,
    initialSeed,
    maxSeconds,
    wins: {
      blue: matches.filter((match) => match.winner === 'blue').length,
      red: matches.filter((match) => match.winner === 'red').length,
    },
    draws: matches.filter((match) => match.winner === null).length,
    averageDurationSeconds: rounded(average(durations)),
    medianDurationSeconds: rounded(durations[Math.floor((games - 1) / 2)] + durations[Math.floor(games / 2)]) / 2,
    matches,
  };
}

function markdown(report: TournamentReport): string {
  const lines = [
    '# Simulação IA vs IA — Fase 10', '',
    `- Balanceamento: ${report.balanceVersion}`,
    `- Partidas: ${report.games}`,
    `- Seeds: ${report.initialSeed} a ${report.initialSeed + Math.ceil(report.games / 2) - 1}`,
    '- Cada seed é executada duas vezes, alternando a ordem de ativação da IA.',
    `- Limite por partida: ${report.maxSeconds}s`,
    `- Vitórias azuis: ${report.wins.blue}`,
    `- Vitórias vermelhas: ${report.wins.red}`,
    `- Empates por tempo: ${report.draws}`,
    `- Duração média: ${report.averageDurationSeconds}s`,
    `- Duração mediana: ${report.medianDurationSeconds}s`,
    '', '## Marcos médios', '',
    '| Marco | Azul | Vermelho |', '|---|---:|---:|',
    `| Primeiro quartel | ${rounded(average(report.matches.flatMap((m) => m.firstBarracksSeconds.blue === null ? [] : [m.firstBarracksSeconds.blue])))}s | ${rounded(average(report.matches.flatMap((m) => m.firstBarracksSeconds.red === null ? [] : [m.firstBarracksSeconds.red])))}s |`,
    `| Primeira casa | ${rounded(average(report.matches.flatMap((m) => m.firstHouseSeconds.blue === null ? [] : [m.firstHouseSeconds.blue])))}s | ${rounded(average(report.matches.flatMap((m) => m.firstHouseSeconds.red === null ? [] : [m.firstHouseSeconds.red])))}s |`,
    `| Primeira tropa | ${rounded(average(report.matches.flatMap((m) => m.firstMilitarySeconds.blue === null ? [] : [m.firstMilitarySeconds.blue])))}s | ${rounded(average(report.matches.flatMap((m) => m.firstMilitarySeconds.red === null ? [] : [m.firstMilitarySeconds.red])))}s |`,
    `| Primeira pedra | ${rounded(average(report.matches.flatMap((m) => m.firstStoneSeconds.blue === null ? [] : [m.firstStoneSeconds.blue])))}s | ${rounded(average(report.matches.flatMap((m) => m.firstStoneSeconds.red === null ? [] : [m.firstStoneSeconds.red])))}s |`,
    `| Primeira torre | ${rounded(average(report.matches.flatMap((m) => m.firstTowerSeconds.blue === null ? [] : [m.firstTowerSeconds.blue])))}s | ${rounded(average(report.matches.flatMap((m) => m.firstTowerSeconds.red === null ? [] : [m.firstTowerSeconds.red])))}s |`,
    `| Primeira barricada | ${rounded(average(report.matches.flatMap((m) => m.firstBarricadeSeconds.blue === null ? [] : [m.firstBarricadeSeconds.blue])))}s | ${rounded(average(report.matches.flatMap((m) => m.firstBarricadeSeconds.red === null ? [] : [m.firstBarricadeSeconds.red])))}s |`,
    `| Ataques por partida | ${rounded(average(report.matches.map((m) => m.attacks.blue)))} | ${rounded(average(report.matches.map((m) => m.attacks.red)))} |`,
    `| Dano por partida | ${rounded(average(report.matches.map((m) => m.damage.blue)))} | ${rounded(average(report.matches.map((m) => m.damage.red)))} |`,
    `| Ataques à base por partida | ${rounded(average(report.matches.map((m) => m.baseAttacks.blue)))} | ${rounded(average(report.matches.map((m) => m.baseAttacks.red)))} |`,
    `| Dano à base por partida | ${rounded(average(report.matches.map((m) => m.baseDamageDealt.blue)))} | ${rounded(average(report.matches.map((m) => m.baseDamageDealt.red)))} |`,
    `| Pedra final média | ${rounded(average(report.matches.map((m) => m.finalStone.blue)))} | ${rounded(average(report.matches.map((m) => m.finalStone.red)))} |`,
    '', '## Partidas', '',
    '| Seed | Ordem IA | Resultado | Duração | 1ª tropa azul | 1ª tropa vermelha | 1ª pedra azul | 1ª pedra vermelha | 1º combate | HP base azul | HP base vermelha |',
    '|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...report.matches.map((m) => `| ${m.seed} | ${m.aiOrder} | ${m.winner ?? 'empate'} | ${m.durationSeconds}s | ${m.firstMilitarySeconds.blue ?? '—'} | ${m.firstMilitarySeconds.red ?? '—'} | ${m.firstStoneSeconds.blue ?? '—'} | ${m.firstStoneSeconds.red ?? '—'} | ${m.firstCombatSeconds ?? '—'} | ${m.baseHp.blue} | ${m.baseHp.red} |`),
    '',
  ];
  return lines.join('\n');
}

export async function runCli(args: string[]): Promise<void> {
  const options = new Map(args.map((arg) => {
    const match = /^--(games|seed|max-seconds|out)=(.+)$/.exec(arg);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    return [match[1], match[2]];
  }));
  const games = Number(options.get('games') ?? 100);
  const seed = Number(options.get('seed') ?? 123);
  const maxSeconds = Number(options.get('max-seconds') ?? 900);
  const out = options.get('out') ?? 'reports';
  const report = runTournament(games, seed, maxSeconds, (completed) => {
    if (completed % 10 === 0 || completed === games) process.stdout.write(`Simuladas ${completed}/${games} partidas\n`);
  });
  await mkdir(out, { recursive: true });
  const stem = `simulation-${games}games-seed${seed}`;
  const jsonPath = join(out, `${stem}.json`);
  const mdPath = join(out, `${stem}.md`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  await writeFile(mdPath, markdown(report), 'utf8');
  process.stdout.write(`IA vs IA: ${games} partidas, azul ${report.wins.blue}, vermelho ${report.wins.red}, empates ${report.draws}, duração média ${report.averageDurationSeconds}s\n`);
  process.stdout.write(`Relatórios: ${jsonPath} e ${mdPath}\n`);
}
