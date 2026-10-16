import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../config/balance';
import { FIXED_STEP_MS, TICKS_PER_SECOND } from '../../config/runtime';
import { Simulation } from '../game/Simulation';
import type { BuildingEntity } from '../entities/EntityStore';

function advanceSeconds(simulation: Simulation, seconds: number): void {
  simulation.advance(FIXED_STEP_MS * TICKS_PER_SECOND * seconds);
}

describe('Fase 3 — Sistema de Capacidade por Construções', () => {
  it('base provides initial +2 civilian capacity and 0 military capacity', () => {
    const simulation = new Simulation(1);
    const capacity = simulation.production.getCapacity('blue');

    expect(capacity.civilianCapacity).toBe(BALANCE.buildings.base.civilianCapacity);
    expect(capacity.civilianCapacity).toBe(2);
    expect(capacity.militaryCapacity).toBe(0);
    expect(capacity.civilianUnits).toBe(2); // 2 starting workers
    expect(capacity.militaryUnits).toBe(0);
    expect(capacity.totalUnits).toBe(2);
    expect(capacity.maxTotalUnits).toBe(60);
  });

  it('house adds +2 civilian capacity only upon completion', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 1000;
    simulation.teams.blue.wood = 1000;

    // Build house
    simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: 'blue-worker-1',
      buildingKind: 'house',
      position: [24, 96],
    });

    const house = simulation.entities.all().find((e): e is BuildingEntity => e.category === 'building' && e.kind === 'house')!;
    expect(house.underConstruction).toBe(true);

    // While under construction, house does not grant capacity
    let cap = simulation.production.getCapacity('blue');
    expect(cap.civilianCapacity).toBe(2);

    // Advance 8 seconds to finish construction
    advanceSeconds(simulation, 8);
    expect(house.underConstruction).toBe(false);

    // Completed house grants +2 civilian capacity
    cap = simulation.production.getCapacity('blue');
    expect(cap.civilianCapacity).toBe(4);
    expect(cap.militaryCapacity).toBe(0);
  });

  it('barracks adds +6 military capacity only upon completion', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 1000;
    simulation.teams.blue.wood = 1000;

    // Build barracks
    simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: 'blue-worker-1',
      buildingKind: 'barracks',
      position: [21, 96],
    });

    const barracks = simulation.entities.all().find((e): e is BuildingEntity => e.category === 'building' && e.kind === 'barracks')!;
    expect(barracks.underConstruction).toBe(true);

    // While under construction, military capacity is 0
    let cap = simulation.production.getCapacity('blue');
    expect(cap.militaryCapacity).toBe(0);

    // Advance 12 seconds to finish construction
    advanceSeconds(simulation, 12);
    expect(barracks.underConstruction).toBe(false);

    // Completed barracks grants +6 military capacity
    cap = simulation.production.getCapacity('blue');
    expect(cap.militaryCapacity).toBe(6);
    expect(cap.civilianCapacity).toBe(2);
  });

  it('blocks civilian production when civilian capacity is reached', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 1000;
    simulation.teams.blue.wood = 1000;

    // Create completed house
    const house = simulation.entities.createBuilding('blue', 'house', 24, 96, false);
    const cap = simulation.production.getCapacity('blue');
    expect(cap.civilianCapacity).toBe(4); // 2 from base + 2 from house
    expect(cap.civilianUnits).toBe(2); // 2 starting workers

    // Queue 1 worker (3rd civilian) -> accepted
    const r1 = simulation.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: house.id,
      unitKind: 'worker',
    });
    expect(r1).toEqual({ accepted: true });

    // Queue 1 builder (4th civilian) -> accepted
    const r2 = simulation.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: house.id,
      unitKind: 'builder',
    });
    expect(r2).toEqual({ accepted: true });

    // Queue 5th civilian -> rejected with civilian-capacity-reached
    const r3 = simulation.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: house.id,
      unitKind: 'worker',
    });
    expect(r3).toEqual({ accepted: false, reason: 'civilian-capacity-reached' });

    const r4 = simulation.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: house.id,
      unitKind: 'builder',
    });
    expect(r4).toEqual({ accepted: false, reason: 'civilian-capacity-reached' });
  });

  it('blocks military production when military capacity is reached', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 5000;
    simulation.teams.blue.wood = 1000;

    // Create completed barracks
    const barracks = simulation.entities.createBuilding('blue', 'barracks', 21, 96, false);
    const cap = simulation.production.getCapacity('blue');
    expect(cap.militaryCapacity).toBe(6);

    // Queue 6 military units of mixed composition
    expect(simulation.issueCommand({ type: 'produce', team: 'blue', buildingId: barracks.id, unitKind: 'soldier' })).toEqual({ accepted: true });
    expect(simulation.issueCommand({ type: 'produce', team: 'blue', buildingId: barracks.id, unitKind: 'archer' })).toEqual({ accepted: true });
    expect(simulation.issueCommand({ type: 'produce', team: 'blue', buildingId: barracks.id, unitKind: 'shieldbearer' })).toEqual({ accepted: true });
    expect(simulation.issueCommand({ type: 'produce', team: 'blue', buildingId: barracks.id, unitKind: 'scout' })).toEqual({ accepted: true });
    expect(simulation.issueCommand({ type: 'produce', team: 'blue', buildingId: barracks.id, unitKind: 'soldier' })).toEqual({ accepted: true });
    expect(simulation.issueCommand({ type: 'produce', team: 'blue', buildingId: barracks.id, unitKind: 'soldier' })).toEqual({ accepted: true });

    // 7th military unit -> rejected with military-capacity-reached
    const r7 = simulation.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: barracks.id,
      unitKind: 'soldier',
    });
    expect(r7).toEqual({ accepted: false, reason: 'military-capacity-reached' });
  });

  it('allows over-cap when building is destroyed: existing units survive and function, further production blocked', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 5000;
    simulation.teams.blue.wood = 1000;

    // Create completed barracks
    const barracks = simulation.entities.createBuilding('blue', 'barracks', 21, 96, false);

    // Spawn 6 soldiers directly for blue
    for (let i = 0; i < 6; i += 1) {
      simulation.entities.spawnUnit('blue', 'soldier', 28 + i, 95);
    }
    let cap = simulation.production.getCapacity('blue');
    expect(cap.militaryUnits).toBe(6);
    expect(cap.militaryCapacity).toBe(6);

    // Destroy the barracks
    simulation.entities.remove(barracks.id);

    // Existing soldiers DO NOT die
    const survivingSoldiers = simulation.entities.all().filter((e) => e.team === 'blue' && e.kind === 'soldier');
    expect(survivingSoldiers.length).toBe(6);
    for (const soldier of survivingSoldiers) {
      expect(soldier.hp).toBe(BALANCE.units.soldier.hp);
    }

    // Over-cap state: 6 military units / 0 capacity
    cap = simulation.production.getCapacity('blue');
    expect(cap.militaryUnits).toBe(6);
    expect(cap.militaryCapacity).toBe(0);

    // Create a new barracks (completed)
    const barracks2 = simulation.entities.createBuilding('blue', 'barracks', 21, 96, false);
    cap = simulation.production.getCapacity('blue');
    expect(cap.militaryCapacity).toBe(6);

    // Still at 6/6, so 7th unit is rejected
    expect(simulation.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: barracks2.id,
      unitKind: 'soldier',
    })).toEqual({ accepted: false, reason: 'military-capacity-reached' });
  });

  it('rebuilding capacity restores production ability', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 5000;
    simulation.teams.blue.wood = 1000;

    // Spawn 6 soldiers
    for (let i = 0; i < 6; i += 1) {
      simulation.entities.spawnUnit('blue', 'soldier', 28 + i, 95);
    }

    // Build first barracks -> gives 6 capacity (6/6)
    simulation.entities.createBuilding('blue', 'barracks', 21, 96, false);

    // Build second barracks -> gives 6 more capacity (total 12 capacity)
    const barracks2 = simulation.entities.createBuilding('blue', 'barracks', 25, 96, false);

    const cap = simulation.production.getCapacity('blue');
    expect(cap.militaryUnits).toBe(6);
    expect(cap.militaryCapacity).toBe(12);

    // Production is now unlocked!
    const res = simulation.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: barracks2.id,
      unitKind: 'archer',
    });
    expect(res).toEqual({ accepted: true });
  });

  it('strictly respects global 60 units cap even when specific capacity is available', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 10000;
    simulation.teams.blue.wood = 5000;

    // 1 base (2 civil cap) + 30 houses (60 civil cap) = 62 civil capacity
    for (let i = 0; i < 30; i += 1) {
      simulation.entities.createBuilding('blue', 'house', 10 + (i % 10) * 3, 10 + Math.floor(i / 10) * 3, false);
    }
    const house = simulation.entities.all().find((e): e is BuildingEntity => e.kind === 'house' && e.team === 'blue')!;

    // Spawn soldiers to reach 59 total units (2 workers + 57 soldiers = 59 units)
    for (let i = 0; i < 57; i += 1) {
      simulation.entities.spawnUnit('blue', 'soldier', 50 + (i % 10), 50 + Math.floor(i / 10));
    }
    const cap = simulation.production.getCapacity('blue');
    expect(cap.totalUnits).toBe(59);
    expect(cap.civilianUnits).toBe(2);
    expect(cap.civilianCapacity).toBe(62);

    // 60th unit is accepted (unit 60)
    expect(simulation.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: house.id,
      unitKind: 'worker',
    })).toEqual({ accepted: true });

    // 61st unit is rejected due to global unit cap, even though civilian cap is 3/62!
    const res = simulation.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: house.id,
      unitKind: 'worker',
    });
    expect(res).toEqual({ accepted: false, reason: 'unit-cap-reached' });
  });
});
