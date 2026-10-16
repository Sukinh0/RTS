import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../config/balance';
import { FIXED_STEP_MS, TICKS_PER_SECOND } from '../../config/runtime';
import { Simulation } from '../game/Simulation';
import type { BuildingEntity } from '../entities/EntityStore';

function advanceSeconds(simulation: Simulation, seconds: number): void {
  simulation.advance(FIXED_STEP_MS * TICKS_PER_SECOND * seconds);
}

describe('Fase 5 — Reparos', () => {
  it('apenas construtores reparam; operários são rejeitados', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.wood = 500;
    simulation.teams.blue.stone = 500;

    const base = simulation.entities.get('blue-base') as BuildingEntity;
    base.hp = 100; // max is 150

    // Worker attempts repair -> 'not-builder'
    const workerRes = simulation.issueCommand({
      type: 'repair',
      team: 'blue',
      builderId: 'blue-worker-1',
      buildingId: base.id,
    });
    expect(workerRes).toEqual({ accepted: false, reason: 'not-builder' });

    // Builder attempts repair -> accepted
    const builder = simulation.entities.spawnUnit('blue', 'builder', 20, 99);
    const builderRes = simulation.issueCommand({
      type: 'repair',
      team: 'blue',
      builderId: builder.id,
      buildingId: base.id,
    });
    expect(builderRes).toEqual({ accepted: true });
  });

  it('reparo restaura HP ao longo do tempo e consome recursos configurados', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.wood = 100;
    simulation.teams.blue.stone = 100;

    const house = simulation.entities.createBuilding('blue', 'house', 24, 96, false);
    house.hp = 30; // max is 60. Missing 30 HP.
    const builder = simulation.entities.spawnUnit('blue', 'builder', 24, 95);

    const houseConfig = BALANCE.buildings.house;
    const repairRate = houseConfig.repairRateHpPerSecond; // 4 hp/s
    const costConfig = houseConfig.repairCostPerSecond; // wood: 2, stone: 0

    const res = simulation.issueCommand({
      type: 'repair',
      team: 'blue',
      builderId: builder.id,
      buildingId: house.id,
    });
    expect(res).toEqual({ accepted: true });

    // Advance 5 seconds: 5s * 4 hp/s = +20 HP -> 50 HP
    advanceSeconds(simulation, 5);
    expect(house.hp).toBeCloseTo(30 + 5 * repairRate, 0);
    expect(simulation.teams.blue.wood).toBeCloseTo(100 - 5 * (costConfig.wood ?? 0), 0);
    expect(simulation.teams.blue.stone).toBeCloseTo(100 - 5 * (costConfig.stone ?? 0), 0);
  });

  it('não ultrapassa HP máximo e libera o construtor ao finalizar', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.wood = 200;
    simulation.teams.blue.stone = 200;

    const barracks = simulation.entities.createBuilding('blue', 'barracks', 24, 95, false);
    barracks.hp = 70; // max is 80. Needs 10 HP.
    const builder = simulation.entities.spawnUnit('blue', 'builder', 24, 94);

    const res = simulation.issueCommand({
      type: 'repair',
      team: 'blue',
      builderId: builder.id,
      buildingId: barracks.id,
    });
    expect(res).toEqual({ accepted: true });

    // 4 hp/s -> needs 2.5s. Advance 5s.
    advanceSeconds(simulation, 5);
    expect(barracks.hp).toBe(barracks.maxHp);
    expect(simulation.construction.taskFor(builder.id)).toBeNull();
    expect(simulation.construction.isBeingRepaired(barracks.id)).toBe(false);

    // Further repair attempt is rejected
    const repeatRes = simulation.issueCommand({
      type: 'repair',
      team: 'blue',
      builderId: builder.id,
      buildingId: barracks.id,
    });
    expect(repeatRes).toEqual({ accepted: false, reason: 'building-at-max-hp' });
  });

  it('interrupção de reparo para o consumo de recursos e permite nova ordem', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.wood = 100;
    simulation.teams.blue.stone = 100;

    const house = simulation.entities.createBuilding('blue', 'house', 24, 96, false);
    house.hp = 20;
    const builder = simulation.entities.spawnUnit('blue', 'builder', 24, 95);

    simulation.issueCommand({
      type: 'repair',
      team: 'blue',
      builderId: builder.id,
      buildingId: house.id,
    });

    advanceSeconds(simulation, 3);
    const hpAtInterrupt = house.hp;
    const woodAtInterrupt = simulation.teams.blue.wood;

    // Interrupt with move command
    const moveRes = simulation.issueCommand({
      type: 'move',
      team: 'blue',
      unitId: builder.id,
      destination: [20, 94],
    });
    expect(moveRes).toEqual({ accepted: true });
    expect(simulation.construction.taskFor(builder.id)).toBeNull();

    // Advance 3 more seconds
    advanceSeconds(simulation, 3);
    expect(house.hp).toBe(hpAtInterrupt);
    expect(simulation.teams.blue.wood).toBe(woodAtInterrupt);
  });

  it('falta de recursos interrompe o reparo em andamento e rejeita início se sem estoque', () => {
    const simulation = new Simulation(1);
    const builder = simulation.entities.spawnUnit('blue', 'builder', 24, 95);
    const house = simulation.entities.createBuilding('blue', 'house', 24, 96, false);
    house.hp = 20;

    // Case 1: Rejects at start if 0 wood (house repair requires wood)
    simulation.teams.blue.wood = 0;
    simulation.teams.blue.stone = 50;
    const rejectRes = simulation.issueCommand({
      type: 'repair',
      team: 'blue',
      builderId: builder.id,
      buildingId: house.id,
    });
    expect(rejectRes).toEqual({ accepted: false, reason: 'insufficient-wood' });

    // Case 2: Starts with small amount (4 wood = 2 seconds of repair)
    simulation.teams.blue.wood = 4;
    const acceptRes = simulation.issueCommand({
      type: 'repair',
      team: 'blue',
      builderId: builder.id,
      buildingId: house.id,
    });
    expect(acceptRes).toEqual({ accepted: true });

    // Advance 4 seconds (resources exhaust after ~2s)
    advanceSeconds(simulation, 4);
    expect(simulation.teams.blue.wood).toBeLessThan(0.1);
    // Task should be stopped due to lack of resources
    expect(simulation.construction.taskFor(builder.id)).toBeNull();
    // HP should have risen by ~8 HP (4 wood / 2 wood/s = 2s * 4 hp/s = 8 hp)
    expect(house.hp).toBeCloseTo(28, 0);
  });

  it('morte do construtor cancela a tarefa de reparo', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.wood = 100;
    simulation.teams.blue.stone = 100;

    const barricade = simulation.entities.createBuilding('blue', 'barricade', 24, 96, false);
    barricade.hp = 10;
    const builder = simulation.entities.spawnUnit('blue', 'builder', 24, 95);

    simulation.issueCommand({
      type: 'repair',
      team: 'blue',
      builderId: builder.id,
      buildingId: barricade.id,
    });
    expect(simulation.construction.taskFor(builder.id)).not.toBeNull();

    // Kill the builder
    simulation.entities.remove(builder.id);
    advanceSeconds(simulation, 1);
    expect(simulation.construction.taskFor(builder.id)).toBeNull();

    // Advance time: barricade HP stays at 10
    advanceSeconds(simulation, 3);
    expect(barricade.hp).toBe(10);
  });

  it('múltiplos construtores reparam a mesma estrutura simultaneamente e dividem a carga', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.wood = 500;
    simulation.teams.blue.stone = 500;

    // Base needs 60 HP (150 max, hp = 90)
    const base = simulation.entities.get('blue-base') as BuildingEntity;
    base.hp = 90;

    // Two builders at distinct perimeter positions
    const b1 = simulation.entities.spawnUnit('blue', 'builder', 20, 99);
    const b2 = simulation.entities.spawnUnit('blue', 'builder', 21, 99);

    const r1 = simulation.issueCommand({
      type: 'repair',
      team: 'blue',
      builderId: b1.id,
      buildingId: base.id,
    });
    const r2 = simulation.issueCommand({
      type: 'repair',
      team: 'blue',
      builderId: b2.id,
      buildingId: base.id,
    });
    expect(r1).toEqual({ accepted: true });
    expect(r2).toEqual({ accepted: true });

    // Both are repairing simultaneously
    expect(simulation.construction.taskFor(b1.id)?.phase).toBe('repairing');
    expect(simulation.construction.taskFor(b2.id)?.phase).toBe('repairing');

    // Base repair rate is 5 hp/s per builder -> 10 hp/s total.
    // In 3 seconds, base gains 30 HP -> 120 HP
    advanceSeconds(simulation, 3);
    expect(base.hp).toBeCloseTo(120, 0);

    // In 4 more seconds, reaches maxHp (150) and both finish
    advanceSeconds(simulation, 4);
    expect(base.hp).toBe(base.maxHp);
    expect(simulation.construction.taskFor(b1.id)).toBeNull();
    expect(simulation.construction.taskFor(b2.id)).toBeNull();
  });

  it('IA prioriza reparo de base em risco e estruturas importantes', () => {
    const simulation = new Simulation(42, true);
    const redAI = simulation.redAI!;
    expect(redAI).toBeDefined();

    // Give red resources and a builder near red base (170, 100)
    simulation.teams.red.wood = 200;
    simulation.teams.red.stone = 200;
    const redBuilder = simulation.entities.spawnUnit('red', 'builder', 170, 99);

    // Damage red base: 150 -> 80
    const redBase = simulation.entities.get('red-base') as BuildingEntity;
    redBase.hp = 80;

    // Advance 1 second so AI decision loop triggers
    advanceSeconds(simulation, 1);

    // AI should have issued repair on red base
    expect(redAI.currentIntent).toBe('Repair');
    const task = simulation.construction.taskFor(redBuilder.id);
    expect(task).not.toBeNull();
    expect(task?.buildingId).toBe(redBase.id);

    // Advance until fully repaired
    advanceSeconds(simulation, 16);
    expect(redBase.hp).toBe(redBase.maxHp);
  });

  it('recursos nunca ficam quebrados durante o reparo (apenas números inteiros)', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.wood = 50;
    simulation.teams.blue.stone = 50;
    simulation.teams.blue.coins = 100;

    const base = simulation.entities.get('blue-base') as BuildingEntity;
    base.hp = 100;
    const builder = simulation.entities.spawnUnit('blue', 'builder', 20, 99);

    const res = simulation.issueCommand({
      type: 'repair',
      team: 'blue',
      builderId: builder.id,
      buildingId: base.id,
    });
    expect(res).toEqual({ accepted: true });

    // Advance tick by tick for 50 ticks (5 seconds) and verify every single tick is integer
    for (let tick = 0; tick < 50; tick += 1) {
      simulation.advance(FIXED_STEP_MS);
      expect(Number.isInteger(simulation.teams.blue.coins)).toBe(true);
      expect(Number.isInteger(simulation.teams.blue.wood)).toBe(true);
      expect(Number.isInteger(simulation.teams.blue.stone)).toBe(true);
      expect(Number.isInteger(simulation.teams.red.coins)).toBe(true);
      expect(Number.isInteger(simulation.teams.red.wood)).toBe(true);
      expect(Number.isInteger(simulation.teams.red.stone)).toBe(true);
    }
  });
});
