import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../config/balance';
import { FIXED_STEP_MS, TICKS_PER_SECOND } from '../../config/runtime';
import { Simulation } from '../game/Simulation';
import type { BuildingEntity } from '../entities/EntityStore';
import { VisualFog } from '../../presentation/VisualFog';

function advanceSeconds(simulation: Simulation, seconds: number): void {
  simulation.advance(FIXED_STEP_MS * TICKS_PER_SECOND * seconds);
}

describe('Fase 6 — Torre de Vigilância', () => {
  it('somente construtores podem construir torres (2x2), rejeitando operários com not-builder', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.coins = 500;
    simulation.teams.blue.wood = 500;
    simulation.teams.blue.stone = 500;

    // Worker attempts to build tower -> rejected with 'not-builder'
    const workerResult = simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: 'blue-worker-1',
      buildingKind: 'tower',
      position: [24, 96],
    });
    expect(workerResult).toEqual({ accepted: false, reason: 'not-builder' });

    // Spawn a builder
    const builder = simulation.entities.spawnUnit('blue', 'builder', 24, 95);

    // Builder attempts to build tower -> accepted
    const builderResult = simulation.issueCommand({
      type: 'build',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'tower',
      position: [24, 96],
    });
    expect(builderResult).toEqual({ accepted: true });

    const tower = simulation.entities.atCell(24, 96) as BuildingEntity;
    expect(tower).toBeDefined();
    expect(tower.category).toBe('building');
    expect(tower.kind).toBe('tower');
    expect(tower.width).toBe(2);
    expect(tower.height).toBe(2);
    expect(tower.underConstruction).toBe(true);

    // Occupies 2x2 footprint
    expect(simulation.map.isPassable(24, 96)).toBe(false);
    expect(simulation.map.isPassable(25, 96)).toBe(false);
    expect(simulation.map.isPassable(24, 97)).toBe(false);
    expect(simulation.map.isPassable(25, 97)).toBe(false);

    // Advance 10 seconds to complete construction
    advanceSeconds(simulation, BALANCE.buildings.tower.buildSeconds);
    expect(tower.underConstruction).toBe(false);
    expect(tower.hp).toBe(BALANCE.buildings.tower.hp);
    expect(tower.maxHp).toBe(BALANCE.buildings.tower.hp);
  });

  it('valida custos configuráveis (200 ouro, 150 madeira, 100 pedra)', () => {
    const simulation = new Simulation(1);
    const builder = simulation.entities.spawnUnit('blue', 'builder', 24, 95);

    // Insufficient coins
    simulation.teams.blue.coins = 199;
    simulation.teams.blue.wood = 150;
    simulation.teams.blue.stone = 100;
    expect(simulation.issueCommand({
      type: 'build', team: 'blue', builderId: builder.id, buildingKind: 'tower', position: [24, 96],
    })).toEqual({ accepted: false, reason: 'insufficient-coins' });

    // Insufficient wood
    simulation.teams.blue.coins = 200;
    simulation.teams.blue.wood = 149;
    simulation.teams.blue.stone = 100;
    expect(simulation.issueCommand({
      type: 'build', team: 'blue', builderId: builder.id, buildingKind: 'tower', position: [24, 96],
    })).toEqual({ accepted: false, reason: 'insufficient-wood' });

    // Insufficient stone
    simulation.teams.blue.coins = 200;
    simulation.teams.blue.wood = 150;
    simulation.teams.blue.stone = 99;
    expect(simulation.issueCommand({
      type: 'build', team: 'blue', builderId: builder.id, buildingKind: 'tower', position: [24, 96],
    })).toEqual({ accepted: false, reason: 'insufficient-stone' });

    // Exact cost succeeds and deducts
    simulation.teams.blue.coins = 200;
    simulation.teams.blue.wood = 150;
    simulation.teams.blue.stone = 100;
    const res = simulation.issueCommand({
      type: 'build', team: 'blue', builderId: builder.id, buildingKind: 'tower', position: [24, 96],
    });
    expect(res).toEqual({ accepted: true });
    expect(simulation.teams.blue.coins).toBe(0);
    expect(simulation.teams.blue.wood).toBe(0);
    expect(simulation.teams.blue.stone).toBe(0);
  });

  it('revela permanentemente uma área exata de 20x20 células enquanto existir', () => {
    const simulation = new Simulation(1);
    // Remove default units so vision is strictly controlled
    for (const ent of simulation.entities.all()) {
      if (ent.category === 'unit' && ent.team === 'blue') {
        simulation.entities.remove(ent.id);
      }
    }
    simulation.fog.update();

    // Place a completed tower at (90, 100) - 2x2 spanning [90..91, 100..101]
    const tower = simulation.entities.createBuilding('blue', 'tower', 90, 100, false);
    expect(tower.id).toBeDefined();
    simulation.fog.update();

    // Tower vision: halfSpan = 9.
    // X range: 90 - 9 = 81 to 90 + 2 - 1 + 9 = 100. Length = 100 - 81 + 1 = 20.
    // Y range: 100 - 9 = 91 to 100 + 2 - 1 + 9 = 110. Length = 110 - 91 + 1 = 20.
    let visibleCount = 0;
    for (let y = 91; y <= 110; y += 1) {
      for (let x = 81; x <= 100; x += 1) {
        if (simulation.fog.stateAt('blue', x, y) === 'visible') {
          visibleCount += 1;
        }
      }
    }
    expect(visibleCount).toBe(400); // 20 * 20 = 400 cells!

    // Cells just outside the 20x20 boundary must NOT be visible from this tower
    expect(simulation.fog.stateAt('blue', 80, 100)).not.toBe('visible');
    expect(simulation.fog.stateAt('blue', 101, 100)).not.toBe('visible');
    expect(simulation.fog.stateAt('blue', 90, 90)).not.toBe('visible');
    expect(simulation.fog.stateAt('blue', 90, 111)).not.toBe('visible');
  });

  it('atualização em tempo real: unidades inimigas dentro da área são visíveis', () => {
    const simulation = new Simulation(1);
    // Clear units
    for (const ent of simulation.entities.all()) {
      if (ent.category === 'unit') simulation.entities.remove(ent.id);
    }
    // Blue tower at (90, 100)
    simulation.entities.createBuilding('blue', 'tower', 90, 100, false);
    simulation.fog.update();

    // Enemy soldier inside tower vision (at 95, 100)
    const enemyInside = simulation.entities.spawnUnit('red', 'soldier', 95, 100);
    // Enemy soldier outside tower vision (at 125, 100)
    const enemyOutside = simulation.entities.spawnUnit('red', 'soldier', 125, 100);
    simulation.fog.update();

    expect(simulation.fog.isEntityVisible('blue', enemyInside)).toBe(true);
    expect(simulation.fog.isEntityVisible('blue', enemyOutside)).toBe(false);
  });

  it('quando destruída, a visão desaparece imediatamente e a região volta ao fog normal', () => {
    const simulation = new Simulation(1);
    for (const ent of simulation.entities.all()) {
      if (ent.category === 'unit' && ent.team === 'blue') simulation.entities.remove(ent.id);
    }
    const tower = simulation.entities.createBuilding('blue', 'tower', 90, 100, false);
    simulation.fog.update();

    expect(simulation.fog.stateAt('blue', 95, 100)).toBe('visible');

    // Destroy the tower
    simulation.entities.remove(tower.id);
    simulation.fog.update();

    // Cell was explored, but is NO LONGER visible!
    expect(simulation.fog.stateAt('blue', 95, 100)).toBe('explored');
  });

  it('função especial DETECTAR BATEDORES: counter de batedor na área da torre', () => {
    const simulation = new Simulation(1);
    for (const ent of simulation.entities.all()) {
      if (ent.category === 'unit') simulation.entities.remove(ent.id);
    }

    // Friendly tower at (90, 100)
    simulation.entities.createBuilding('blue', 'tower', 90, 100, false);
    simulation.fog.update();

    // Enemy scout inside tower vision at (98, 100)
    // Distance from tower edge (91, 100) is 7 > 3 (stealthDetectionDistance)
    // Normally, scout stealth would keep it hidden if vision was just a normal building.
    const enemyScoutInside = simulation.entities.spawnUnit('red', 'scout', 98, 100);
    // Enemy scout outside tower vision at (125, 100)
    const enemyScoutOutside = simulation.entities.spawnUnit('red', 'scout', 125, 100);
    simulation.fog.update();

    // Inside tower: scout LOSES stealth and is visible!
    expect(simulation.fog.isEntityVisible('blue', enemyScoutInside)).toBe(true);
    // Outside tower: normal stealth rules apply (not visible)
    expect(simulation.fog.isEntityVisible('blue', enemyScoutOutside)).toBe(false);

    // Also test VisualFog
    const visualFog = new VisualFog(simulation.map, simulation.entities, 'blue');
    visualFog.update(new Map());
    expect(visualFog.isEntityVisible(enemyScoutInside)).toBe(true);
    expect(visualFog.isEntityVisible(enemyScoutOutside)).toBe(false);
  });

  it('não altera a regra padrão do Batedor fora das áreas de torre', () => {
    const simulation = new Simulation(1);
    for (const ent of simulation.entities.all()) {
      if (ent.category === 'unit') simulation.entities.remove(ent.id);
    }
    // Blue house at (90, 100) has vision radius 20
    simulation.entities.createBuilding('blue', 'house', 90, 100, false);
    simulation.fog.update();

    // Enemy scout at (100, 100) is visible by house in fog, but distance to house is 9 > 3
    const enemyScout = simulation.entities.spawnUnit('red', 'scout', 100, 100);
    simulation.fog.update();

    // The house is NOT a tower, so standard scout stealth applies: scout is INVISIBLE
    expect(simulation.fog.stateAt('blue', 100, 100)).toBe('visible');
    expect(simulation.fog.isEntityVisible('blue', enemyScout)).toBe(false);
  });

  it('a torre NÃO ataca unidades inimigas', () => {
    const simulation = new Simulation(1);
    const tower = simulation.entities.createBuilding('blue', 'tower', 90, 100, false);
    expect(tower.id).toBeDefined();
    const enemyWorker = simulation.entities.spawnUnit('red', 'worker', 92, 100);
    const initialHp = enemyWorker.hp;

    // Advance 5 seconds
    advanceSeconds(simulation, 5);

    // Worker took no damage from the tower
    expect(enemyWorker.hp).toBe(initialHp);
  });

  it('a torre pode ser danificada e reparada por construtores', () => {
    const simulation = new Simulation(1);
    simulation.teams.blue.wood = 200;
    simulation.teams.blue.stone = 200;

    const tower = simulation.entities.createBuilding('blue', 'tower', 24, 96, false);
    tower.hp = 50; // Damaged to 50/100

    const builder = simulation.entities.spawnUnit('blue', 'builder', 24, 95);

    const repairRes = simulation.issueCommand({
      type: 'repair',
      team: 'blue',
      builderId: builder.id,
      buildingId: tower.id,
    });
    expect(repairRes).toEqual({ accepted: true });

    // Advance 5 seconds: repair rate is 4 HP/s -> +20 HP -> 70 HP
    advanceSeconds(simulation, 5);
    expect(tower.hp).toBeGreaterThanOrEqual(69);
    expect(tower.hp).toBeLessThanOrEqual(71);

    // Wood and stone were consumed during repair
    expect(simulation.teams.blue.wood).toBeLessThan(200);
    expect(simulation.teams.blue.stone).toBeLessThan(200);
  });

  it('destruição por combate: tropas inimigas destroem a torre e o fog é limpo', () => {
    const simulation = new Simulation(1);
    for (const ent of simulation.entities.all()) {
      if (ent.category === 'unit' && ent.team === 'blue') simulation.entities.remove(ent.id);
    }

    const tower = simulation.entities.createBuilding('blue', 'tower', 90, 100, false);
    tower.hp = 10; // Low HP

    // Red soldier adjacent to tower
    const soldier = simulation.entities.spawnUnit('red', 'soldier', 89, 100);
    simulation.fog.update(); // Update fog so red soldier sees tower and blue tower sees soldier

    expect(simulation.fog.stateAt('blue', 90, 100)).toBe('visible');
    expect(simulation.fog.isEntityVisible('red', tower)).toBe(true);

    // Order soldier to attack tower
    const attackRes = simulation.issueCommand({
      type: 'attack',
      team: 'red',
      unitId: soldier.id,
      targetId: tower.id,
    });
    expect(attackRes).toEqual({ accepted: true });

    // Advance ticks until soldier kills tower
    advanceSeconds(simulation, 4);

    // Tower was destroyed
    expect(simulation.entities.get(tower.id)).toBeUndefined();
    // Area reverts to fog for blue
    expect(simulation.fog.stateAt('blue', 90, 100)).toBe('explored');
  });
});
