import { describe, expect, it } from 'vitest';
import { runTournament } from './tournament';

describe('headless tournament', () => {
  it('runs seeded AI vs AI games and counts every result', () => {
    const first = runTournament(2, 123, 90);
    const second = runTournament(2, 123, 90);
    expect(first).toEqual(second);
    expect(first.matches.map((match) => [match.seed, match.aiOrder]))
      .toEqual([[123, 'blue-first'], [123, 'red-first']]);
    expect(first.wins.blue + first.wins.red + first.draws).toBe(2);
    expect(first.matches.every((match) => match.durationSeconds > 0 && match.durationSeconds <= 90)).toBe(true);
  });

  it('forces the real starting economies to initiate combat before fifteen minutes', () => {
    const result = runTournament(1, 123, 900).matches[0];
    expect(result.firstMilitarySeconds.blue).not.toBeNull();
    expect(result.firstMilitarySeconds.red).not.toBeNull();
    expect(result.firstCombatSeconds).not.toBeNull();
    expect(result.firstCombatSeconds!).toBeLessThan(900);
    expect(result.attacks.blue + result.attacks.red).toBeGreaterThan(0);
  }, 60_000);

  it('rejects invalid batch parameters', () => {
    expect(() => runTournament(0)).toThrow(RangeError);
    expect(() => runTournament(1, 123, 0)).toThrow(RangeError);
  });
});
