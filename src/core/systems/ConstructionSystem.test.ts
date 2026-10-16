import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../config/balance';
import { FIXED_STEP_MS, TICKS_PER_SECOND } from '../../config/runtime';
import { Simulation } from '../game/Simulation';
import type { BuildingEntity } from '../entities/EntityStore';

function advanceSeconds(simulation: Simulation, seconds: number): void {
  simulation.advance(FIXED_STEP_MS * TICKS_PER_SECOND * seconds);
}

describe('Fase 6 construction', () => {
  it('limits house and barracks placement to 80 cells from the base center', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 500;
    simulation.teams.blue.wood = 500;
    for (const buildingKind of ['house', 'barracks'] as const) {
      expect(simulation.issueCommand({
        type: 'build', team: 'blue', builderId: 'blue-worker-1', buildingKind, position: [102, 101],
      })).toEqual({ accepted: false, reason: 'out-of-build-range' });
    }
    expect(simulation.teams.blue).toEqual({ coins: 500, wood: 500, stone: 0 });

    const candidates: Array<[number, number]> = [[101, 101], [21, 181], [21, 21],
      [69, 165], [69, 37], [85, 149], [85, 53]];
    const spot = candidates.find(([x, y]) => simulation.entities.isAreaFreeForBuilding(x, y, 2, 2)
      && simulation.entities.isFreeForUnit(x - 1, y, 'blue-worker-1'));
    expect(spot).toBeDefined();
    expect(simulation.entities.moveUnit('blue-worker-1', spot![0] - 1, spot![1])).toBe(true);
    simulation.fog.update();
    expect(simulation.issueCommand({
      type: 'build', team: 'blue', builderId: 'blue-worker-1', buildingKind: 'house', position: spot!,
    })).toEqual({ accepted: true });
  });

  it('validates costs and rejects when resources are insufficient', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 50;
    simulation.teams.blue.wood = 0;
    const result = simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: 'blue-worker-1',
      buildingKind: 'house',
      position: [24, 96],
    });
    expect(result).toEqual({ accepted: false, reason: 'insufficient-coins' });

    simulation.teams.blue.coins = 200;
    const woodResult = simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: 'blue-worker-1',
      buildingKind: 'house',
      position: [24, 96],
    });
    expect(woodResult).toEqual({ accepted: false, reason: 'insufficient-wood' });
  });

  it('rejects construction on blocked terrain or overlapping entities', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 500;
    simulation.teams.blue.wood = 500;

    // Mountain / water / structure overlap
    // Starting base is at (20, 100) with size 4x4
    const overlapBase = simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: 'blue-worker-1',
      buildingKind: 'house',
      position: [21, 101],
    });
    expect(overlapBase).toEqual({ accepted: false, reason: 'blocked' });

    // Cell occupied by worker at (25, 99)
    const overlapWorker = simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: 'blue-worker-2',
      buildingKind: 'house',
      position: [25, 99],
    });
    expect(overlapWorker).toEqual({ accepted: false, reason: 'blocked' });
  });

  it('builds a house with construction timer and releases builder upon completion', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 300;
    simulation.teams.blue.wood = 200;

    const startCoins = simulation.teams.blue.coins;
    const startWood = simulation.teams.blue.wood;

    // Valid plain spot in blue territory
    const result = simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: 'blue-worker-1',
      buildingKind: 'house',
      position: [24, 96],
    });
    expect(result).toEqual({ accepted: true });

    // Resources deducted immediately
    expect(simulation.teams.blue.coins).toBe(startCoins - BALANCE.buildings.house.coins);
    expect(simulation.teams.blue.wood).toBe(startWood - BALANCE.buildings.house.wood);

    // Footprint is immediately blocked
    expect(simulation.map.isPassable(24, 96)).toBe(false);
    expect(simulation.map.isPassable(25, 97)).toBe(false);

    const house = simulation.entities.all().find((e): e is BuildingEntity => e.category === 'building' && e.kind === 'house');
    expect(house).toBeDefined();
    expect(house?.underConstruction).toBe(true);

    // Advance 4 seconds (halfway through 8s build time)
    advanceSeconds(simulation, 4);
    expect(house?.underConstruction).toBe(true);
    expect(simulation.construction.taskFor('blue-worker-1')).not.toBeNull();

    // Advance remaining build time + buffer
    advanceSeconds(simulation, 6);
    expect(house?.underConstruction).toBe(false);
    expect(house?.hp).toBe(BALANCE.buildings.house.hp);
    expect(simulation.construction.taskFor('blue-worker-1')).toBeNull();

    // Builder is freed and can move
    advanceSeconds(simulation, 3);
    expect(simulation.issueCommand({
      type: 'move',
      team: 'blue',
      unitId: 'blue-worker-1',
      destination: [26, 96],
    }).accepted).toBe(true);
  });

  it('builds a barracks with 12s timer and 3x3 footprint', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 500;
    simulation.teams.blue.wood = 500;

    const result = simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: 'blue-worker-1',
      buildingKind: 'barracks',
      position: [21, 96],
    });
    expect(result).toEqual({ accepted: true });

    const barracks = simulation.entities.all().find((e): e is BuildingEntity => e.category === 'building' && e.kind === 'barracks');
    expect(barracks).toBeDefined();
    expect(barracks?.width).toBe(3);
    expect(barracks?.height).toBe(3);
    expect(barracks?.underConstruction).toBe(true);

    advanceSeconds(simulation, 13);
    expect(barracks?.underConstruction).toBe(false);
    expect(barracks?.hp).toBe(BALANCE.buildings.barracks.hp);
  });
});
