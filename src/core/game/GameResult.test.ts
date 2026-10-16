import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS } from '../../config/runtime';
import { BALANCE } from '../../config/balance';
import { Simulation } from './Simulation';
import type { Team } from '../../map/MapGrid';

describe('Fase 9: fim de partida', () => {
  it('reports production, combat and resource transactions for both teams', () => {
    const simulation = new Simulation(123);
    simulation.teams.blue.coins = 500;
    simulation.teams.blue.wood = 500;
    expect(simulation.issueCommand({ type: 'build', team: 'blue', builderId: 'blue-worker-1',
      buildingKind: 'house', position: [24, 96] })).toEqual({ accepted: true });
    const house = simulation.entities.all().find((entity) => entity.team === 'blue' && entity.kind === 'house')!;
    simulation.advance(FIXED_STEP_MS * 30 * 12);
    expect(simulation.issueCommand({ type: 'produce', team: 'blue', buildingId: house.id,
      unitKind: 'worker' })).toEqual({ accepted: true });
    const barracks = simulation.entities.createBuilding('blue', 'barracks', 30, 100);
    expect(simulation.issueCommand({ type: 'produce', team: 'blue', buildingId: barracks.id,
      unitKind: 'soldier' })).toEqual({ accepted: true });
    simulation.advance(FIXED_STEP_MS * 30 * 7);

    const attacker = simulation.entities.spawnUnit('blue', 'soldier', 170, 100);
    const victim = simulation.entities.spawnUnit('red', 'soldier', 171, 100);
    victim.hp = attacker.damage;
    simulation.fog.update();
    expect(simulation.issueCommand({ type: 'attack', team: 'blue', unitId: attacker.id,
      targetId: victim.id })).toEqual({ accepted: true });

    const finisher = simulation.entities.spawnUnit('blue', 'soldier', 174, 100);
    const base = simulation.entities.get('red-base')!;
    base.hp = finisher.damage;
    simulation.fog.update();
    expect(simulation.issueCommand({ type: 'attack', team: 'blue', unitId: finisher.id,
      targetId: base.id })).toEqual({ accepted: true });

    expect(simulation.result?.stats.blue).toMatchObject({
      workersProduced: 1, troopsProduced: 1, troopsKilled: 1,
      coinsSpent: BALANCE.buildings.house.coins + BALANCE.units.worker.coins + BALANCE.units.soldier.coins,
      woodSpent: BALANCE.buildings.house.wood,
    });
    expect(simulation.result?.stats.blue.coinsCollected).toBeGreaterThan(0);
    expect(simulation.result?.stats.red.troopsKilled).toBe(0);
    expect(simulation.result?.stats.red.coinsCollected).toBeGreaterThan(0);
  });
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
