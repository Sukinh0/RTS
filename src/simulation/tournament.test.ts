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

  it('reaches actual combat from starting resources without pre-spawned soldiers', () => {
    // Regression: both AIs previously waited for 3 reserves + a guard and never attacked.
    const match = runTournament(1, 123, 900).matches[0];
    expect(match.firstMilitarySeconds.blue).not.toBeNull();
    expect(match.firstMilitarySeconds.red).not.toBeNull();
    expect(match.firstCombatSeconds).not.toBeNull();
    expect(match.firstCombatSeconds!).toBeLessThan(900);
    expect(match.attacks.blue + match.attacks.red).toBeGreaterThan(0);
    expect(match.damage.blue + match.damage.red).toBeGreaterThan(0);
  }, 60_000);

  it('rejects invalid batch parameters', () => {
    expect(() => runTournament(0)).toThrow(RangeError);
    expect(() => runTournament(1, 123, 0)).toThrow(RangeError);
  });
});
