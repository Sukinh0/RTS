/**
 * Cross-entropy evolution focused only on winning. Pure functions: the caller
 * supplies the match runner, so the same logic runs in tests and in workers.
 */
import { DEFAULT_STRATEGY, LEGACY_STRATEGY, type AIStrategy } from '../core/ai/AIStrategy';
import { SeededRng } from '../core/game/SeededRng';
import { decode, encode, GENES } from './genome';
import type { MatchJob, MatchOutcome } from './match';

export const WIN_POINTS = 1;
export const DRAW_POINTS = 0.25;
const SIDES = ['blue', 'red'] as const;
/** Training and promotion seeds stay below this; benchmark seeds start here and are never trained on. */
const BENCHMARK_SEED = 900_000;

export interface TrainingConfig {
  population: number;
  /** Seeds per opponent for each candidate; every seed is played from both sides. */
  seedsPerOpponent: number;
  promotionSeeds: number;
  benchmarkSeeds: number;
  maxSeconds: number;
}

export interface Tally { wins: number; losses: number; draws: number; winsBlue: number; winsRed: number; score: number }

export interface Benchmark { againstDefault: Tally; againstLegacy: Tally }

export interface GenerationRecord {
  generation: number;
  matches: number;
  bestTrainingScore: number;
  promoted: boolean;
  championVersion: number;
  /** Champion on fixed seeds never used in training: the comparable progress measure. */
  benchmark: Benchmark;
}

export interface TrainingState {
  mean: number[];
  spread: number[];
  rngSeed: number;
  generation: number;
  totalMatches: number;
  champion: AIStrategy;
  championVersion: number;
  hallOfFame: AIStrategy[];
  benchmark: Benchmark | null;
  initialBenchmark: Benchmark | null;
  history: GenerationRecord[];
}

export type RunMatches = (jobs: MatchJob[]) => Promise<MatchOutcome[]>;

export function createState(seed: number): TrainingState {
  return {
    mean: encode(DEFAULT_STRATEGY), spread: GENES.map(() => 0.25), rngSeed: seed >>> 0,
    generation: 0, totalMatches: 0, champion: { ...DEFAULT_STRATEGY }, championVersion: 0,
    hallOfFame: [{ ...LEGACY_STRATEGY }], benchmark: null, initialBenchmark: null, history: [],
  };
}

export function tally(outcomes: readonly MatchOutcome[]): Tally {
  const wins = outcomes.filter((o) => o.result === 'win');
  const draws = outcomes.filter((o) => o.result === 'draw').length;
  return {
    wins: wins.length, draws, losses: outcomes.length - wins.length - draws,
    winsBlue: wins.filter((o) => o.side === 'blue').length,
    winsRed: wins.filter((o) => o.side === 'red').length,
    score: outcomes.length ? (wins.length * WIN_POINTS + draws * DRAW_POINTS) / outcomes.length : 0,
  };
}

function jobsFor(
  challenger: Readonly<AIStrategy>, opponent: Readonly<AIStrategy>, seeds: readonly number[], maxSeconds: number,
): MatchJob[] {
  return seeds.flatMap((seed) => SIDES.map((side) => ({ challenger, opponent, seed, side, maxSeconds })));
}

/** Runs several groups as one batch so every processor stays busy. */
async function runGroups(run: RunMatches, groups: MatchJob[][]): Promise<MatchOutcome[][]> {
  const outcomes = await run(groups.flat());
  let offset = 0;
  return groups.map((group) => outcomes.slice(offset, offset += group.length));
}

async function benchmark(
  strategy: AIStrategy, config: TrainingConfig, run: RunMatches,
): Promise<{ result: Benchmark; matches: number }> {
  const seeds = Array.from({ length: config.benchmarkSeeds }, (_, i) => BENCHMARK_SEED + i);
  const [a, b] = await runGroups(run, [DEFAULT_STRATEGY, LEGACY_STRATEGY]
    .map((opponent) => jobsFor(strategy, opponent, seeds, config.maxSeconds)));
  return { result: { againstDefault: tally(a), againstLegacy: tally(b) }, matches: a.length + b.length };
}

