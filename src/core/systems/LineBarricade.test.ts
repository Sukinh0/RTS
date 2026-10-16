import { describe, expect, it } from 'vitest';
import { Simulation } from '../game/Simulation';
import type { Point } from '../../map/MapGrid';
import type { BuildingEntity, UnitEntity } from '../entities/EntityStore';

function createTestSim(): { sim: Simulation; builder: UnitEntity } {
  const sim = new Simulation(1234, false);
  // Ensure blue has plenty of starting resources
  sim.teams.blue.wood = 500;
  sim.teams.blue.stone = 500;
  sim.teams.blue.coins = 500;

  // Remove default workers so ambient harvesting does not interfere with exact resource accounting
  for (const entity of sim.entities.all()) {
    if (entity.category === 'unit' && entity.kind === 'worker') {
      sim.entities.remove(entity.id);
    }
  }

  // Base is around (25, 99). Spawn builder near (45, 95)
  const builder = sim.entities.spawnUnit('blue', 'builder', 45, 95);
  // Spawn scout to explore the construction zone
  const scout = sim.entities.spawnUnit('blue', 'scout', 48, 95);
  sim.fog.update();
  sim.entities.remove(scout.id);
  sim.fog.update();
  return { sim, builder };
}

describe('V1.1.2 — Validação Atômica de Linha de Barricadas', () => {
  it('linha completamente válida é aceita e reserva recursos', () => {
    const { sim, builder } = createTestSim();
    const cells: Point[] = [[46, 95], [47, 95], [48, 95]]; // 3 barricades

    const validation = sim.construction.validateBuildLine({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    }, sim.clock.ticks);

    expect(validation.valid).toBe(true);

    const initWood = sim.teams.blue.wood;
    const initStone = sim.teams.blue.stone;

    const res = sim.issueCommand({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    });

    expect(res.accepted).toBe(true);
    // Cost: 3 * 10 wood = 30, 3 * 5 stone = 15
    expect(sim.teams.blue.wood).toBe(initWood - 30);
    expect(sim.teams.blue.stone).toBe(initStone - 15);
  });

  it('obstáculo no início invalida a linha inteira atomicamente', () => {
    const { sim, builder } = createTestSim();
    // Put a building obstacle at the start cell
    sim.entities.createBuilding('blue', 'house', 46, 95);

    const cells: Point[] = [[46, 95], [47, 95], [48, 95]];
    const validation = sim.construction.validateBuildLine({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    }, sim.clock.ticks);

    expect(validation.valid).toBe(false);
    expect(validation.reason).toBe('blocked');

    const initWood = sim.teams.blue.wood;
    const res = sim.issueCommand({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    });
    expect(res.accepted).toBe(false);
    expect(sim.teams.blue.wood).toBe(initWood); // No resources consumed
  });

  it('obstáculo no meio invalida a linha inteira atomicamente', () => {
    const { sim, builder } = createTestSim();
    sim.entities.createBuilding('blue', 'house', 47, 95);

    const cells: Point[] = [[46, 95], [47, 95], [48, 95]];
    const validation = sim.construction.validateBuildLine({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    }, sim.clock.ticks);

    expect(validation.valid).toBe(false);
    expect(validation.reason).toBe('blocked');
  });

  it('obstáculo no final invalida a linha inteira atomicamente', () => {
    const { sim, builder } = createTestSim();
    sim.entities.createBuilding('blue', 'house', 48, 95);

    const cells: Point[] = [[46, 95], [47, 95], [48, 95]];
    const validation = sim.construction.validateBuildLine({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    }, sim.clock.ticks);

    expect(validation.valid).toBe(false);
    expect(validation.reason).toBe('blocked');
  });

  it('reservas sobrepostas: célula reservada por uma linha bloqueia outra linha', () => {
    const { sim, builder } = createTestSim();
    const builder2 = sim.entities.spawnUnit('blue', 'builder', 45, 96);

    const cells1: Point[] = [[46, 95], [47, 95], [48, 95]];
    const cells2: Point[] = [[47, 94], [47, 95], [47, 96]]; // Intersects at (47, 95)

    const res1 = sim.issueCommand({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells: cells1,
    });
    expect(res1.accepted).toBe(true);

    // Second line intersecting reserved cell should be rejected
    const val2 = sim.construction.validateBuildLine({
      type: 'build-line',
      team: 'blue',
      builderId: builder2.id,
      buildingKind: 'barricade',
      cells: cells2,
    }, sim.clock.ticks);
    expect(val2.valid).toBe(false);
    expect(val2.reason).toBe('blocked');

    const res2 = sim.issueCommand({
      type: 'build-line',
      team: 'blue',
      builderId: builder2.id,
      buildingKind: 'barricade',
      cells: cells2,
    });
    expect(res2.accepted).toBe(false);
  });

  it('recursos insuficientes rejeita a ordem integralmente', () => {
    const { sim, builder } = createTestSim();
    sim.teams.blue.wood = 25; // 3 barricades require 30 wood
    sim.teams.blue.stone = 50;

    const cells: Point[] = [[46, 95], [47, 95], [48, 95]];
    const val = sim.construction.validateBuildLine({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    }, sim.clock.ticks);
    expect(val.valid).toBe(false);
    expect(val.reason).toBe('insufficient-wood');

    const res = sim.issueCommand({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    });
    expect(res.accepted).toBe(false);
    expect(sim.teams.blue.wood).toBe(25);
  });

  it('recursos exatamente suficientes aceita a ordem', () => {
    const { sim, builder } = createTestSim();
    sim.teams.blue.wood = 30; // exactly 3 * 10
    sim.teams.blue.stone = 15; // exactly 3 * 5

    const cells: Point[] = [[46, 95], [47, 95], [48, 95]];
    const val = sim.construction.validateBuildLine({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    }, sim.clock.ticks);
    expect(val.valid).toBe(true);

    const res = sim.issueCommand({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    });
    expect(res.accepted).toBe(true);
    expect(sim.teams.blue.wood).toBe(0);
    expect(sim.teams.blue.stone).toBe(0);
  });

  it('limite de 100 barricadas por equipe é estritamente respeitado', () => {
    const { sim, builder } = createTestSim();
    // Create 98 existing barricades
    for (let i = 0; i < 98; i++) {
      sim.entities.createBuilding('blue', 'barricade', 50 + (i % 20), 50 + Math.floor(i / 20));
    }

    // Try to build a line of 3 barricades (98 + 3 = 101 > 100)
    const cells3: Point[] = [[46, 95], [47, 95], [48, 95]];
    const val3 = sim.construction.validateBuildLine({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells: cells3,
    }, sim.clock.ticks);
    expect(val3.valid).toBe(false);
    expect(val3.reason).toBe('building-limit-reached');

    // Try to build a line of 2 barricades (98 + 2 = 100 <= 100)
    const cells2: Point[] = [[46, 95], [47, 95]];
    const val2 = sim.construction.validateBuildLine({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells: cells2,
    }, sim.clock.ticks);
    expect(val2.valid).toBe(true);
  });
});

