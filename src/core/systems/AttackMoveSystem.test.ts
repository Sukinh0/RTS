import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS, TICKS_PER_SECOND } from '../../config/runtime';
import { Simulation } from '../game/Simulation';
import { dispatchGroupAttackMove } from '../commands/dispatchGroupMove';

function advanceSeconds(simulation: Simulation, seconds: number): void {
  simulation.advance(FIXED_STEP_MS * TICKS_PER_SECOND * seconds);
}

describe('Fase 7 — Attack Move System', () => {
  it('movimento até destino: unidade em attack-move sem inimigos no caminho chega ao destino', () => {
    const simulation = new Simulation(1);
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 25, 95);
    simulation.fog.update();

    const res = simulation.issueCommand({
      type: 'attack-move',
      team: 'blue',
      unitId: soldier.id,
      destination: [28, 95],
    });
    expect(res).toEqual({ accepted: true });
    expect(soldier.attackMoveTarget).toEqual([28, 95]);

    // Advance enough time to complete movement (distance 3 cells, movement 3 cells/s)
    advanceSeconds(simulation, 2);

    expect(soldier.x).toBe(28);
    expect(soldier.y).toBe(95);
    expect(soldier.moveTarget).toBeNull();
    expect(soldier.attackMoveTarget).toBeNull();
  });

  it('detectar inimigo e atacar: interrompe movimento temporariamente e combate respeitando cooldown', () => {
    const simulation = new Simulation(1);
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 95, 100);
    const enemyWorker = simulation.entities.get('red-worker-1')!;
    simulation.entities.moveUnit(enemyWorker.id, 103, 100);
    simulation.fog.update();

    // Soldier attack-moves towards (115, 100)
    const res = simulation.issueCommand({
      type: 'attack-move',
      team: 'blue',
      unitId: soldier.id,
      destination: [115, 100],
    });
    expect(res).toEqual({ accepted: true });

    // Step into vision, engage and attack
    advanceSeconds(simulation, 2);
    const engagement = simulation.engagements.statusFor(soldier.id);
    expect(engagement).not.toBeNull();
    expect(engagement?.targetId).toBe(enemyWorker.id);
    expect(engagement?.destination).toEqual([115, 100]);

    // Give time for attack to resolve (soldier damage: 5)
    advanceSeconds(simulation, 2);
    expect(enemyWorker.hp).toBeLessThanOrEqual(5);
  });

  it('continuar: após abater o inimigo, continua em direção ao destino original', () => {
    const simulation = new Simulation(1);
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 95, 100);
    const enemyWorker = simulation.entities.get('red-worker-1')!;
    simulation.entities.moveUnit(enemyWorker.id, 105, 100);
    simulation.fog.update();

    expect(simulation.issueCommand({
      type: 'attack-move',
      team: 'blue',
      unitId: soldier.id,
      destination: [120, 100],
    })).toEqual({ accepted: true });

    // Soldier moves, spots worker, attacks until worker dies (hp: 10, damage: 5 -> 2 hits)
    advanceSeconds(simulation, 2);
    expect(simulation.engagements.statusFor(soldier.id)?.targetId).toBe(enemyWorker.id);

    advanceSeconds(simulation, 6);
    expect(simulation.entities.get(enemyWorker.id)).toBeUndefined(); // worker killed

    // Soldier resumes march to (120, 100)
    advanceSeconds(simulation, 8);
    expect(soldier.x).toBe(120);
    expect(soldier.moveTarget).toBeNull();
    expect(soldier.attackMoveTarget).toBeNull();
    expect(simulation.engagements.statusFor(soldier.id)).toBeNull();
  });

  it('múltiplos inimigos: enfrenta cada inimigo em sequência e só então prossegue ao destino', () => {
    const simulation = new Simulation(1);
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 95, 100);

    // Place two enemies along the route
    const enemy1 = simulation.entities.get('red-worker-1')!;
    simulation.entities.moveUnit(enemy1.id, 103, 100);
    const enemy2 = simulation.entities.get('red-worker-2')!;
    simulation.entities.moveUnit(enemy2.id, 107, 100);
    simulation.fog.update();

    expect(simulation.issueCommand({
      type: 'attack-move',
      team: 'blue',
      unitId: soldier.id,
      destination: [120, 100],
    })).toEqual({ accepted: true });

    // Engage and destroy first enemy (worker hp: 10, soldier damage: 5 -> 2 hits = ~6s)
    advanceSeconds(simulation, 7);
    expect(simulation.entities.get(enemy1.id)).toBeUndefined();

    // Spots and engages second enemy
    advanceSeconds(simulation, 7);
    expect(simulation.entities.get(enemy2.id)).toBeUndefined();

    // Both dead: now continues and reaches destination
    advanceSeconds(simulation, 8);
    expect(soldier.x).toBe(120);
    expect(soldier.moveTarget).toBeNull();
    expect(soldier.attackMoveTarget).toBeNull();
    expect(simulation.engagements.statusFor(soldier.id)).toBeNull();
  });

  it('unidades sem ataque: construtor ou batedor (dano 0) não combatem e apenas avançam até o destino', () => {
    const simulation = new Simulation(1);
    const scout = simulation.entities.spawnUnit('blue', 'scout', 95, 100);
    const enemyWorker = simulation.entities.get('red-worker-1')!;
    simulation.entities.moveUnit(enemyWorker.id, 103, 100);
    simulation.fog.update();

    expect(scout.damage).toBe(0);

    const res = simulation.issueCommand({
      type: 'attack-move',
      team: 'blue',
      unitId: scout.id,
      destination: [115, 100],
    });
    expect(res).toEqual({ accepted: true });

    // Scout marches past enemy without engaging
    advanceSeconds(simulation, 2);
    expect(simulation.engagements.statusFor(scout.id)).toBeNull();
    expect(enemyWorker.hp).toBe(10); // unaffected

    advanceSeconds(simulation, 3);
    expect(scout.x).toBe(115);
    expect(scout.moveTarget).toBeNull();
    expect(scout.attackMoveTarget).toBeNull();
  });

  it('barricada bloqueando caminho: destrói a barricada inimiga obstrutiva e continua ao destino', () => {
    const simulation = new Simulation(1);
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 20, 95);

    // Wall off corridor at x=22 completely from mountain/water (e.g. y from 0 to 199 or a tight choke)
    // To create an impassable choke from (20, 95) to (24, 95):
    // Fill impassable terrain or barricades across x=22
    for (let y = 0; y < 200; y += 1) simulation.map.setTerrain(22, y, 'mountain');
    simulation.map.setTerrain(22, 95, 'plain');
    simulation.entities.createBuilding('red', 'barricade', 22, 95, false);
    simulation.fog.update();

    const targetBarricade = simulation.entities.atCell(22, 95)!;

    // Normal move to (24, 95) is rejected because corridor at x=22 is completely closed
    const normalMove = simulation.issueCommand({
      type: 'move',
      team: 'blue',
      unitId: soldier.id,
      destination: [24, 95],
    });
    expect(normalMove).toEqual({ accepted: false, reason: 'no-path' });

    // Attack-move to (24, 95) is ACCEPTED because soldier can destroy blocking enemy barricade
    const attackMove = simulation.issueCommand({
      type: 'attack-move',
      team: 'blue',
      unitId: soldier.id,
      destination: [24, 95],
    });
    expect(attackMove).toEqual({ accepted: true });

    // Soldier targets the blocking barricade at (22, 95) and attacks it
    advanceSeconds(simulation, 2);
    expect(simulation.engagements.statusFor(soldier.id)?.targetId).toBe(targetBarricade.id);

    // Barricade has 40 HP, soldier deals 5 damage every 3s -> 8 attacks = 24s
    advanceSeconds(simulation, 26);
    expect(simulation.entities.get(targetBarricade.id)).toBeUndefined(); // destroyed!

    // Path at (22, 95) is cleared, and soldier continues to destination (24, 95)
    advanceSeconds(simulation, 4);
    expect(soldier.x).toBe(24);
    expect(soldier.y).toBe(95);
    expect(soldier.moveTarget).toBeNull();
    expect(soldier.attackMoveTarget).toBeNull();
  });

  it('diferenciação: movimento normal NÃO se desvia para atacar inimigos avistados', () => {
    const simulation = new Simulation(1);
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 95, 100);
    const enemyWorker = simulation.entities.get('red-worker-1')!;
    simulation.entities.moveUnit(enemyWorker.id, 103, 100);
    simulation.fog.update();

    // Regular move
    expect(simulation.issueCommand({
      type: 'move',
      team: 'blue',
      unitId: soldier.id,
      destination: [115, 100],
    })).toEqual({ accepted: true });

    advanceSeconds(simulation, 2);
    // Must NOT divert
    expect(simulation.engagements.statusFor(soldier.id)).toBeNull();
    expect(soldier.attackMoveTarget).toBeNull();

    advanceSeconds(simulation, 6);
    expect(soldier.x).toBe(115);
    expect(enemyWorker.hp).toBe(10); // not attacked along the way
  });

  it('attack-move em grupo: coordena múltiplos combatentes em direção ao destino', () => {
    const simulation = new Simulation(1);
    const soldier1 = simulation.entities.spawnUnit('blue', 'soldier', 94, 99);
    const soldier2 = simulation.entities.spawnUnit('blue', 'soldier', 94, 101);
    const enemyWorker = simulation.entities.get('red-worker-1')!;
    simulation.entities.moveUnit(enemyWorker.id, 103, 100);
    simulation.fog.update();

    const results = dispatchGroupAttackMove(simulation, 'blue', [soldier1.id, soldier2.id], [115, 100]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.result.accepted)).toBe(true);

    advanceSeconds(simulation, 3);
    // At least one soldier engages the enemy worker
    const engagement1 = simulation.engagements.statusFor(soldier1.id);
    const engagement2 = simulation.engagements.statusFor(soldier2.id);
    expect(engagement1 !== null || engagement2 !== null).toBe(true);

    // After destroying worker, both soldiers arrive near destination
    advanceSeconds(simulation, 10);
    expect(simulation.entities.get(enemyWorker.id)).toBeUndefined();
    expect(soldier1.x).toBeGreaterThanOrEqual(113);
    expect(soldier2.x).toBeGreaterThanOrEqual(113);
  });

  it('ordem explícita manual tem prioridade sobre attack-move automático', () => {
    const simulation = new Simulation(1);
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 95, 100);
    const enemyWorker = simulation.entities.get('red-worker-1')!;
    simulation.entities.moveUnit(enemyWorker.id, 103, 100);
    simulation.fog.update();

    simulation.issueCommand({
      type: 'attack-move',
      team: 'blue',
      unitId: soldier.id,
      destination: [115, 100],
    });

    advanceSeconds(simulation, 2);
    expect(simulation.engagements.statusFor(soldier.id)?.targetId).toBe(enemyWorker.id);

    // Advance until soldier's attack cooldown has expired
    while (simulation.clock.ticks < soldier.cooldownUntilTick) {
      advanceSeconds(simulation, 0.5);
    }

    const retreatRes = simulation.issueCommand({
      type: 'move',
      team: 'blue',
      unitId: soldier.id,
      destination: [90, 100],
    });
    expect(retreatRes).toEqual({ accepted: true });

    // Engagement is cancelled, attackMoveTarget cleared, unit retreats
    expect(simulation.engagements.statusFor(soldier.id)).toBeNull();
    expect(soldier.attackMoveTarget).toBeNull();
    expect(soldier.moveTarget).toEqual([90, 100]);
  });
});
