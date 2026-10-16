import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../config/balance';
import { FIXED_STEP_MS, TICKS_PER_SECOND } from '../../config/runtime';
import { Simulation } from '../game/Simulation';

describe('simultaneous combat resolution', () => {
  it('allows both sides to attack in the same tick', () => {
    const simulation = new Simulation(1);
    const blue = simulation.entities.spawnUnit('blue', 'soldier', 30, 99);
    const red = simulation.entities.spawnUnit('red', 'soldier', 32, 99);
    blue.hp = 5;
    red.hp = 5;
    simulation.fog.update();
    expect(simulation.combat.update(0)).toBe(2);
    expect(simulation.entities.get(blue.id)).toBeUndefined();
    expect(simulation.entities.get(red.id)).toBeUndefined();
  });
});

describe('Fase 7 — Combate e atributos das tropas', () => {
  it('dano correto: soldado causa 5 e arqueiro causa 8', () => {
    const simulation = new Simulation(1);
    const blueSoldier = simulation.entities.spawnUnit('blue', 'soldier', 28, 99);
    const redSoldier = simulation.entities.spawnUnit('red', 'soldier', 30, 99);
    simulation.fog.update();
    expect(redSoldier.hp).toBe(18);

    const attackRes = simulation.issueCommand({
      type: 'attack', team: 'blue', unitId: blueSoldier.id, targetId: redSoldier.id,
    });
    expect(attackRes).toEqual({ accepted: true });
    expect(redSoldier.hp).toBe(13); // 18 - 5

    // Archer damage test
    const blueArcher = simulation.entities.spawnUnit('blue', 'archer', 28, 98);
    simulation.fog.update();
    const attackRes2 = simulation.issueCommand({
      type: 'attack', team: 'blue', unitId: blueArcher.id, targetId: redSoldier.id,
    });
    expect(attackRes2).toEqual({ accepted: true });
    expect(redSoldier.hp).toBe(5); // 13 - 8
  });

  it('operário causa 4 de dano adjacente; unidades sem dano não podem atacar', () => {
    const simulation = new Simulation(1);
    const worker = simulation.entities.get('blue-worker-1')!;
    const enemy = simulation.entities.spawnUnit('red', 'soldier', 26, 99);
    simulation.fog.update();

    const res = simulation.issueCommand({
      type: 'attack', team: 'blue', unitId: worker.id, targetId: enemy.id,
    });
    expect(res).toEqual({ accepted: true });
    expect(enemy.hp).toBe(14);

    const shieldbearer = simulation.entities.spawnUnit('blue', 'shieldbearer', 25, 98);
    const res2 = simulation.issueCommand({
      type: 'attack', team: 'blue', unitId: shieldbearer.id, targetId: enemy.id,
    });
    expect(res2).toEqual({ accepted: false, reason: 'cannot-attack' });

    const scout = simulation.entities.spawnUnit('blue', 'scout', 25, 97);
    const res3 = simulation.issueCommand({
      type: 'attack', team: 'blue', unitId: scout.id, targetId: enemy.id,
    });
    expect(res3).toEqual({ accepted: false, reason: 'cannot-attack' });
  });

  it('operário parado reage a inimigo adjacente usando o cooldown normal', () => {
    const simulation = new Simulation(1);
    const worker = simulation.entities.get('blue-worker-1')!;
    const enemy = simulation.entities.spawnUnit('red', 'soldier', 26, 99);
    simulation.fog.update();

    expect(simulation.combat.update(0)).toBe(2);
    expect(enemy.hp).toBe(14);
    expect(worker.hp).toBe(5);
    expect(simulation.combat.update(1)).toBe(0);
  });

  it('alcance correto: respeita limite de alcance e rejeita fora de alcance', () => {
    const simulation = new Simulation(1);
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 28, 99);
    // Target at dist 3 (visible because vision is 5, but outside range 2)
    const enemyFar = simulation.entities.spawnUnit('red', 'soldier', 31, 99);
    simulation.fog.update();

    const res = simulation.issueCommand({
      type: 'attack', team: 'blue', unitId: soldier.id, targetId: enemyFar.id,
    });
    expect(res).toEqual({ accepted: false, reason: 'out-of-range' });

    // Target at dist 2 (range of soldier)
    const enemyInRange = simulation.entities.spawnUnit('red', 'soldier', 30, 99);
    simulation.fog.update();
    const res2 = simulation.issueCommand({
      type: 'attack', team: 'blue', unitId: soldier.id, targetId: enemyInRange.id,
    });
    expect(res2).toEqual({ accepted: true });

    // Archer range 4
    const archer = simulation.entities.spawnUnit('blue', 'archer', 27, 95);
    const archerEnemyDist4 = simulation.entities.spawnUnit('red', 'soldier', 27, 99); // dist 4 <= 4
    simulation.fog.update();
    expect(simulation.issueCommand({
      type: 'attack', team: 'blue', unitId: archer.id, targetId: archerEnemyDist4.id,
    })).toEqual({ accepted: true });
  });

  it('cooldown impede nova ação manual até expirar', () => {
    const simulation = new Simulation(1);
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 28, 99);
    const enemy = simulation.entities.spawnUnit('red', 'soldier', 29, 99);
    simulation.fog.update();

    expect(simulation.issueCommand({
      type: 'attack', team: 'blue', unitId: soldier.id, targetId: enemy.id,
    })).toEqual({ accepted: true });

    // Immediate second attack is rejected with cooldown
    expect(simulation.issueCommand({
      type: 'attack', team: 'blue', unitId: soldier.id, targetId: enemy.id,
    })).toEqual({ accepted: false, reason: 'cooldown' });

    // Move is also rejected with cooldown
    expect(simulation.issueCommand({
      type: 'move', team: 'blue', unitId: soldier.id, destination: [27, 99],
    })).toEqual({ accepted: false, reason: 'cooldown' });

    // Advance until 1 tick before cooldown ends
    const totalTicks = BALANCE.units.soldier.cooldownSeconds * TICKS_PER_SECOND;
    for (let i = 0; i < totalTicks - 1; i += 1) {
      simulation.advance(FIXED_STEP_MS);
      // Still on cooldown
      expect(simulation.issueCommand({
        type: 'move', team: 'blue', unitId: soldier.id, destination: [27, 99],
      })).toEqual({ accepted: false, reason: 'cooldown' });
    }

    // Move enemy out of range before final tick so auto-attack does not fire
    simulation.entities.moveUnit(enemy.id, 45, 99);
    simulation.advance(FIXED_STEP_MS);

    // After cooldown has expired, manual move command is accepted
    expect(simulation.issueCommand({
      type: 'move', team: 'blue', unitId: soldier.id, destination: [27, 99],
    })).toEqual({ accepted: true });
  });

  it('morte em HP <= 0 remove a unidade do EntityStore', () => {
    const simulation = new Simulation(1);
    const archer = simulation.entities.spawnUnit('blue', 'archer', 28, 99);
    // Scout has 8 HP, archer deals 8 damage -> 1 shot kill
    const scout = simulation.entities.spawnUnit('red', 'scout', 29, 99);
    simulation.fog.update();
    expect(scout.hp).toBe(8);

    simulation.issueCommand({
      type: 'attack', team: 'blue', unitId: archer.id, targetId: scout.id,
    });

    expect(simulation.entities.get(scout.id)).toBeUndefined();
    expect(simulation.entities.atCell(29, 99)).toBeUndefined();
  });

  it('autoataque só ataca inimigos visíveis e respeita fog', () => {
    const simulation = new Simulation(1);
    const redSoldier = simulation.entities.spawnUnit('red', 'soldier', 170, 99);
    simulation.fog.update();

    // Enemy in fog (not visible to blue)
    expect(simulation.fog.isEntityVisible('blue', redSoldier)).toBe(false);

    const blueSoldier = simulation.entities.spawnUnit('blue', 'soldier', 28, 99);
    expect(simulation.issueCommand({
      type: 'attack', team: 'blue', unitId: blueSoldier.id, targetId: redSoldier.id,
    })).toEqual({ accepted: false, reason: 'target-not-visible' });

    // Red soldier placed close to blue base (visible)
    const redNearby = simulation.entities.spawnUnit('red', 'soldier', 29, 99);
    simulation.fog.update();
    expect(simulation.fog.isEntityVisible('blue', redNearby)).toBe(true);

    // Auto-attack on simulation tick
    simulation.advance(FIXED_STEP_MS);
    expect(redNearby.hp).toBe(18 - 5); // Blue soldier auto-attacked redNearby!
  });

  it('ordem manual tem prioridade sobre autoalvo', () => {
    const simulation = new Simulation(1);
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 28, 99);
    // Target A: closer (dist 1) with lower HP
    const targetA = simulation.entities.spawnUnit('red', 'soldier', 29, 99);
    targetA.hp = 10;
    // Target B: further (dist 2) with higher HP
    const targetB = simulation.entities.spawnUnit('red', 'soldier', 30, 99);
    targetB.hp = 18;
    simulation.fog.update();

    // Issue manual attack order targeting B
    expect(simulation.issueCommand({
      type: 'attack', team: 'blue', unitId: soldier.id, targetId: targetB.id,
    })).toEqual({ accepted: true });

    // Target B took damage, not target A
    expect(targetB.hp).toBe(13);
    expect(targetA.hp).toBe(10);
  });

  it('Scenario 001 — prioridade após movimento', () => {
    // Soldado A move e entra no alcance de B.
    // A fica em cooldown.
    // B está disponível.
    // B ataca primeiro.
    const simulation = new Simulation(1);
    const soldierA = simulation.entities.spawnUnit('blue', 'soldier', 26, 99);
    const soldierB = simulation.entities.spawnUnit('red', 'soldier', 30, 99);
    simulation.fog.update();

    // Distance is 4 (> range 2). Neither can attack yet.
    // Soldier A moves towards B (to (28, 99), distance 2 from B)
    expect(simulation.issueCommand({
      type: 'move', team: 'blue', unitId: soldierA.id, destination: [28, 99],
    })).toEqual({ accepted: true });

    // Tick advances: A moves, enters cooldown. B is available and attacks A!
    simulation.advance(FIXED_STEP_MS);

    expect(soldierA.x).toBe(28);
    expect(soldierA.hp).toBe(18 - 5); // B attacked A!
    expect(soldierB.hp).toBe(18);     // A was in cooldown and did NOT attack B!
  });

  it('Scenario 002 — operário emboscado na fog', () => {
    // Operário entra em área desconhecida.
    // Descobre inimigos.
    // Está em cooldown e não pode recuar imediatamente.
    // Inimigo disponível pode atacar.
    const simulation = new Simulation(1);
    const worker = simulation.entities.get('blue-worker-1')!;
    const redSoldier = simulation.entities.spawnUnit('red', 'soldier', 31, 99);
    simulation.fog.update();
    expect(redSoldier.hp).toBe(18);

    // Worker moves to (30, 99), adjacent to red soldier
    simulation.issueCommand({
      type: 'move', team: 'blue', unitId: worker.id, destination: [30, 99],
    });

    simulation.advance(FIXED_STEP_MS);
    expect(worker.x).toBe(30);

    // Worker is in cooldown and cannot retreat immediately
    const retreatRes = simulation.issueCommand({
      type: 'move', team: 'blue', unitId: worker.id, destination: [29, 99],
    });
    expect(retreatRes).toEqual({ accepted: false, reason: 'cooldown' });

    // Red soldier was available and attacked worker
    expect(worker.hp).toBe(10 - 5);
  });

  it('Scenario 003 — escudeiro reflete 80% arredondado para baixo de atacante adjacente', () => {
    // Atacante adjacente causa 5.
    // Escudeiro perde 5.
    // Atacante recebe 4.
    const simulation = new Simulation(1);
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 28, 99);
    const shieldbearer = simulation.entities.spawnUnit('red', 'shieldbearer', 29, 99); // adjacent dist 1
    simulation.fog.update();

    expect(shieldbearer.hp).toBe(25);
    expect(soldier.hp).toBe(18);

    simulation.issueCommand({
      type: 'attack', team: 'blue', unitId: soldier.id, targetId: shieldbearer.id,
    });

    expect(shieldbearer.hp).toBe(20); // 25 - 5
    expect(soldier.hp).toBe(14);      // 18 - 4 (floor(5 * 0.8) = 4)
  });

  it('Scenario 004 — arqueiro fora da adjacência ataca escudeiro sem receber reflexão', () => {
    // Arqueiro ataca escudeiro a distância >1.
    // Não recebe reflexão.
    const simulation = new Simulation(1);
    const archer = simulation.entities.spawnUnit('blue', 'archer', 27, 99);
    const shieldbearer = simulation.entities.spawnUnit('red', 'shieldbearer', 29, 99); // dist 2 > 1
    simulation.fog.update();

    expect(archer.hp).toBe(10);
    expect(shieldbearer.hp).toBe(25);

    simulation.issueCommand({
      type: 'attack', team: 'blue', unitId: archer.id, targetId: shieldbearer.id,
    });

    expect(shieldbearer.hp).toBe(17); // 25 - 8
    expect(archer.hp).toBe(10);       // 0 reflection because distance > 1
  });

  it('Scenario 005 — batedor: invisível sem inimigo <= 5, detectável e atacável com inimigo <= 5', () => {
    const simulation = new Simulation(1);
    const scout = simulation.entities.spawnUnit('red', 'scout', 50, 50);
    simulation.fog.update();

    // Scout is outside detection distance of blue
    expect(simulation.fog.isEntityVisible('blue', scout)).toBe(false);

    // Blue soldier placed near scout (distance 2 <= 5)
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 48, 50);
    simulation.fog.update();
    expect(simulation.fog.isEntityVisible('blue', scout)).toBe(true);

    // Soldier can now attack scout
    expect(simulation.issueCommand({
      type: 'attack', team: 'blue', unitId: soldier.id, targetId: scout.id,
    })).toEqual({ accepted: true });
    expect(scout.hp).toBe(3); // 8 - 5
  });

  it('reflexão não encadeia', () => {
    const simulation = new Simulation(1);
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 28, 99);
    const shieldbearer = simulation.entities.spawnUnit('red', 'shieldbearer', 29, 99);
    simulation.fog.update();

    simulation.combat.drainEvents();
    simulation.issueCommand({
      type: 'attack', team: 'blue', unitId: soldier.id, targetId: shieldbearer.id,
    });

    const newEvents = simulation.combat.drainEvents();
    expect(newEvents).toHaveLength(1);
    expect(newEvents[0]).toMatchObject({
      damage: 5,
      reflectedDamage: 4,
    });
    // Shieldbearer did not take reflected damage from soldier
    expect(shieldbearer.hp).toBe(20);
  });

  it('ataque contra construções inimigas e destruição da base', () => {
    const simulation = new Simulation(1);
    const redBase = simulation.entities.get('red-base')!;
    expect(redBase.hp).toBe(150);

    // Red base footprint is [176, 100] to [179, 103]
    // Spawn blue soldier at [174, 100] (dist 2 from (176, 100))
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 174, 100);
    simulation.fog.update();

    // Soldier attacks red base
    expect(simulation.issueCommand({
      type: 'attack', team: 'blue', unitId: soldier.id, targetId: redBase.id,
    })).toEqual({ accepted: true });

    expect(redBase.hp).toBe(145);

    // Reduce base HP to 5 and destroy it
    redBase.hp = 5;
    simulation.advance(BALANCE.units.soldier.cooldownSeconds * 1000);
    simulation.issueCommand({
      type: 'attack', team: 'blue', unitId: soldier.id, targetId: redBase.id,
    });

    expect(simulation.entities.get('red-base')).toBeUndefined();
    // Map structure cleared
    expect(simulation.map.cellAt(176, 100)?.structureTeam).toBeNull();
  });
});
