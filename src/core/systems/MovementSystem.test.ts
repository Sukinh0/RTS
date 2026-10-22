import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS, TICKS_PER_SECOND } from '../../config/runtime';
import { BALANCE } from '../../config/balance';
import { findPath } from '../../map/findPath';
import { dispatchGroupMove } from '../commands/dispatchGroupMove';
import { Simulation } from '../game/Simulation';

function move(simulation: Simulation, unitId: string, x: number, y: number) {
  return simulation.issueCommand({ type: 'move', team: 'blue', unitId, destination: [x, y] });
}

describe('contested movement', () => {
  it('alternates which team resolves a contested cell first across seconds', () => {
    for (const [tick, expected] of [[1, 'blue'], [31, 'red']] as const) {
      const simulation = new Simulation(1);
      const blue = simulation.entities.spawnUnit('blue', 'soldier', 30, 99);
      const red = simulation.entities.spawnUnit('red', 'soldier', 32, 99);
      expect(simulation.movement.issue({ type: 'move', team: 'blue', unitId: blue.id, destination: [31, 99] }, 0).accepted).toBe(true);
      expect(simulation.movement.issue({ type: 'move', team: 'red', unitId: red.id, destination: [31, 99] }, 0).accepted).toBe(true);
      simulation.movement.update(tick);
      expect(simulation.entities.atCell(31, 99)?.team).toBe(expected);
    }
  });
});

describe('interrupted movement', () => {
  it('reports when a previously accepted destination becomes blocked', () => {
    const simulation = new Simulation(1);
    expect(move(simulation, 'blue-worker-1', 30, 99).accepted).toBe(true);
    simulation.map.setTerrain(30, 99, 'water');
    simulation.movement.update(1);
    expect(simulation.movement.drainFailures()).toEqual([{ unitId: 'blue-worker-1', reason: 'no-path' }]);
    expect(simulation.entities.get('blue-worker-1')).toMatchObject({ x: 25, moveTarget: null });
  });
});

describe('archer pacing', () => {
  it('moves three cells per action but keeps a four-second attack cooldown', () => {
    const simulation = new Simulation(1);
    const archer = simulation.entities.spawnUnit('blue', 'archer', 30, 99);
    const enemy = simulation.entities.spawnUnit('red', 'soldier', 37, 99);
    expect(archer.movement).toBe(3);
    expect(archer.cooldownSeconds).toBe(4);
    expect(simulation.movement.issue({ type: 'move', team: 'blue', unitId: archer.id, destination: [33, 99] }, 0).accepted).toBe(true);
    simulation.movement.update(1);
    expect(archer.x).toBe(33);
    simulation.fog.update();
    const attack = { type: 'attack' as const, team: 'blue' as const, unitId: archer.id, targetId: enemy.id };
    expect(simulation.combat.issue(attack, 31).accepted).toBe(true);
    expect(enemy.hp).toBe(10);
    expect(simulation.combat.issue(attack, 150)).toEqual({ accepted: false, reason: 'cooldown' });
    expect(simulation.combat.issue(attack, 151).accepted).toBe(true);
  });
});

