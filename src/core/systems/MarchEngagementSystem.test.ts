import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS, TICKS_PER_SECOND } from '../../config/runtime';
import { Simulation } from '../game/Simulation';

function advanceSeconds(simulation: Simulation, seconds: number): void {
  simulation.advance(FIXED_STEP_MS * TICKS_PER_SECOND * seconds);
}

describe('engagement during a march', () => {
  it('does not divert a moving worker from its destination', () => {
    const simulation = new Simulation(1);
    const worker = simulation.entities.get('blue-worker-1')!;
    if (worker.category !== 'unit') throw new Error('Expected a worker unit');
    simulation.entities.spawnUnit('red', 'soldier', 28, 99);
    simulation.fog.update();
    expect(simulation.issueCommand({ type: 'move', team: 'blue', unitId: worker.id, destination: [30, 99] })).toEqual({ accepted: true });

    simulation.engagements.update(0);

    expect(simulation.engagements.statusFor(worker.id)).toBeNull();
    expect(worker.moveTarget).toEqual([30, 99]);
  });

  it('pursues a newly seen enemy, attacks, then resumes the original destination on attack-move', () => {
    const simulation = new Simulation(1);
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 95, 100);
    const worker = simulation.entities.get('red-worker-1')!;
    simulation.entities.moveUnit(worker.id, 105, 100);
    simulation.fog.update();
    expect(simulation.fog.isEntityVisible('blue', worker)).toBe(false);
    expect(simulation.issueCommand({ type: 'attack-move', team: 'blue', unitId: soldier.id, destination: [120, 100] })).toEqual({ accepted: true });

    advanceSeconds(simulation, 2);
    expect(simulation.engagements.statusFor(soldier.id)).toMatchObject({ targetId: worker.id, destination: [120, 100] });
    advanceSeconds(simulation, 6);
    expect(simulation.entities.get(worker.id)).toBeUndefined();
    advanceSeconds(simulation, 8);
    expect(soldier.x).toBe(120);
    expect(soldier.moveTarget).toBeNull();
    expect(simulation.engagements.statusFor(soldier.id)).toBeNull();
  });

  it('does not divert a soldier on normal move from its destination', () => {
    const simulation = new Simulation(1);
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 95, 100);
    const worker = simulation.entities.get('red-worker-1')!;
    simulation.entities.moveUnit(worker.id, 105, 100);
    simulation.fog.update();
    expect(simulation.issueCommand({ type: 'move', team: 'blue', unitId: soldier.id, destination: [120, 100] })).toEqual({ accepted: true });

    advanceSeconds(simulation, 2);
    // Soldier on normal move must NOT be diverted by the enemy worker
    expect(simulation.engagements.statusFor(soldier.id)).toBeNull();
    expect(soldier.attackMoveTarget).toBeNull();
  });

  it('ignores an enemy outside its own vision and a stealth scout outside detection range', () => {
    const simulation = new Simulation(2);
    const archer = simulation.entities.spawnUnit('blue', 'archer', 26, 99);
    const scout = simulation.entities.spawnUnit('red', 'scout', 32, 99);
    simulation.fog.update();
    expect(simulation.fog.isEntityVisible('blue', scout)).toBe(false);
    expect(simulation.issueCommand({ type: 'move', team: 'blue', unitId: archer.id, destination: [26, 98] })).toEqual({ accepted: true });
    simulation.engagements.update(0);
    expect(simulation.engagements.statusFor(archer.id)).toBeNull();
    expect(archer.moveTarget).toEqual([26, 98]);
  });

  it('keeps a manual target ahead of opportunistic engagement for the red team', () => {
    const simulation = new Simulation(3);
    const redSoldier = simulation.entities.spawnUnit('red', 'soldier', 170, 99);
    const nearbyBlue = simulation.entities.spawnUnit('blue', 'worker', 166, 99);
    const manualBlue = simulation.entities.spawnUnit('blue', 'worker', 167, 101);
    simulation.fog.update();
    simulation.combat.setManualTarget(redSoldier.id, manualBlue.id);
    expect(simulation.issueCommand({ type: 'move', team: 'red', unitId: redSoldier.id, destination: [160, 99] })).toEqual({ accepted: true });
    // Group attacks set their manual target after issuing pursuit movement.
    simulation.combat.setManualTarget(redSoldier.id, manualBlue.id);
    simulation.engagements.update(0);
    expect(simulation.engagements.statusFor(redSoldier.id)).toBeNull();
    expect(simulation.combat.manualTargetFor(redSoldier.id)).toBe(manualBlue.id);
    expect(nearbyBlue.hp).toBe(10);
  });
});