describe('V1.1.2 — Gerenciamento e Reembolso de Recursos', () => {
  it('reserva integral sem cobrança duplicada durante a construção', () => {
    const { sim, builder } = createTestSim();
    sim.construction.instantBuild = true;

    const cells: Point[] = [[46, 95], [47, 95]];
    const initWood = sim.teams.blue.wood;
    const initStone = sim.teams.blue.stone;

    sim.issueCommand({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    });

    // Upfront reservation
    expect(sim.teams.blue.wood).toBe(initWood - 20);
    expect(sim.teams.blue.stone).toBe(initStone - 10);

    // Advance simulation so pieces complete
    sim.advance(2000);

    // No extra deduction should happen
    expect(sim.teams.blue.wood).toBe(initWood - 20);
    expect(sim.teams.blue.stone).toBe(initStone - 10);
  });

  it('cancelamento antes da primeira peça começar reembolsa 100% dos recursos', () => {
    const { sim, builder } = createTestSim();
    // Position builder far from the line so it must travel first
    builder.x = 40;
    builder.y = 90;

    const cells: Point[] = [[46, 95], [47, 95], [48, 95]];
    const initWood = sim.teams.blue.wood;
    const initStone = sim.teams.blue.stone;

    sim.issueCommand({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    });

    expect(sim.teams.blue.wood).toBe(initWood - 30);
    expect(sim.teams.blue.stone).toBe(initStone - 15);

    // Cancel while builder is still traveling before placing foundation
    sim.construction.cancel(builder.id);

    // 100% refund of all 3 unstarted pieces
    expect(sim.teams.blue.wood).toBe(initWood);
    expect(sim.teams.blue.stone).toBe(initStone);
    expect(sim.construction.planFor(builder.id)).toBeNull();
  });

  it('cancelamento durante a execução reembolsa somente as peças não iniciadas', () => {
    const { sim, builder } = createTestSim();
    const cells: Point[] = [[46, 95], [47, 95], [48, 95], [49, 95]]; // 4 barricades

    sim.issueCommand({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    });

    // Advance just enough for piece 1 to complete (90 ticks = 3s at 30 ticks/s)
    // and piece 2 to begin
    for (let i = 0; i < 95; i++) {
      sim.advance(33.33);
    }

    const plan = sim.construction.planFor(builder.id);
    expect(plan).not.toBeNull();
    // Piece 1 should be completed, Piece 2 started or completing
    expect(plan!.completedPieces).toBeGreaterThanOrEqual(1);

    const completed = plan!.completedPieces;
    const activeStarted = plan!.activeBuildingId ? 1 : 0;
    const expectedUnstarted = 4 - (completed + activeStarted);

    const woodBeforeCancel = sim.teams.blue.wood;
    const stoneBeforeCancel = sim.teams.blue.stone;

    sim.construction.cancel(builder.id);

    expect(sim.teams.blue.wood).toBe(woodBeforeCancel + expectedUnstarted * 10);
    expect(sim.teams.blue.stone).toBe(stoneBeforeCancel + expectedUnstarted * 5);
  });

  it('morte do construtor cancela a ordem e reembolsa peças não iniciadas', () => {
    const { sim, builder } = createTestSim();
    builder.x = 40;
    builder.y = 90;
    const cells: Point[] = [[46, 95], [47, 95], [48, 95]];
    const initWood = sim.teams.blue.wood;

    sim.issueCommand({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    });

    // Kill the builder
    builder.hp = 0;
    sim.construction.cancel(builder.id);

    // All unstarted refunded
    expect(sim.teams.blue.wood).toBe(initWood);
    expect(sim.construction.getReservedBarricadeCount('blue')).toBe(0);
  });

  it('ausência de reembolso duplicado em múltiplos cancelamentos', () => {
    const { sim, builder } = createTestSim();
    builder.x = 40;
    builder.y = 90;
    const cells: Point[] = [[46, 95], [47, 95], [48, 95]];
    const initWood = sim.teams.blue.wood;

    sim.issueCommand({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    });

    sim.construction.cancel(builder.id);
    expect(sim.teams.blue.wood).toBe(initWood);

    // Call cancel again
    sim.construction.cancel(builder.id);
    expect(sim.teams.blue.wood).toBe(initWood); // Stays exact, no duplicate refund
  });
});

