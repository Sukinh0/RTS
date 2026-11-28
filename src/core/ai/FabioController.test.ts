import { describe, expect, it } from 'vitest';
import { Simulation } from '../game/Simulation';
import { habitsFor } from './FabioController';

function run(seed: number, seconds: number) {
  const simulation = new Simulation(seed);
  simulation.enableFabio('blue');
  const order: string[] = [];
  const seen = new Set<string>();
  for (let second = 0; second < seconds; second += 1) {
    simulation.advance(1000);
    simulation.movement.drainEvents();
    simulation.movement.drainFailures();
    simulation.map.drainDirtyCells();
    simulation.combat.drainEvents();
    for (const entity of simulation.entities.all()) {
      if (entity.team !== 'blue' || seen.has(entity.id)
        || (entity.category === 'building' && entity.underConstruction)) continue;
      seen.add(entity.id);
      order.push(entity.kind);
    }
  }
  return { simulation, order };
}

describe('Fabio opponent', () => {
  it('follows the opening from the questionnaire', () => {
    const { order } = run(100, 480);
    const first = (kind: string) => order.indexOf(kind);
    const workers = order.map((kind, index) => (kind === 'worker' ? index : -1)).filter((index) => index >= 0);
    // The two starting workers, then: house, third worker, barracks.
    expect(first('house')).toBeLessThan(workers[2]);
    expect(workers[2]).toBeLessThan(first('barracks'));
    expect(first('barracks')).toBeLessThan(first('builder'));
    expect(first('barracks')).toBeLessThan(first('soldier'));
    const secondHouse = order.indexOf('house', first('house') + 1);
    expect(order.slice(0, secondHouse).filter((kind) => kind === 'soldier')).toHaveLength(2);
  });

  it('varies its habits by seed within what he described, and repeats for the same seed', () => {
    const all = Array.from({ length: 40 }, (_, seed) => habitsFor(seed, 'red'));
    expect(new Set(all.map((habits) => habits.soldiersBeforeBuilder))).toEqual(new Set([0, 1]));
    expect(new Set(all.map((habits) => habits.attackArmy))).toEqual(new Set([6, 7]));
    expect(habitsFor(7, 'red')).toEqual(habitsFor(7, 'red'));
  });

  it('plays only through accepted commands and is deterministic', () => {
    const snapshot = () => {
      const { simulation } = run(102, 420);
      return JSON.stringify([simulation.stats.snapshot(), simulation.teams.blue]);
    };
    expect(snapshot()).toBe(snapshot());
  });
});
