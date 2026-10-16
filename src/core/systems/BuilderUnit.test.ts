import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../config/balance';
import { FIXED_STEP_MS, TICKS_PER_SECOND } from '../../config/runtime';
import { Simulation } from '../game/Simulation';
import type { BuildingEntity, UnitEntity } from '../entities/EntityStore';

function advanceSeconds(simulation: Simulation, seconds: number): void {
  simulation.advance(FIXED_STEP_MS * TICKS_PER_SECOND * seconds);
}

describe('Fase 2 — Unidade Construtor', () => {
  it('house produces builder using production queue', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 500;
    simulation.teams.blue.wood = 500;

    // Build and complete a house
    simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: 'blue-worker-1',
      buildingKind: 'house',
      position: [24, 96],
    });
    advanceSeconds(simulation, 10);
    const house = simulation.entities.all().find((e): e is BuildingEntity => e.category === 'building' && e.kind === 'house')!;
    expect(house.underConstruction).toBe(false);

    const coinsBefore = simulation.teams.blue.coins;
    const produceResult = simulation.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: house.id,
      unitKind: 'builder',
    });
    expect(produceResult).toEqual({ accepted: true });
    expect(simulation.teams.blue.coins).toBe(coinsBefore - BALANCE.units.builder.coins);
    expect(simulation.production.queueFor(house.id).length).toBe(1);

    // Builder takes 6 seconds to complete
    advanceSeconds(simulation, BALANCE.units.builder.productionSeconds);
    const builder = simulation.entities.all().find((e): e is UnitEntity => e.category === 'unit' && e.kind === 'builder');
    expect(builder).toBeDefined();
    expect(builder?.team).toBe('blue');
    expect(builder?.hp).toBe(BALANCE.units.builder.hp);
    expect(builder?.maxHp).toBe(BALANCE.units.builder.hp);
    expect(builder?.damage).toBe(0);
    expect(builder?.range).toBe(0);
    expect(builder?.vision).toBe(BALANCE.units.builder.vision);
    expect(builder?.movement).toBe(BALANCE.units.builder.movement);
    expect(simulation.production.queueFor(house.id).length).toBe(0);
  });

  it('builder does not generate passive gold', () => {
    const simulation = new Simulation(1);
    // Remove initial workers to isolate builder passive income
    const workers = simulation.entities.all().filter((e) => e.category === 'unit' && e.team === 'blue');
    for (const w of workers) {
      simulation.entities.remove(w.id);
    }

    const builder = simulation.entities.spawnUnit('blue', 'builder', 20, 96);
    expect(builder.kind).toBe('builder');

    simulation.teams.blue.coins = 100;
    advanceSeconds(simulation, 5);

    // Coins should remain exactly 100 because builders do not generate passive gold
    expect(simulation.teams.blue.coins).toBe(100);
  });

  it('builder cannot mine coins or gather resources (wood or stone)', () => {
    const simulation = new Simulation(1);
    const builder = simulation.entities.spawnUnit('blue', 'builder', 20, 96);

    // Try to mine gold
    const mineResult = simulation.issueCommand({
      type: 'mine',
      team: 'blue',
      unitId: builder.id,
      target: [28, 96],
    });
    expect(mineResult).toEqual({ accepted: false, reason: 'not-worker' });

    // Try to gather wood
    const woodResult = simulation.issueCommand({
      type: 'gather',
      team: 'blue',
      unitId: builder.id,
      target: [22, 92],
    });
    expect(woodResult).toEqual({ accepted: false, reason: 'not-worker' });

    // Try to gather stone
    const stoneResult = simulation.issueCommand({
      type: 'gather',
      team: 'blue',
      unitId: builder.id,
      target: [42, 70],
    });
    expect(stoneResult).toEqual({ accepted: false, reason: 'not-worker' });
  });

  it('builder can construct buildings', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 500;
    simulation.teams.blue.wood = 500;

    const builder = simulation.entities.spawnUnit('blue', 'builder', 23, 96);
    expect(builder.kind).toBe('builder');

    const buildResult = simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'house',
      position: [24, 96],
    });
    expect(buildResult).toEqual({ accepted: true });

    const house = simulation.entities.all().find((e): e is BuildingEntity => e.category === 'building' && e.kind === 'house')!;
    expect(house).toBeDefined();
    expect(house.underConstruction).toBe(true);

    // Let builder finish construction
    advanceSeconds(simulation, 10);
    expect(house.underConstruction).toBe(false);
  });

  it('builder death cancels active construction and records civilian loss in stats', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 500;
    simulation.teams.blue.wood = 500;

    const builder = simulation.entities.spawnUnit('blue', 'builder', 23, 96);
    simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'house',
      position: [24, 96],
    });

    expect(simulation.construction.taskFor(builder.id)).not.toBeNull();

    // Spawn an enemy soldier right next to builder to kill it
    const redSoldier = simulation.entities.spawnUnit('red', 'soldier', 23, 95);
    redSoldier.cooldownUntilTick = 0;
    simulation.fog.update();

    // Issue attack command against builder
    const attackResult = simulation.issueCommand({
      type: 'attack',
      team: 'red',
      unitId: redSoldier.id,
      targetId: builder.id,
    });
    expect(attackResult.accepted).toBe(true);

    // Soldier deals 6 dmg every 3s, builder has 10 hp -> dies after 2 attacks (approx 4s)
    advanceSeconds(simulation, 7);

    expect(simulation.entities.get(builder.id)).toBeUndefined();
    expect(simulation.construction.taskFor(builder.id)).toBeNull();

    // Check stats: red team should have 1 worker/civilian killed recorded
    expect(simulation.stats.snapshot().red.workersKilled).toBeGreaterThanOrEqual(1);
  });

  it('strictly enforces unit cap for builders', () => {
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
    // Spawn 57 soldiers to reach 59 total units
    for (let i = 0; i < 57; i += 1) {
      simulation.entities.spawnUnit('blue', 'soldier', 28 + (i % 10), 90 + Math.floor(i / 10));
    }
    expect(simulation.entities.all().filter((e) => e.category === 'unit' && e.team === 'blue').length).toBe(59);

    // 60th unit can be builder
    expect(simulation.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: house.id,
      unitKind: 'builder',
    }).accepted).toBe(true);

    // 61st unit is rejected
    const rejected = simulation.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: house.id,
      unitKind: 'builder',
    });
    expect(rejected).toEqual({ accepted: false, reason: 'unit-cap-reached' });
  });
});