describe('V1.1.2 — Execução Sequencial e Comportamento do Construtor', () => {
  it('construtor constrói a linha sequencialmente até o fim', () => {
    const { sim, builder } = createTestSim();
    sim.construction.instantBuild = true;

    const cells: Point[] = [[46, 95], [47, 95], [48, 95]];

    sim.issueCommand({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    });

    // Run simulation tick by tick until complete
    for (let i = 0; i < 250; i++) {
      sim.advance(33.34);
      if (!sim.construction.planFor(builder.id)) break;
    }

    // All 3 barricades should exist on map
    for (const [x, y] of cells) {
      const b = sim.entities.atCell(x, y);
      expect(b).toBeDefined();
      expect(b?.category).toBe('building');
      const building = b as BuildingEntity;
      expect(building.kind).toBe('barricade');
      expect(building.underConstruction).toBe(false);
    }

    expect(sim.construction.planFor(builder.id)).toBeNull();
  });

  it('escolha de extremidade acessível: começa na extremidade aberta', () => {
    const { sim, builder } = createTestSim();
    // Builder is at (45, 95)
    // Line from (50, 95) to (46, 95)
    const cells: Point[] = [[50, 95], [49, 95], [48, 95], [47, 95], [46, 95]];

    // Builder is adjacent to (46, 95) but far from (50, 95)
    const ordered = sim.construction.chooseOptimalLineDirection(builder, cells);
    // Should reverse to start near builder at (46, 95)
    expect(ordered[0]).toEqual([46, 95]);
    expect(ordered[ordered.length - 1]).toEqual([50, 95]);
  });

  it('construção em corredor estreito: recua sem ficar preso', () => {
    const { sim, builder } = createTestSim();
    sim.construction.instantBuild = true;

    // Place mountain obstacles above and below to form a 1-tile corridor at y = 95
    // Corridor tiles: (46, 95), (47, 95), (48, 95) with closed back at x = 49
    // Mountain wall at y = 94:
    sim.map.setTerrain(46, 94, 'mountain');
    sim.map.setTerrain(47, 94, 'mountain');
    sim.map.setTerrain(48, 94, 'mountain');
    sim.map.setTerrain(49, 94, 'mountain');
    // Mountain wall at y = 96:
    sim.map.setTerrain(46, 96, 'mountain');
    sim.map.setTerrain(47, 96, 'mountain');
    sim.map.setTerrain(48, 96, 'mountain');
    sim.map.setTerrain(49, 96, 'mountain');
    // Mountain wall at back (49, 95):
    sim.map.setTerrain(49, 95, 'mountain');

    // Builder is outside the corridor at (45, 95)
    builder.x = 45;
    builder.y = 95;

    const cells: Point[] = [[46, 95], [47, 95], [48, 95]];
    const res = sim.issueCommand({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    });
    expect(res.accepted).toBe(true);

    // Direction should build deep end (48, 95) first so builder can retreat toward (45, 95)
    const plan = sim.construction.planFor(builder.id);
    expect(plan?.cells[0]).toEqual([48, 95]);
    expect(plan?.cells[2]).toEqual([46, 95]);

    // Advance simulation until plan completes
    for (let i = 0; i < 600; i++) {
      sim.advance(33.34);
      if (!sim.construction.planFor(builder.id)) break;
    }

    // Builder should not be trapped and all 3 barricades built
    for (const [x, y] of cells) {
      const b = sim.entities.atCell(x, y);
      expect(b).toBeDefined();
      expect(b?.category).toBe('building');
    }
  });

  it('obstáculo surgindo após confirmação interrompe e reembolsa restantes', () => {
    const { sim, builder } = createTestSim();
    sim.construction.instantBuild = true;
    const cells: Point[] = [[46, 95], [47, 95], [48, 95]];
    const initWood = sim.teams.blue.wood;

    sim.issueCommand({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    });

    // Advance 5 ticks so piece 1 completes
    for (let i = 0; i < 5; i++) {
      sim.advance(33.34);
    }

    // Now place an obstacle at cell 3 before it starts
    sim.map.setTerrain(48, 95, 'mountain');

    // Continue simulation
    for (let i = 0; i < 200; i++) {
      sim.advance(33.34);
      if (!sim.construction.planFor(builder.id)) break;
    }

    // Plan should be cancelled because piece 3 is blocked
    expect(sim.construction.planFor(builder.id)).toBeNull();
    // Piece 3 (unstarted) should be refunded
    expect(sim.teams.blue.wood).toBe(initWood - 20); // 2 built, 1 refunded
  });
});
