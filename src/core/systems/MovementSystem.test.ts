import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS, TICKS_PER_SECOND } from '../../config/runtime';
import { findPath } from '../../map/findPath';
import { dispatchGroupMove } from '../commands/dispatchGroupMove';
import { Simulation } from '../game/Simulation';

function move(simulation: Simulation, unitId: string, x: number, y: number) {
  return simulation.issueCommand({ type: 'move', team: 'blue', unitId, destination: [x, y] });
}

describe('Fase 3 movement', () => {
  it('rejects water, mountain, building and occupied destinations', () => {
    const simulation = new Simulation(1);
    for (const [x, y] of [[76, 40], [90, 30], [20, 100], [25, 101]]) {
      expect(move(simulation, 'blue-worker-1', x, y)).toEqual({ accepted: false, reason: 'invalid-destination' });
    }
    expect(simulation.entities.get('blue-worker-1')).toMatchObject({ x: 25, y: 99 });
  });

  it('enforces ownership and stable unit IDs', () => {
    const simulation = new Simulation(1);
    expect(move(simulation, 'red-worker-1', 170, 99)).toEqual({ accepted: false, reason: 'wrong-owner' });
    expect(move(simulation, 'missing', 30, 99)).toEqual({ accepted: false, reason: 'unknown-unit' });
    expect(move(simulation, 'blue-base', 30, 99)).toEqual({ accepted: false, reason: 'unknown-unit' });
  });

  it('moves at most the configured range per action and waits for cooldown', () => {
    const simulation = new Simulation(1);
    expect(move(simulation, 'blue-worker-1', 36, 99)).toEqual({ accepted: true });
    simulation.advance(FIXED_STEP_MS);
    expect(simulation.entities.get('blue-worker-1')).toMatchObject({ x: 30, y: 99 });
    expect(move(simulation, 'blue-worker-1', 40, 99)).toEqual({ accepted: false, reason: 'cooldown' });
    simulation.advance(FIXED_STEP_MS * (3 * TICKS_PER_SECOND - 1));
    expect(simulation.entities.get('blue-worker-1')).toMatchObject({ x: 30, y: 99 });
    simulation.advance(FIXED_STEP_MS);
    expect(simulation.entities.get('blue-worker-1')).toMatchObject({ x: 35, y: 99 });
    expect(simulation.clock.ticks).toBe(3 * TICKS_PER_SECOND + 1);
  });

  it('does not move into a newly occupied cell', () => {
    const simulation = new Simulation(1);
    expect(simulation.entities.moveUnit('blue-worker-2', 30, 99)).toBe(true);
    expect(move(simulation, 'blue-worker-1', 30, 99)).toEqual({ accepted: false, reason: 'invalid-destination' });
    expect(simulation.entities.moveUnit('blue-worker-1', 30, 99)).toBe(false);
  });

  it('routes around an intermediate unit without passing through it', () => {
    const simulation = new Simulation(1);
    expect(simulation.entities.moveUnit('blue-worker-2', 27, 99)).toBe(true);
    const path = findPath(simulation.map, [25, 99], [30, 99],
      (x, y) => simulation.entities.isFreeForUnit(x, y, 'blue-worker-1'));
    expect(path).not.toBeNull();
    expect(path).not.toContainEqual([27, 99]);
    expect(move(simulation, 'blue-worker-1', 30, 99)).toEqual({ accepted: true });
    simulation.advance(FIXED_STEP_MS);
    expect(simulation.entities.get('blue-worker-1')).not.toMatchObject({ x: 27, y: 99 });
  });

  it('assigns distinct cells to a selected group through the command API', () => {
    const simulation = new Simulation(1);
    const results = dispatchGroupMove(simulation, 'blue', ['blue-worker-1', 'blue-worker-2'], [40, 99]);
    expect(results.every(({ result }) => result.accepted)).toBe(true);
    const first = simulation.entities.get('blue-worker-1');
    const second = simulation.entities.get('blue-worker-2');
    expect(first?.category === 'unit' && second?.category === 'unit' && first.moveTarget).not.toEqual(second?.category === 'unit' && second.moveTarget);
    simulation.advance(FIXED_STEP_MS);
    expect([first?.x, first?.y]).not.toEqual([second?.x, second?.y]);
  });
});
