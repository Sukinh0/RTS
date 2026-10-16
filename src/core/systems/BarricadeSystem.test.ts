import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../config/balance';
import { FIXED_STEP_MS, TICKS_PER_SECOND } from '../../config/runtime';
import { Simulation } from '../game/Simulation';
import type { BuildingEntity } from '../entities/EntityStore';
import { findPath } from '../../map/findPath';

function advanceSeconds(simulation: Simulation, seconds: number): void {
  simulation.advance(FIXED_STEP_MS * TICKS_PER_SECOND * seconds);
}

describe('Fase 4 — Barricada', () => {
  it('somente construtores podem construir barricadas (1x1)', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.wood = 500;
    simulation.teams.blue.stone = 500;

    // Worker attempts to build barricade -> rejected with 'not-builder'
    const workerResult = simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: 'blue-worker-1',
      buildingKind: 'barricade',
      position: [24, 96],
    });
    expect(workerResult).toEqual({ accepted: false, reason: 'not-builder' });

    // Spawn a builder
    const builder = simulation.entities.spawnUnit('blue', 'builder', 24, 95);

    // Builder attempts to build barricade -> accepted
    const builderResult = simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      position: [24, 96],
    });
    expect(builderResult).toEqual({ accepted: true });

    const barricade = simulation.entities.atCell(24, 96) as BuildingEntity;
    expect(barricade).toBeDefined();
    expect(barricade.category).toBe('building');
    expect(barricade.kind).toBe('barricade');
    expect(barricade.width).toBe(1);
    expect(barricade.height).toBe(1);
    expect(barricade.underConstruction).toBe(true);

    // Map cell is immediately blocked
    expect(simulation.map.isPassable(24, 96)).toBe(false);

    // Advance 3 seconds to complete construction
    advanceSeconds(simulation, 3);
    expect(barricade.underConstruction).toBe(false);
    expect(barricade.hp).toBe(BALANCE.buildings.barricade.hp);
    expect(barricade.maxHp).toBe(BALANCE.buildings.barricade.hp);
  });

  it('exige SEMPRE madeira E pedra, falhando se faltar qualquer um', () => {
    const simulation = new Simulation(1);
    const builder = simulation.entities.spawnUnit('blue', 'builder', 24, 95);

    // Case 1: Lacks wood (wood: 9, stone: 10)
    simulation.teams.blue.wood = 9;
    simulation.teams.blue.stone = 10;
    const r1 = simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      position: [24, 96],
    });
    expect(r1).toEqual({ accepted: false, reason: 'insufficient-wood' });

    // Case 2: Lacks stone (wood: 20, stone: 4)
    simulation.teams.blue.wood = 20;
    simulation.teams.blue.stone = 4;
    const r2 = simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      position: [24, 96],
    });
    expect(r2).toEqual({ accepted: false, reason: 'insufficient-stone' });

    // Case 3: Has exactly 10 wood and 5 stone
    simulation.teams.blue.wood = 10;
    simulation.teams.blue.stone = 5;
    const r3 = simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      position: [24, 96],
    });
    expect(r3).toEqual({ accepted: true });
    expect(simulation.teams.blue.wood).toBe(0);
    expect(simulation.teams.blue.stone).toBe(0);
  });

  it('limite de 100 barricadas por jogador e recupera slot ao destruir', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.wood = 5000;
    simulation.teams.blue.stone = 5000;
    const builder = simulation.entities.spawnUnit('blue', 'builder', 20, 94);
    simulation.fog.update();

    // Create 100 barricades
    for (let i = 0; i < 100; i += 1) {
      simulation.entities.createBuilding('blue', 'barricade', 5 + (i % 20), 50 + Math.floor(i / 20), false);
    }
    const count = simulation.entities.all().filter((e) => e.team === 'blue' && e.kind === 'barricade').length;
    expect(count).toBe(100);

    // 101st barricade is rejected
    const r101 = simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      position: [20, 95],
    });
    expect(r101).toEqual({ accepted: false, reason: 'building-limit-reached' });

    // Destroy 1 barricade
    const firstBarricade = simulation.entities.all().find((e) => e.team === 'blue' && e.kind === 'barricade')!;
    simulation.entities.remove(firstBarricade.id);
    expect(simulation.entities.all().filter((e) => e.team === 'blue' && e.kind === 'barricade').length).toBe(99);

    // Slot is recovered: 100th barricade can now be built
    const rRecover = simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      position: [20, 95],
    });
    expect(rRecover).toEqual({ accepted: true });
  });

  it('bloqueia pathfinding, encontra rota alternativa e retorna null se totalmente fechada', () => {
    const simulation = new Simulation(1);

    // Corridor at y=95 from x=20 to x=24
    // Block x=22, y=95 with a barricade
    simulation.entities.createBuilding('blue', 'barricade', 22, 95, false);

    // Start at (20, 95), goal at (24, 95)
    // There are open cells around (e.g. y=94 or y=96)
    const pathWithDetour = findPath(simulation.map, [20, 95], [24, 95]);
    expect(pathWithDetour).not.toBeNull();
    // Path must not contain the blocked barricade cell (22, 95)
    expect(pathWithDetour!.some(([x, y]) => x === 22 && y === 95)).toBe(false);

    // Now completely wall off a box around (24, 95)
    // Wall cells surrounding (24, 95):
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        simulation.entities.createBuilding('blue', 'barricade', 24 + dx, 95 + dy, false);
      }
    }

    // Goal (24, 95) is now completely enclosed by barricades
    const pathBlocked = findPath(simulation.map, [20, 95], [24, 95]);
    expect(pathBlocked).toBeNull();
  });

  it('destruição em combate desobstrui o grid e libera passagem', () => {
    const simulation = new Simulation(1);

    // Red team creates barricade at (24, 95)
    const barricade = simulation.entities.createBuilding('red', 'barricade', 24, 95, false);
    expect(simulation.map.isPassable(24, 95)).toBe(false);

    // Blue soldier adjacent at (23, 95)
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 23, 95);
    simulation.fog.update();

    // Soldier attacks the barricade
    const attackRes = simulation.issueCommand({
      type: 'attack',
      team: 'blue',
      unitId: soldier.id,
      targetId: barricade.id,
    });
    expect(attackRes).toEqual({ accepted: true });

    // Attack repeatedly until barricade is destroyed (hp: 40, damage: 5 -> 8 hits * 3s = 24s)
    advanceSeconds(simulation, 26);

    // Barricade is dead and removed
    expect(simulation.entities.get(barricade.id)).toBeUndefined();

    // Cell is now passable again!
    expect(simulation.map.isPassable(24, 95)).toBe(true);

    // Soldier can move through (24, 95)
    const moveRes = simulation.issueCommand({
      type: 'move',
      team: 'blue',
      unitId: soldier.id,
      destination: [25, 95],
    });
    expect(moveRes).toEqual({ accepted: true });
  });

  it('arqueiro ataca alvo por cima de barricadas', () => {
    const simulation = new Simulation(1);

    // Place barricade at (24, 95) between archer at (22, 95) and red target at (25, 95)
    simulation.entities.createBuilding('blue', 'barricade', 24, 95, false);
    const archer = simulation.entities.spawnUnit('blue', 'archer', 22, 95);
    const redTarget = simulation.entities.spawnUnit('red', 'worker', 25, 95);
    simulation.fog.update();

    const hpBefore = redTarget.hp;

    // Archer range is 4; distance from (22, 95) to (25, 95) is 3 <= 4
    const attackRes = simulation.issueCommand({
      type: 'attack',
      team: 'blue',
      unitId: archer.id,
      targetId: redTarget.id,
    });
    expect(attackRes).toEqual({ accepted: true });

    // Advance 1 tick for attack to resolve
    advanceSeconds(simulation, 1);
    expect(redTarget.hp).toBe(hpBefore - BALANCE.units.archer.damage);
  });

  it('construtor consegue reparar barricada danificada', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.wood = 500;
    simulation.teams.blue.stone = 500;

    const barricade = simulation.entities.createBuilding('blue', 'barricade', 24, 95, false);
    barricade.hp = 10; // damaged: 10 / 40
    expect(barricade.hp).toBeLessThan(barricade.maxHp);

    const builder = simulation.entities.spawnUnit('blue', 'builder', 23, 95);

    // Issue repair
    const repairRes = simulation.issueCommand({
      type: 'repair',
      team: 'blue',
      builderId: builder.id,
      buildingId: barricade.id,
    });
    expect(repairRes).toEqual({ accepted: true });

    // Advance time: repair rate is 4 hp/s, needs 30 hp -> ~8 seconds
    advanceSeconds(simulation, 9);

    expect(barricade.hp).toBe(barricade.maxHp);
    expect(simulation.construction.taskFor(builder.id)).toBeNull(); // task completed
  });
});
