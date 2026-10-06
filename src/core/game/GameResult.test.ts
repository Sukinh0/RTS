import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS } from '../../config/runtime';
import { Simulation } from './Simulation';
import type { Team } from '../../map/MapGrid';

describe('Fase 9: fim de partida', () => {
  it.each([
    ['blue', 'red', 174, 100],
    ['red', 'blue', 25, 100],
  ] as const)('encerra imediatamente quando %s destrói a base %s', (winner, loser, x, y) => {
    const simulation = new Simulation(123, true);
    const attacker = simulation.entities.spawnUnit(winner, 'soldier', x, y);
    const base = simulation.entities.get(`${loser}-base`)!;
    base.hp = 5;
    simulation.fog.update();

    expect(simulation.issueCommand({ type: 'attack', team: winner, unitId: attacker.id, targetId: base.id }))
      .toEqual({ accepted: true });
    expect(simulation.result).toMatchObject({ winner, loser, elapsedTicks: 0 });
    expect(simulation.entities.get(base.id)).toBeUndefined();

    const resources = { ...simulation.teams[winner] };
    expect(simulation.advance(FIXED_STEP_MS * 60)).toBe(0);
    expect(simulation.clock.ticks).toBe(0);
    expect(simulation.teams[winner]).toEqual(resources);
    expect(simulation.issueCommand({ type: 'move', team: winner as Team, unitId: attacker.id, destination: [x - 1, y] }))
      .toEqual({ accepted: false, reason: 'game-over' });
  });
});
