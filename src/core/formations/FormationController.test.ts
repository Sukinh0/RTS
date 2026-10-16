import { describe, expect, it } from 'vitest';
import { dispatchGroupMove } from '../commands/dispatchGroupMove';
import { Simulation } from '../game/Simulation';
import { FormationController } from './FormationController';

describe('FormationController', () => {
  it('creates a military formation and assigns collective speed to slowest unit', () => {
    const sim = new Simulation(42);
    const controller = new FormationController(sim);

    // Spawn 1 shieldbearer (movement: 2), 1 soldier (movement: 3), 1 scout (movement: 6)
    const shield = sim.instantSpawn('blue', 'shieldbearer', 20, 20)!;
    const soldier = sim.instantSpawn('blue', 'soldier', 21, 20)!;
    const scout = sim.instantSpawn('blue', 'scout', 22, 20)!;

    const group = controller.createFormation('blue', [shield.id, soldier.id, scout.id], 'wedge', [50, 20]);
    expect(group).not.toBeNull();
    expect(group!.collectiveSpeed).toBe(2); // Shieldbearer is the slowest (2)

    // Effective speeds for shield and scout should match formation collective speed
    expect(controller.getEffectiveSpeed(shield)).toBe(2);
    expect(controller.getEffectiveSpeed(scout)).toBe(2);
  });

  it('recalculates collective speed when slowest unit dies', () => {
    const sim = new Simulation(42);
    const controller = new FormationController(sim);

    const shield = sim.instantSpawn('blue', 'shieldbearer', 20, 20)!;
    const soldier = sim.instantSpawn('blue', 'soldier', 21, 20)!;
    const scout = sim.instantSpawn('blue', 'scout', 22, 20)!;

    const group = controller.createFormation('blue', [shield.id, soldier.id, scout.id], 'line', [50, 20])!;
    expect(group.collectiveSpeed).toBe(2);

    // Shieldbearer dies
    controller.handleUnitDeath(shield.id);

    // Group should still exist with soldier (3) and scout (6), slowest is now 3
    expect(group.slots.size).toBe(2);
    expect(group.collectiveSpeed).toBe(3);
    expect(controller.getEffectiveSpeed(scout)).toBe(3);
  });

  it('allows individual unit removal without destroying formation for other units', () => {
    const sim = new Simulation(42);
    const controller = new FormationController(sim);

    const s1 = sim.instantSpawn('blue', 'soldier', 20, 20)!;
    const s2 = sim.instantSpawn('blue', 'soldier', 21, 20)!;
    const s3 = sim.instantSpawn('blue', 'soldier', 22, 20)!;

    const group = controller.createFormation('blue', [s1.id, s2.id, s3.id], 'block', [60, 60])!;
    expect(group.slots.size).toBe(3);

    // Remove s1 individually
    controller.removeUnit(s1.id);

    expect(controller.getFormationForUnit(s1.id)).toBeUndefined();
    expect(controller.getFormationForUnit(s2.id)?.id).toBe(group.id);
    expect(controller.getFormationForUnit(s3.id)?.id).toBe(group.id);
    expect(group.slots.size).toBe(2);

    // Removing s2 leaves only 1 unit, dissolving formation
    controller.removeUnit(s2.id);
    expect(controller.getGroup(group.id)).toBeUndefined();
  });

  it('ignores civilian units when forming military formation', () => {
    const sim = new Simulation(42);
    const controller = new FormationController(sim);

    const worker = sim.instantSpawn('blue', 'worker', 20, 20)!;
    const soldier = sim.instantSpawn('blue', 'soldier', 21, 20)!;

    // Only 1 military unit + 1 worker -> cannot form military formation
    const group = controller.createFormation('blue', [worker.id, soldier.id], 'line', [50, 50]);
    expect(group).toBeNull();
  });

  it('handles stuck unit gracefully so it does not permanently lock collective speed', () => {
    const sim = new Simulation(42);
    const controller = new FormationController(sim);

    const shield = sim.instantSpawn('blue', 'shieldbearer', 20, 20)!;
    const soldier = sim.instantSpawn('blue', 'soldier', 21, 20)!;
    const scout = sim.instantSpawn('blue', 'scout', 22, 20)!;

    const group = controller.createFormation('blue', [shield.id, soldier.id, scout.id], 'line', [50, 20])!;
    expect(group.collectiveSpeed).toBe(2);

    // Mark shield as stuck
    const shieldSlot = group.slots.get(shield.id)!;
    shieldSlot.isStuck = true;

    controller.update(sim.clock.ticks);
    // Collective speed for remaining non-stuck units should now be 3 (soldier)
    expect(group.collectiveSpeed).toBe(3);
  });

  it('marches in formation along spine waypoints maintaining cohesive progression', () => {
    const sim = new Simulation(42);
    const s1 = sim.instantSpawn('blue', 'shieldbearer', 20, 20)!;
    const s2 = sim.instantSpawn('blue', 'soldier', 20, 21)!;

    const results = dispatchGroupMove(sim, 'blue', [s1.id, s2.id], [30, 20], false, 'wedge');
    expect(results.every((r) => r.result.accepted)).toBe(true);

    const group = sim.formations.getFormationForUnit(s1.id)!;
    expect(group).toBeDefined();
    expect(group.spinePath.length).toBeGreaterThan(1);
    expect(group.state).toBe('MARCHANDO');

    const slot1 = group.slots.get(s1.id)!;
    const slot2 = group.slots.get(s2.id)!;

    // Slots should have valid currentTarget initialized along the march
    expect(slot1.currentTarget).toBeDefined();
    expect(slot2.currentTarget).toBeDefined();

    // Advance simulation ticks so units progress along the spine
    for (let t = 0; t < 30; t++) {
      sim.advance(200);
    }

    // Units should have advanced towards destination
    expect(s1.x).toBeGreaterThan(20);
    expect(s2.x).toBeGreaterThan(20);
  });
});