describe('Fase 3 movement', () => {
  it('rejects water, mountain, building and occupied destinations', () => {
    const simulation = new Simulation(1);
    for (const [x, y] of [[70, 25], [73, 86], [20, 100], [25, 101]]) {
      expect(move(simulation, 'blue-worker-1', x, y)).toEqual({ accepted: false, reason: 'invalid-destination' });
    }
    expect(simulation.entities.get('blue-worker-1')).toMatchObject({ x: 25, y: 99 });
  });

  it('enforces ownership and stable unit IDs', () => {
    const simulation = new Simulation(1);
    expect(move(simulation, 'red-worker-1', 170, 99)).toEqual({ accepted: false, reason: 'wrong-owner' });
    expect(move(simulation, 'missing', 30, 99)).toEqual({ accepted: false, reason: 'unknown-unit' });
    expect(move(simulation, 'blue-base', 30, 99)).toEqual({ accepted: false, reason: 'unknown-unit' });
  });

  it('moves at most the configured range per action and waits for cooldown', () => {
    const simulation = new Simulation(1);
    expect(move(simulation, 'blue-worker-1', 36, 99)).toEqual({ accepted: true });
    simulation.advance(FIXED_STEP_MS);
    expect(simulation.entities.get('blue-worker-1')).toMatchObject({ x: 30, y: 99 });
    expect(move(simulation, 'blue-worker-1', 40, 99)).toEqual({ accepted: true });
    expect(simulation.entities.get('blue-worker-1')).toMatchObject({ moveTarget: [40, 99] });
    const movementCooldownTicks = Math.round(BALANCE.units.worker.movementCooldownSeconds * TICKS_PER_SECOND);
    simulation.advance(FIXED_STEP_MS * (movementCooldownTicks - 1));
    expect(simulation.entities.get('blue-worker-1')).toMatchObject({ x: 30, y: 99 });
    simulation.advance(FIXED_STEP_MS);
    expect(simulation.entities.get('blue-worker-1')).toMatchObject({ x: 35, y: 99 });
    expect(simulation.clock.ticks).toBe(movementCooldownTicks + 1);
  });

  it('does not move into a newly occupied cell', () => {
    const simulation = new Simulation(1);
    expect(simulation.entities.moveUnit('blue-worker-2', 30, 99)).toBe(true);
    expect(move(simulation, 'blue-worker-1', 30, 99)).toEqual({ accepted: false, reason: 'invalid-destination' });
    expect(simulation.entities.moveUnit('blue-worker-1', 30, 99)).toBe(false);
  });

  it('routes around an intermediate unit without passing through it', () => {
    const simulation = new Simulation(1);
    expect(simulation.entities.moveUnit('blue-worker-2', 27, 99)).toBe(true);
    const path = findPath(simulation.map, [25, 99], [30, 99],
      (x, y) => simulation.entities.isFreeForUnit(x, y, 'blue-worker-1'));
    expect(path).not.toBeNull();
    expect(path).not.toContainEqual([27, 99]);
    expect(move(simulation, 'blue-worker-1', 30, 99)).toEqual({ accepted: true });
    simulation.advance(FIXED_STEP_MS);
    expect(simulation.entities.get('blue-worker-1')).not.toMatchObject({ x: 27, y: 99 });
  });

  it('assigns distinct cells to a selected group through the command API', () => {
    const simulation = new Simulation(1);
    const results = dispatchGroupMove(simulation, 'blue', ['blue-worker-1', 'blue-worker-2'], [40, 99]);
    expect(results.every(({ result }) => result.accepted)).toBe(true);
    const first = simulation.entities.get('blue-worker-1');
    const second = simulation.entities.get('blue-worker-2');
    expect(first?.category === 'unit' && second?.category === 'unit' && first.moveTarget).not.toEqual(second?.category === 'unit' && second.moveTarget);
    simulation.advance(FIXED_STEP_MS);
    expect([first?.x, first?.y]).not.toEqual([second?.x, second?.y]);
  });

  it('preserva movimento de grupo sem abortar marcha por congestionamento temporário entre aliados', () => {
    const simulation = new Simulation(1);
    // Spawna 3 soldados alinhados
    const u1 = simulation.entities.spawnUnit('blue', 'soldier', 30, 99);
    const u2 = simulation.entities.spawnUnit('blue', 'soldier', 29, 99);
    const u3 = simulation.entities.spawnUnit('blue', 'soldier', 28, 99);

    // Despacha todos para x=45
    const results = dispatchGroupMove(simulation, 'blue', [u1.id, u2.id, u3.id], [45, 99]);
    expect(results.every((r) => r.result.accepted)).toBe(true);

    // Avança 15 segundos de simulação
    for (let i = 0; i < 15; i++) {
      simulation.advance(1000);
    }

    // Nenhuma unidade deve ter abortado prematuramente com falha de 'no-path'
    expect(simulation.movement.drainFailures()).toHaveLength(0);

    // Todos os soldados devem ter avançado significativamente rumo ao destino (x >= 40)
    expect(u1.x).toBeGreaterThanOrEqual(40);
    expect(u2.x).toBeGreaterThanOrEqual(40);
    expect(u3.x).toBeGreaterThanOrEqual(40);
  });

  it('atribui destino e avança unidades de um grupo mesmo quando alguma unidade está sob cooldown', () => {
    const simulation = new Simulation(1);
    const u1 = simulation.entities.spawnUnit('blue', 'soldier', 30, 95);
    const u2 = simulation.entities.spawnUnit('blue', 'soldier', 30, 96);
    const u3 = simulation.entities.spawnUnit('blue', 'soldier', 30, 97);
    const u4 = simulation.entities.spawnUnit('blue', 'soldier', 30, 98);

    // Simula cooldown ativo em u2 e u3 (ex: logo após ataque ou marcha)
    u2.cooldownUntilTick = simulation.clock.ticks + 20;
    u3.cooldownUntilTick = simulation.clock.ticks + 15;

    const results = dispatchGroupMove(simulation, 'blue', [u1.id, u2.id, u3.id, u4.id], [50, 96]);
    expect(results.every((r) => r.result.accepted)).toBe(true);

    // Todas as unidades devem ter recebido um moveTarget válido
    expect(u1.moveTarget).not.toBeNull();
    expect(u2.moveTarget).not.toBeNull();
    expect(u3.moveTarget).not.toBeNull();
    expect(u4.moveTarget).not.toBeNull();

    // Avança simulação
    for (let i = 0; i < 15; i++) {
      simulation.advance(1000);
    }

    // Nenhuma unidade deve ter ficado estática na posição original
    expect(u1.x).toBeGreaterThan(30);
    expect(u2.x).toBeGreaterThan(30);
    expect(u3.x).toBeGreaterThan(30);
    expect(u4.x).toBeGreaterThan(30);
  });

  it('permite que unidade completamente cercada por aliados receba e execute ordem de avanço de grupo', () => {
    const simulation = new Simulation(1);
    const center = simulation.entities.spawnUnit('blue', 'soldier', 30, 90);
    const east = simulation.entities.spawnUnit('blue', 'soldier', 31, 90);
    const west = simulation.entities.spawnUnit('blue', 'soldier', 29, 90);
    const south = simulation.entities.spawnUnit('blue', 'soldier', 30, 91);
    const north = simulation.entities.spawnUnit('blue', 'soldier', 30, 89);

    const group = [center.id, east.id, west.id, south.id, north.id];
    const results = dispatchGroupMove(simulation, 'blue', group, [55, 90]);
    expect(results.every((r) => r.result.accepted)).toBe(true);
    expect(center.moveTarget).not.toBeNull();

    for (let i = 0; i < 15; i++) {
      simulation.advance(1000);
    }

    // A unidade central cercada não ficou estática: avançou junto com o grupo
    expect(center.x).toBeGreaterThanOrEqual(45);
    expect(east.x).toBeGreaterThanOrEqual(45);
    expect(west.x).toBeGreaterThanOrEqual(45);
  });
});

