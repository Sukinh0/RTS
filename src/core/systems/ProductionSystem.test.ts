import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../config/balance';
import { FIXED_STEP_MS, TICKS_PER_SECOND } from '../../config/runtime';
import { Simulation } from '../game/Simulation';
import type { BuildingEntity } from '../entities/EntityStore';

function advanceSeconds(simulation: Simulation, seconds: number): void {
  simulation.advance(FIXED_STEP_MS * TICKS_PER_SECOND * seconds);
}

describe('Fase 6 production', () => {
  it('rejects production on under-construction buildings or invalid unit types', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 500;
    simulation.teams.blue.wood = 500;

    // Issue build house
    simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: 'blue-worker-1',
      buildingKind: 'house',
      position: [24, 96],
    });
    const house = simulation.entities.all().find((e): e is BuildingEntity => e.category === 'building' && e.kind === 'house')!;

    // Cannot produce while under construction
    const resultUnderConstruction = simulation.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: house.id,
      unitKind: 'worker',
    });
    expect(resultUnderConstruction).toEqual({ accepted: false, reason: 'under-construction' });

    // Complete construction
    advanceSeconds(simulation, 10);
    expect(house.underConstruction).toBe(false);

    // House cannot produce soldier
    const resultInvalidKind = simulation.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: house.id,
      unitKind: 'soldier',
    });
    expect(resultInvalidKind).toEqual({ accepted: false, reason: 'invalid-unit-kind' });
  });

  it('queues workers in house, deducts costs immediately, and spawns adjacent', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 500;
    simulation.teams.blue.wood = 500;

    simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: 'blue-worker-1',
      buildingKind: 'house',
      position: [24, 96],
    });
    advanceSeconds(simulation, 10);
    const house = simulation.entities.all().find((e): e is BuildingEntity => e.category === 'building' && e.kind === 'house')!;

    const coinsBefore = simulation.teams.blue.coins;
    const initialWorkers = simulation.entities.all().filter((e) => e.category === 'unit' && e.team === 'blue').length;

    // Queue worker
    const produceResult = simulation.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: house.id,
      unitKind: 'worker',
    });
    expect(produceResult).toEqual({ accepted: true });
    expect(simulation.teams.blue.coins).toBe(coinsBefore - BALANCE.units.worker.coins);
    expect(simulation.production.queueFor(house.id).length).toBe(1);

    // Queue second worker
    simulation.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: house.id,
      unitKind: 'worker',
    });
    expect(simulation.production.queueFor(house.id).length).toBe(2);

    // Worker production is 6 seconds
    advanceSeconds(simulation, 6);
    const workersAfterFirst = simulation.entities.all().filter((e) => e.category === 'unit' && e.team === 'blue').length;
    expect(workersAfterFirst).toBe(initialWorkers + 1);
    expect(simulation.production.queueFor(house.id).length).toBe(1);

    // Second worker completes 6 seconds later
    advanceSeconds(simulation, 6);
    const workersAfterSecond = simulation.entities.all().filter((e) => e.category === 'unit' && e.team === 'blue').length;
    expect(workersAfterSecond).toBe(initialWorkers + 2);
    expect(simulation.production.queueFor(house.id).length).toBe(0);
  });

  it('barracks produces military units', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 800;
    simulation.teams.blue.wood = 500;

    simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: 'blue-worker-1',
      buildingKind: 'barracks',
      position: [21, 96],
    });
    advanceSeconds(simulation, 14);
    const barracks = simulation.entities.all().find((e): e is BuildingEntity => e.category === 'building' && e.kind === 'barracks')!;
    expect(barracks.underConstruction).toBe(false);

    // Produce soldier (5s)
    expect(simulation.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: barracks.id,
      unitKind: 'soldier',
    }).accepted).toBe(true);

    advanceSeconds(simulation, 6);
    const soldier = simulation.entities.all().find((e) => e.category === 'unit' && e.kind === 'soldier');
    expect(soldier).toBeDefined();
    expect(soldier?.team).toBe('blue');
    expect(soldier?.hp).toBe(BALANCE.units.soldier.hp);
  });

  it('strictly enforces 60 units cap including queue', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 10000;
    simulation.teams.blue.wood = 5000;

    simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: 'blue-worker-1',
      buildingKind: 'house',
      position: [24, 96],
    });
    advanceSeconds(simulation, 10);
    const house = simulation.entities.all().find((e): e is BuildingEntity => e.category === 'building' && e.kind === 'house')!;

    // Starting units for blue: 2 workers
    // Spawn 57 more units to reach 59
    for (let i = 0; i < 57; i += 1) {
      simulation.entities.spawnUnit('blue', 'soldier', 28 + (i % 10), 90 + Math.floor(i / 10));
    }
    const totalUnits = simulation.entities.all().filter((e) => e.category === 'unit' && e.team === 'blue').length;
    expect(totalUnits).toBe(59);

    // 60th unit can be queued
    expect(simulation.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: house.id,
      unitKind: 'worker',
    }).accepted).toBe(true);

    // 61st unit is rejected because unit cap is reached
    const rejected = simulation.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: house.id,
      unitKind: 'worker',
    });
    expect(rejected).toEqual({ accepted: false, reason: 'unit-cap-reached' });
  });

  it('base does not produce units (workers require houses)', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 500;
    simulation.teams.blue.wood = 500;
    const base = simulation.entities.get('blue-base') as BuildingEntity;
    expect(base).toBeDefined();

    const produceResult = simulation.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: base.id,
      unitKind: 'worker',
    });
    expect(produceResult).toEqual({ accepted: false, reason: 'invalid-unit-kind' });
  });
});
