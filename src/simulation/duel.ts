import { Simulation } from '../core/game/Simulation';
import { DEFAULT_STRATEGY, LEGACY_STRATEGY, type AIStrategy } from '../core/ai/AIStrategy';
import type { Team } from '../map/MapGrid';

export interface DuelReport {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Wins count 1 and draws 0.5, divided by games. 0.5 means equal strength. */
  score: number;
  winsBySide: Record<Team, number>;
  medianDecidedSeconds: number | null;
}

/** Every seed is played twice so the challenger fights from both sides of the map. */
export function runDuel(
  challenger: AIStrategy, seeds: readonly number[], maxSeconds = 1200, opponent: AIStrategy = LEGACY_STRATEGY,
): DuelReport {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  const winsBySide: Record<Team, number> = { blue: 0, red: 0 };
  const durations: number[] = [];
  for (const seed of seeds) {
    for (const side of ['blue', 'red'] as const) {
      const simulation = new Simulation(seed);
      for (const team of ['blue', 'red'] as const) simulation.enableAI(team, team === side ? challenger : opponent);
      let second = 0;
      for (; second < maxSeconds && !simulation.result; second += 1) {
        simulation.advance(1000);
        simulation.movement.drainEvents();
        simulation.movement.drainFailures();
        simulation.map.drainDirtyCells();
        simulation.combat.drainEvents();
      }
      if (!simulation.result) draws += 1;
      else {
        durations.push(second);
        if (simulation.result.winner === side) {
          wins += 1;
          winsBySide[side] += 1;
        } else losses += 1;
      }
    }
  }
  const games = seeds.length * 2;
  durations.sort((a, b) => a - b);
  return {
    games, wins, losses, draws, score: (wins + draws / 2) / games, winsBySide,
    medianDecidedSeconds: durations[durations.length >> 1] ?? null,
  };
}

export function runCli(args: string[]): void {
  const options = new Map(args.map((arg) => {
    const match = /^--(games|seed|max-seconds|strategy)=(.+)$/.exec(arg);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    return [match[1], match[2]];
  }));
  const games = Number(options.get('games') ?? 40);
  const seed = Number(options.get('seed') ?? 1000);
  const maxSeconds = Number(options.get('max-seconds') ?? 1200);
  if (!Number.isSafeInteger(games) || games < 2 || games % 2) throw new RangeError('games must be an even integer');
  const overrides = JSON.parse(options.get('strategy') ?? '{}') as Partial<AIStrategy>;
  for (const key of Object.keys(overrides)) {
    if (!(key in LEGACY_STRATEGY)) throw new Error(`Unknown strategy parameter: ${key}`);
  }
  const challenger: AIStrategy = { ...DEFAULT_STRATEGY, ...overrides };
  const report = runDuel(challenger, Array.from({ length: games / 2 }, (_, i) => seed + i), maxSeconds);
  process.stdout.write(`${JSON.stringify({ challenger, ...report })}\n`);
}