/** One generation: sample, compete, learn from the best quarter and maybe replace the champion. */
export async function runGeneration(
  previous: TrainingState, config: TrainingConfig, run: RunMatches,
): Promise<TrainingState> {
  const state: TrainingState = structuredClone(previous);
  const rng = new SeededRng(state.rngSeed);
  let matches = 0;
  if (!state.benchmark) {
    const first = await benchmark(state.champion, config, run);
    state.benchmark = state.initialBenchmark = first.result;
    matches += first.matches;
  }
  const normal = () => Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next());
  const freshSeeds = (count: number) => Array.from({ length: count }, () => Math.floor(rng.next() * BENCHMARK_SEED));
  const candidates = Array.from({ length: config.population }, () => state.mean.map(
    (mean, i) => Math.min(1, Math.max(0, mean + normal() * state.spread[i]))));

  // Same opponents and seeds for everyone, so candidates are compared fairly.
  const rival = state.hallOfFame[Math.floor(rng.next() * state.hallOfFame.length)];
  const opponents = [state.champion, DEFAULT_STRATEGY, rival];
  const seeds = opponents.map(() => freshSeeds(config.seedsPerOpponent));
  const groups = await runGroups(run, candidates.map((vector) => opponents.flatMap(
    (opponent, i) => jobsFor(decode(vector), opponent, seeds[i], config.maxSeconds))));
  matches += groups.reduce((sum, group) => sum + group.length, 0);

  const ranked = candidates.map((vector, i) => ({ vector, score: tally(groups[i]).score }))
    .sort((a, b) => b.score - a.score);
  const elites = ranked.slice(0, Math.max(2, Math.round(config.population / 4)));
  const weights = elites.map((_, i) => Math.log(elites.length + 1) - Math.log(i + 1));
  const total = weights.reduce((sum, w) => sum + w, 0);
  state.mean = state.mean.map((old, gene) => {
    const target = elites.reduce((sum, elite, i) => sum + elite.vector[gene] * weights[i], 0) / total;
    return old * 0.3 + target * 0.7;
  });
  state.spread = state.spread.map((old, gene) => {
    const variance = elites.reduce((sum, elite, i) => sum + weights[i] * (elite.vector[gene] - state.mean[gene]) ** 2, 0) / total;
    // A floor keeps the search exploring instead of freezing on an early idea.
    return Math.max(0.08, old * 0.4 + Math.sqrt(variance) * 0.6);
  });

  // Promotion uses new seeds: winning the training matches alone may be luck.
  const challenger = decode(ranked[0].vector);
  const proof = freshSeeds(config.promotionSeeds);
  const [headToHead, challengerFixed, championFixed] = await runGroups(run, [
    jobsFor(challenger, state.champion, proof, config.maxSeconds),
    [DEFAULT_STRATEGY, LEGACY_STRATEGY].flatMap((o) => jobsFor(challenger, o, proof, config.maxSeconds)),
    [DEFAULT_STRATEGY, LEGACY_STRATEGY].flatMap((o) => jobsFor(state.champion, o, proof, config.maxSeconds)),
  ]);
  matches += headToHead.length + challengerFixed.length + championFixed.length;
  const duel = tally(headToHead);
  const promoted = duel.wins > duel.losses * 1.15
    && tally(challengerFixed).score >= tally(championFixed).score;
  if (promoted) {
    state.hallOfFame = [...state.hallOfFame, state.champion].slice(-12);
    state.champion = challenger;
    state.championVersion += 1;
    const next = await benchmark(challenger, config, run);
    state.benchmark = next.result;
    matches += next.matches;
  }

  state.generation += 1;
  state.totalMatches += matches;
  state.rngSeed = Math.floor(rng.next() * 4_294_967_296);
  state.history.push({
    generation: state.generation, matches, bestTrainingScore: ranked[0].score, promoted,
    championVersion: state.championVersion, benchmark: state.benchmark!,
  });
  return state;
}
