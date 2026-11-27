import { describe, expect, it } from 'vitest';
import { DEFAULT_STRATEGY, LEGACY_STRATEGY } from '../core/ai/AIStrategy';
import { createState, DRAW_POINTS, runGeneration, tally, type TrainingConfig } from './evolution';
import { decode, encode, GENES, sanitizeStrategy } from './genome';
import type { MatchJob, MatchOutcome } from './match';
import { renderReport } from './report';

const config: TrainingConfig = { population: 16, seedsPerOpponent: 3, promotionSeeds: 10, benchmarkSeeds: 4, maxSeconds: 1200 };

/** Stand-in game with a known best answer: bigger first wave wins. */
const fakeRun = async (jobs: MatchJob[]): Promise<MatchOutcome[]> => jobs.map(({ challenger, opponent, side }) => ({
  side, seconds: 100,
  result: challenger.waveSize > opponent.waveSize ? 'win' : challenger.waveSize < opponent.waveSize ? 'loss' : 'draw',
}));

describe('training', () => {
  it('round-trips the built-in strategies through the genome', () => {
    for (const strategy of [DEFAULT_STRATEGY, LEGACY_STRATEGY]) expect(decode(encode(strategy))).toEqual(strategy);
  });

  it('keeps any vector and any loaded file inside legal values', () => {
    for (const x of [-5, 0, 0.5, 1, 9]) {
      const decoded = decode(GENES.map(() => x));
      expect(sanitizeStrategy(decoded)).toEqual(decoded);
    }
    expect(sanitizeStrategy({ waveSize: 9999, route: 'teleport', trainScout: 'sim', extra: 1 })).toEqual(DEFAULT_STRATEGY);
    expect(sanitizeStrategy(null)).toEqual(DEFAULT_STRATEGY);
    expect(sanitizeStrategy({ waveSize: 5 }).waveSize).toBe(5);
  });

  it('scores a win far above a draw', () => {
    const result = tally([
      { result: 'win', side: 'blue', seconds: 1 }, { result: 'draw', side: 'red', seconds: 1 },
      { result: 'loss', side: 'red', seconds: 1 }, { result: 'win', side: 'red', seconds: 1 },
    ]);
    expect(result).toMatchObject({ wins: 2, draws: 1, losses: 1, winsBlue: 1, winsRed: 1, score: (2 + DRAW_POINTS) / 4 });
  });

  it('learns what wins, promotes champions and resumes identically from a saved state', async () => {
    let state = createState(42);
    for (let i = 0; i < 6; i += 1) state = await runGeneration(state, config, fakeRun);
    expect(state.champion.waveSize).toBeGreaterThan(DEFAULT_STRATEGY.waveSize + 2);
    expect(state.championVersion).toBeGreaterThan(0);
    const restored = JSON.parse(JSON.stringify(state)) as typeof state;
    expect(await runGeneration(restored, config, fakeRun)).toEqual(await runGeneration(state, config, fakeRun));
    expect(renderReport(state, 60, false)).toContain('<svg');
  });

  it('never trains on the benchmark seeds', async () => {
    const seeds: number[] = [];
    await runGeneration({ ...createState(7), benchmark: createState(7).benchmark }, config, async (jobs) => {
      seeds.push(...jobs.filter((job) => job.seed >= 900_000).map((job) => job.seed));
      return fakeRun(jobs);
    });
    expect(new Set(seeds).size).toBe(config.benchmarkSeeds);
  });

  it('keeps the champion when no challenger proves to be better', async () => {
    const state = await runGeneration(createState(3), config, async (jobs) => jobs.map(
      ({ side }) => ({ side, seconds: 1200, result: 'draw' as const })));
    expect(state.championVersion).toBe(0);
    expect(state.champion).toEqual(DEFAULT_STRATEGY);
  });
});
