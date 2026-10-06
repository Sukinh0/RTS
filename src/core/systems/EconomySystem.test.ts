import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../config/balance';
import { FIXED_STEP_MS, TICKS_PER_SECOND } from '../../config/runtime';
import { Simulation } from '../game/Simulation';

function advanceSeconds(simulation: Simulation, seconds: number): void {
  simulation.advance(FIXED_STEP_MS * TICKS_PER_SECOND * seconds);
}

describe('Fase 5 economy', () => {
  it('pays passive income once per second for each free worker', () => {
    const simulation = new Simulation(1);
    advanceSeconds(simulation, 2);
    expect(simulation.teams.blue.coins).toBe(BALANCE.startingState.coins + 4);
    expect(simulation.teams.red.coins).toBe(BALANCE.startingState.coins + 4);
  });

  it('pays a mine cycle only after 30 complete seconds, without passive income for its worker', () => {
    const simulation = new Simulation(1);
    expect(simulation.entities.moveUnit('blue-worker-1', 58, 62)).toBe(true);
    simulation.fog.update();
    expect(simulation.issueCommand({ type: 'mine', team: 'blue', unitId: 'blue-worker-1', target: [58, 62] })).toEqual({ accepted: true });
    advanceSeconds(simulation, 29);
    expect(simulation.teams.blue.coins).toBe(129);
    advanceSeconds(simulation, 1);
    expect(simulation.teams.blue.coins).toBe(180);
    expect(simulation.economy.taskFor('blue-worker-1')).toMatchObject({ kind: 'mine', phase: 'working', progressTicks: 0 });
  });

  it('loses incomplete mining progress when interrupted', () => {
    const simulation = new Simulation(1);
    simulation.entities.moveUnit('blue-worker-1', 58, 62);
    simulation.fog.update();
    expect(simulation.issueCommand({ type: 'mine', team: 'blue', unitId: 'blue-worker-1', target: [58, 62] }).accepted).toBe(true);
    advanceSeconds(simulation, 15);
    expect(simulation.issueCommand({ type: 'move', team: 'blue', unitId: 'blue-worker-1', destination: [59, 62] }).accepted).toBe(true);
    expect(simulation.economy.taskFor('blue-worker-1')).toBeNull();
    advanceSeconds(simulation, 15);
    expect(simulation.teams.blue.coins).toBeLessThan(180);
  });

  it('limits each mine to four workers', () => {
    const simulation = new Simulation(1);
    simulation.entities.moveUnit('blue-worker-1', 58, 62);
    simulation.entities.spawnUnit('blue', 'worker', 57, 61);
    simulation.entities.spawnUnit('blue', 'worker', 57, 62);
    simulation.entities.spawnUnit('blue', 'worker', 57, 63);
    simulation.fog.update();
    for (const id of ['blue-worker-1', 'blue-worker-2', 'blue-worker-3', 'blue-worker-4']) {
      expect(simulation.issueCommand({ type: 'mine', team: 'blue', unitId: id, target: [58, 62] }).accepted).toBe(true);
    }
    const fifth = simulation.entities.spawnUnit('blue', 'worker', 59, 63);
    expect(simulation.issueCommand({ type: 'mine', team: 'blue', unitId: fifth.id, target: [58, 62] }))
      .toEqual({ accepted: false, reason: 'mine-full' });
  });

  it('gathers to capacity, returns to base and deposits wood', () => {
    const simulation = new Simulation(1);
    expect(simulation.entities.moveUnit('blue-worker-1', 54, 84)).toBe(true);
    simulation.fog.update();
    expect(simulation.issueCommand({ type: 'gather', team: 'blue', unitId: 'blue-worker-1', target: [54, 84] }).accepted).toBe(true);
    advanceSeconds(simulation, 10);
    expect(simulation.entities.get('blue-worker-1')).toMatchObject({ carriedWood: BALANCE.economy.wood.workerCapacity });
    expect(simulation.teams.blue.wood).toBe(BALANCE.startingState.wood);
    expect(simulation.teams.blue.coins).toBe(110);
    advanceSeconds(simulation, 40);
    expect(simulation.teams.blue.wood).toBeGreaterThanOrEqual(BALANCE.startingState.wood + BALANCE.economy.wood.workerCapacity);
    expect(simulation.economy.taskFor('blue-worker-1')?.kind).toBe('gather');
    expect(simulation.map.cellAt(54, 84)?.terrain).toBe('plain');
  });

  it('depletes forest cell upon harvest and redirects worker to adjacent forest', () => {
    const simulation = new Simulation(1);
    expect(simulation.map.cellAt(54, 84)?.terrain).toBe('forest');
    simulation.entities.moveUnit('blue-worker-1', 54, 84);
    simulation.fog.update();
    expect(simulation.issueCommand({ type: 'gather', team: 'blue', unitId: 'blue-worker-1', target: [54, 84] }).accepted).toBe(true);
    
    // Gathers for 10 seconds (20 wood = capacity)
    advanceSeconds(simulation, 10);
    const worker = simulation.entities.get('blue-worker-1');
    expect(worker?.category === 'unit' && worker.carriedWood).toBe(20);
    expect(simulation.map.cellAt(54, 84)?.terrain).toBe('plain');

    // Worker returns to base to deposit, then redirects to another forest cell
    advanceSeconds(simulation, 40);
    expect(simulation.teams.blue.wood).toBe(BALANCE.startingState.wood + 20);
    const task = simulation.economy.taskFor('blue-worker-1');
    expect(task?.kind).toBe('gather');
    expect(simulation.map.cellAt(task!.workCell[0], task!.workCell[1])?.terrain).toBe('forest');
    expect(task!.workCell).not.toEqual([54, 84]);

    // Redirection continues until a new command is issued
    advanceSeconds(simulation, 3);
    expect(simulation.issueCommand({ type: 'move', team: 'blue', unitId: 'blue-worker-1', destination: [25, 99] }).accepted).toBe(true);
    expect(simulation.economy.taskFor('blue-worker-1')).toBeNull();
  });

  it('rejects work orders for hidden or wrong terrain and nonworkers', () => {
    const simulation = new Simulation(1);
    expect(simulation.issueCommand({ type: 'mine', team: 'blue', unitId: 'blue-worker-1', target: [58, 62] }))
      .toEqual({ accepted: false, reason: 'invalid-destination' });
    expect(simulation.issueCommand({ type: 'gather', team: 'blue', unitId: 'blue-worker-1', target: [25, 99] }))
      .toEqual({ accepted: false, reason: 'wrong-terrain' });
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 27, 99);
    expect(simulation.issueCommand({ type: 'gather', team: 'blue', unitId: soldier.id, target: [25, 99] }))
      .toEqual({ accepted: false, reason: 'not-worker' });
  });
});
