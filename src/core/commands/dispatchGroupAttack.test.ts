import { describe, expect, it } from 'vitest';
import { Simulation } from '../game/Simulation';
import { dispatchGroupAttack } from './dispatchGroupAttack';

function duel() {
  const simulation = new Simulation(1);
  const soldier = simulation.entities.spawnUnit('blue', 'soldier', 40, 100);
  const enemy = simulation.entities.spawnUnit('red', 'soldier', 41, 100);
  simulation.fog.update();
  soldier.cooldownUntilTick = 60;
  return { simulation, soldier, enemy };
}

describe('attack order during cooldown', () => {
  it('is refused by default, as for the computer players', () => {
    const { simulation, soldier, enemy } = duel();
    const [order] = dispatchGroupAttack(simulation, 'blue', [soldier.id], enemy.id);
    expect(order.result).toEqual({ accepted: false, reason: 'cooldown' });
  });

  it('is kept for a player click and still waits for the cooldown to strike', () => {
    const { simulation, soldier, enemy } = duel();
    const [order] = dispatchGroupAttack(simulation, 'blue', [soldier.id], enemy.id, { queueOnCooldown: true });
    expect(order.result.accepted).toBe(true);
    expect(simulation.combat.manualTargetFor(soldier.id)).toBe(enemy.id);
    expect(enemy.hp).toBe(enemy.maxHp);
    simulation.advance(2500);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });
});
