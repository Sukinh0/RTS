import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../config/balance';
import { FIXED_STEP_MS } from '../../config/runtime';
import { FixedStepClock } from './FixedStepClock';
import { SeededRng } from './SeededRng';
import { Simulation } from './Simulation';

describe('Fase 0 foundation', () => {
  it('loads central balance configuration', () => {
    expect(BALANCE.map.width).toBe(200);
    expect(BALANCE.map.height).toBe(200);
    expect(BALANCE.startingState.workers).toBe(2);
  });

  it('runs the same ticks for different frame partitions', () => {
    const a = new FixedStepClock();
    const b = new FixedStepClock();
    let aCalls = 0;
    let bCalls = 0;
    a.advance(FIXED_STEP_MS * 3, () => { aCalls += 1; });
    for (let i = 0; i < 3; i += 1) b.advance(FIXED_STEP_MS, () => { bCalls += 1; });
    expect([a.ticks, aCalls]).toEqual([3, 3]);
    expect([b.ticks, bCalls]).toEqual([3, 3]);
  });

  it('rejects invalid elapsed time', () => {
    expect(() => new FixedStepClock().advance(-1, () => {})).toThrow(RangeError);
  });

  it('repeats a seeded random sequence', () => {
    const first = new SeededRng(123);
    const second = new SeededRng(123);
    const other = new SeededRng(124);
    const sample = Array.from({ length: 10 }, () => first.next());
    expect(sample).toEqual(Array.from({ length: 10 }, () => second.next()));
    expect(sample).not.toEqual(Array.from({ length: 10 }, () => other.next()));
    expect(sample.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('advances headlessly', () => {
    const simulation = new Simulation(123);
    expect(simulation.advance(FIXED_STEP_MS * 2)).toBe(2);
    expect(simulation.clock.ticks).toBe(2);
  });
});
