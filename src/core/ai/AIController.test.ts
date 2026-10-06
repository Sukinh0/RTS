import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS, TICKS_PER_SECOND } from '../../config/runtime';
import { Simulation } from '../game/Simulation';
import type { BuildingEntity, UnitEntity } from '../entities/EntityStore';

function advanceSeconds(simulation: Simulation, seconds: number): void {
  simulation.advance(FIXED_STEP_MS * TICKS_PER_SECOND * seconds);
}

describe('Fase 8 IA', () => {
  it('develops an economy and trains a soldier from the real starting resources', () => {
    const simulation = new Simulation(123, true);
    advanceSeconds(simulation, 360);
    const military = simulation.entities.all().filter((entity) => entity.team === 'red'
      && entity.category === 'unit' && entity.kind !== 'worker');
    expect(military.length).toBeGreaterThan(0);
  }, 60_000);
  it('strictly respects fog of war and does not cheat regarding hidden entities', () => {
    const simulation = new Simulation(42, true);
    const ai = simulation.redAI!;
    expect(ai).toBeDefined();

    // At game start, blue base is at (20, 100) and completely in fog for red
    expect(simulation.fog.stateAt('red', 20, 100)).toBe('unknown');
    expect(ai.memory.enemyBaseLocation).toBeNull();
    expect(ai.memory.knownEnemyBuildings.size).toBe(0);

    // Place a blue scout close to red base (170, 100)
    const blueScout = simulation.entities.spawnUnit('blue', 'scout', 170, 100);
    simulation.fog.update();

    // The blue scout is detected because it is within stealthDetectionDistance (<= 5) of red base
    expect(simulation.fog.isEntityVisible('red', blueScout)).toBe(true);

    // Advance 1 second for AI to update memory
    advanceSeconds(simulation, 1);
    expect(ai.memory.lastSeenEnemies.has(blueScout.id)).toBe(true);

    // Move blue scout back into deep fog (100, 100)
    simulation.entities.moveUnit(blueScout.id, 100, 100);
    simulation.fog.update();
    expect(simulation.fog.isEntityVisible('red', blueScout)).toBe(false);

    // AI only remembers last seen position, does not know new coordinates
    const remembered = ai.memory.lastSeenEnemies.get(blueScout.id)!;
    expect(remembered.x).toBe(170);
    expect(remembered.y).toBe(100);
  });

  it('assigns workers to harvest wood and mine coins to generate economy', () => {
    const simulation = new Simulation(42, true);
    // Place forest and mine in visible territory near red workers (174, 99) and (174, 101)
    simulation.map.setTerrain(173, 99, 'forest');
    simulation.map.setTerrain(173, 101, 'mine');
    simulation.fog.update();

    const redWorkers = simulation.entities.all().filter((e): e is UnitEntity => e.team === 'red' && e.kind === 'worker');
    expect(redWorkers.length).toBe(2);

    advanceSeconds(simulation, 2);

    // Both workers should have received economy tasks
    const tasks = redWorkers.map((w) => simulation.economy.taskFor(w.id));
    const activeTasks = tasks.filter((t) => t !== null);
    expect(activeTasks.length).toBeGreaterThan(0);
  });

  it('builds barracks and produces military composition when resources are available', () => {
    const simulation = new Simulation(42, true);
    // Provide resources to red team
    simulation.teams.red.coins = 1000;
    simulation.teams.red.wood = 1000;

    // Advance 2 seconds for AI to decide and issue build barracks
    advanceSeconds(simulation, 2);

    const barracks = simulation.entities.all().find((e): e is BuildingEntity => e.team === 'red' && e.kind === 'barracks');
    expect(barracks).toBeDefined();

    // Advance 14 seconds to complete barracks construction (12s build time)
    advanceSeconds(simulation, 14);
    expect(barracks!.underConstruction).toBe(false);

    // Advance 10 seconds for AI to queue and train military units
    advanceSeconds(simulation, 10);
    const military = simulation.entities.all().filter((e) => e.team === 'red' && e.category === 'unit' && e.kind !== 'worker');
    expect(military.length).toBeGreaterThan(0);
  });

  it('produces additional workers up to limit', () => {
    const simulation = new Simulation(42, true);
    simulation.teams.red.coins = 1000;
    simulation.teams.red.wood = 1000;

    const initialWorkers = simulation.entities.all().filter((e) => e.team === 'red' && e.kind === 'worker').length;
    expect(initialWorkers).toBe(2);

    // Advance 25 seconds (build house 8s + worker production 6s + buffer)
    advanceSeconds(simulation, 25);

    const currentWorkers = simulation.entities.all().filter((e) => e.team === 'red' && e.kind === 'worker').length;
    expect(currentWorkers).toBeGreaterThan(initialWorkers);
  });

  it('triggers defense when enemies invade territory near base', () => {
    const simulation = new Simulation(42, true);
    simulation.teams.red.coins = 1000;
    simulation.teams.red.wood = 1000;

    // Spawn defending red soldiers at base (176, 100)
    const redSoldier = simulation.entities.spawnUnit('red', 'soldier', 174, 98);

    // Spawn invading blue soldier in visible radius of red base (170, 100)
    const invader = simulation.entities.spawnUnit('blue', 'soldier', 170, 100);
    simulation.fog.update();

    advanceSeconds(simulation, 2);

    // AI should have ordered red soldier to defend
    expect(simulation.redAI!.currentIntent).toBe('Defend');
    const target = simulation.combat.manualTargetFor(redSoldier.id);
    expect(target).toBe(invader.id);
  });

  it('orders army assault towards enemy base when military threshold is reached', () => {
    const simulation = new Simulation(42, true);

    // Spawn 5 red soldiers to meet military army threshold
    const soldiers: UnitEntity[] = [];
    for (let i = 0; i < 5; i += 1) {
      soldiers.push(simulation.entities.spawnUnit('red', 'soldier', 170 - i, 100));
    }
    simulation.fog.update();

    advanceSeconds(simulation, 2);

    // AI should transition to AttackBase and move soldiers towards enemy side
    expect(simulation.redAI!.currentIntent).toBe('AttackBase');
    const marching = soldiers.filter((s) => s.moveTarget !== null);
    expect(marching.length).toBeGreaterThan(0);
  });

  it('is completely deterministic with fixed seed', () => {
    const simA = new Simulation(123, true);
    const simB = new Simulation(123, true);

    simA.teams.red.coins = 500;
    simA.teams.red.wood = 500;
    simB.teams.red.coins = 500;
    simB.teams.red.wood = 500;

    advanceSeconds(simA, 10);
    advanceSeconds(simB, 10);

    const entitiesA = simA.entities.all().map((e) => `${e.id}:${e.x},${e.y}:${e.hp}`).sort();
    const entitiesB = simB.entities.all().map((e) => `${e.id}:${e.x},${e.y}:${e.hp}`).sort();

    expect(entitiesA).toEqual(entitiesB);
    expect(simA.teams.red.coins).toBe(simB.teams.red.coins);
    expect(simA.teams.red.wood).toBe(simB.teams.red.wood);
  });
});
