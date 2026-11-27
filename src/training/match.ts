import type { AIStrategy } from '../core/ai/AIStrategy';
import { SeededRng } from '../core/game/SeededRng';
import { Simulation } from '../core/game/Simulation';
import type { Team } from '../map/MapGrid';

export interface MatchJob {
  challenger: Readonly<AIStrategy>;
  opponent: Readonly<AIStrategy>;
  seed: number;
  side: Team;
  maxSeconds: number;
  /** false reproduces the game's exact timing. */
  variation?: boolean;
}

export interface MatchOutcome {
  result: 'win' | 'loss' | 'draw';
  side: Team;
  seconds: number;
}

/** One headless match, seen from the challenger. */
export function playMatch({ challenger, opponent, seed, side, maxSeconds, variation = true }: MatchJob): MatchOutcome {
  const simulation = new Simulation(seed);
  // Without this, two fixed strategies repeat the same two matches on every seed
  // and the training would only memorise them. Timing belongs to the colour, so
  // playing a seed from both sides stays fair.
  const timing = new SeededRng((seed ^ 0x5ca1ab1e) >>> 0);
  for (const team of ['blue', 'red'] as const) {
    const startDelayTicks = Math.floor(timing.next() * 151);
    const intervalTicks = 24 + Math.floor(timing.next() * 13);
    simulation.enableAI(team, team === side ? challenger : opponent,
      variation ? { startDelayTicks, intervalTicks } : {});
  }
  let seconds = 0;
  for (; seconds < maxSeconds && !simulation.result; seconds += 1) {
    simulation.advance(1000);
    simulation.movement.drainEvents();
    simulation.movement.drainFailures();
    simulation.map.drainDirtyCells();
    simulation.combat.drainEvents();
  }
  const winner = simulation.result?.winner;
  return { result: !winner ? 'draw' : winner === side ? 'win' : 'loss', side, seconds };
}
