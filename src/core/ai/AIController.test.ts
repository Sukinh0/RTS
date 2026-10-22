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
      && entity.category === 'unit' && entity.kind !== 'worker' && entity.kind !== 'builder');
    expect(military.length).toBeGreaterThan(0);
  }, 60_000);
  it('trains a combat unit before its first scout from the real starting resources', () => {
    const simulation = new Simulation(123, true);
    let firstMilitary: UnitEntity | undefined;
    for (let second = 0; second < 300 && !firstMilitary; second += 1) {
      advanceSeconds(simulation, 1);
      firstMilitary = simulation.entities.all().find((entity): entity is UnitEntity => entity.team === 'red'
        && entity.category === 'unit' && entity.kind !== 'worker' && entity.kind !== 'builder');
    }
    expect(firstMilitary?.kind).toBe('soldier');
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

  it('assigns workers to gather stone when stone is needed and discovered', () => {
    const simulation = new Simulation(42, true);
    simulation.map.setTerrain(173, 99, 'forest');
    simulation.map.setTerrain(173, 101, 'mine');
    simulation.map.setTerrain(173, 103, 'stone');
    simulation.entities.spawnUnit('red', 'worker', 174, 103);
    simulation.fog.update();

    simulation.redAI!.desiredStone = 40;

    advanceSeconds(simulation, 2);

    const redWorkers = simulation.entities.all().filter((e): e is UnitEntity => e.team === 'red' && e.kind === 'worker');
    const tasks = redWorkers.map((w) => simulation.economy.taskFor(w.id));
    const stoneTask = tasks.find((t) => t?.kind === 'gather' && (t as { resourceKind?: string }).resourceKind === 'stone');
    expect(stoneTask).toBeDefined();
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
    const military = simulation.entities.all().filter((e) => e.team === 'red' && e.category === 'unit' && e.kind !== 'worker' && e.kind !== 'builder');
    expect(military.length).toBeGreaterThan(0);
  });

  it('produces additional workers up to limit', () => {
    const simulation = new Simulation(42, true);
    simulation.teams.red.coins = 1000;
    simulation.teams.red.wood = 1000;

    const initialWorkers = simulation.entities.all().filter((e) => e.team === 'red' && e.kind === 'worker').length;
    expect(initialWorkers).toBe(2);

    // The first soldier precedes the house; then construction and worker training complete.
    advanceSeconds(simulation, 40);

    const currentWorkers = simulation.entities.all().filter((e) => e.team === 'red' && e.kind === 'worker').length;
    expect(currentWorkers).toBeGreaterThan(initialWorkers);
  });

  it('expands workers and income while sustaining troop production from starting resources', () => {
    const simulation = new Simulation(123, true);
    advanceSeconds(simulation, 600);
    const stats = simulation.stats.snapshot().red;
    expect(stats.workersProduced).toBeGreaterThan(0);
    expect(stats.troopsProduced).toBeGreaterThanOrEqual(3);
    expect(stats.coinsCollected).toBeGreaterThan(850);
    expect(simulation.redAI!.memory.discoveredMines.length).toBeGreaterThan(0);
  }, 60_000);

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

  it('keeps a full field squad advancing while a guard defends home', () => {
    const simulation = new Simulation(42, true);
    const defender = simulation.entities.spawnUnit('red', 'soldier', 174, 98);
    const raiders = [130, 129, 128].map((x) => simulation.entities.spawnUnit('red', 'soldier', x, 100));
    simulation.fog.update();
    advanceSeconds(simulation, 2);
    const invader = simulation.entities.spawnUnit('blue', 'soldier', 170, 100);
    simulation.fog.update();

    advanceSeconds(simulation, 2);

    expect(simulation.combat.manualTargetFor(defender.id)).toBe(invader.id);
    expect(raiders.every((unit) => unit.moveTarget !== null)).toBe(true);
  });

  it('does not start a new raid while the base is threatened', () => {
    const simulation = new Simulation(42, true);
    simulation.entities.spawnUnit('red', 'soldier', 174, 98);
    const reserves = [173, 172, 171].map((x) => simulation.entities.spawnUnit('red', 'soldier', x, 98));
    const invader = simulation.entities.spawnUnit('blue', 'soldier', 170, 100);
    invader.hp = 500;
    invader.maxHp = 500;
    simulation.fog.update();

    advanceSeconds(simulation, 2);

    expect(simulation.redAI!.currentIntent).toBe('Defend');
    expect(reserves.every((unit) => unit.moveTarget?.[0] !== 24)).toBe(true);
    simulation.entities.remove(invader.id);
    simulation.fog.update();
    advanceSeconds(simulation, 2);
    expect(reserves.some((unit) => unit.moveTarget?.[0] === 24)).toBe(true);
  });

  it('keeps one fighter in reserve and one guard at home', () => {
    const simulation = new Simulation(42, true);
    const soldiers = [174, 173].map((x) => simulation.entities.spawnUnit('red', 'soldier', x, 98));
    simulation.fog.update();

    advanceSeconds(simulation, 2);

    expect(simulation.redAI!.currentIntent).toBe('Rally');
    expect(soldiers.every((unit) => unit.moveTarget === null)).toBe(true);
  });

  it('launches two fighters as soon as the third combatant arrives', () => {
    const simulation = new Simulation(42, true);
    const guard = simulation.entities.spawnUnit('red', 'soldier', 174, 98);
    const raiders = [173, 172].map((x) => simulation.entities.spawnUnit('red', 'soldier', x, 98));
    simulation.fog.update();

    advanceSeconds(simulation, 2);

    expect(simulation.redAI!.currentIntent).toBe('AttackBase');
    expect(guard.moveTarget).toBeNull();
    expect(raiders.every((unit) => unit.moveTarget !== null)).toBe(true);
  });

  it('launches three attackers together and keeps a guard and lone reinforcement home', () => {
    const simulation = new Simulation(42, true);
    const guard = simulation.entities.spawnUnit('red', 'soldier', 174, 98);
    const raiders = [173, 172, 171].map((x) => simulation.entities.spawnUnit('red', 'soldier', x, 98));
    simulation.fog.update();
    advanceSeconds(simulation, 2);

    expect(guard.moveTarget).toBeNull();
    expect(raiders.every((unit) => unit.moveTarget !== null)).toBe(true);

    const reinforcement = simulation.entities.spawnUnit('red', 'soldier', 174, 97);
    simulation.fog.update();
    advanceSeconds(simulation, 2);
    expect(reinforcement.moveTarget).toBeNull();
  });

  it('replaces a fallen guard without pulling the active squad out of the field', () => {
    const simulation = new Simulation(42, true);
    const guard = simulation.entities.spawnUnit('red', 'soldier', 174, 98);
    const raiders = [173, 172, 171].map((x) => simulation.entities.spawnUnit('red', 'soldier', x, 98));
    simulation.fog.update();
    advanceSeconds(simulation, 2);
    const replacement = simulation.entities.spawnUnit('red', 'soldier', 174, 97);
    simulation.entities.remove(guard.id);
    simulation.fog.update();

    advanceSeconds(simulation, 2);

    expect(replacement.moveTarget).toBeNull();
    expect(raiders.every((unit) => unit.moveTarget !== null)).toBe(true);
  });

  it('recalls the last survivor of a depleted wave', () => {
    const simulation = new Simulation(42, true);
    simulation.entities.spawnUnit('red', 'soldier', 174, 98);
    const raiders = [173, 172, 171].map((x) => simulation.entities.spawnUnit('red', 'soldier', x, 98));
    simulation.fog.update();
    advanceSeconds(simulation, 2);
    simulation.entities.remove(raiders[1].id);
    simulation.entities.remove(raiders[2].id);
    simulation.entities.moveUnit(raiders[0].id, 130, 100);
    raiders[0].cooldownUntilTick = 0;
    simulation.fog.update();

    advanceSeconds(simulation, 5);

    expect(raiders[0].moveTarget?.[0]).toBeGreaterThan(130);
  });

  it('presses the attack with a lone survivor already at a visible enemy base', () => {
    const simulation = new Simulation(42, true);
    simulation.entities.spawnUnit('red', 'soldier', 174, 98); // Home guard
    const raiders = [26, 27].map((x) => simulation.entities.spawnUnit('red', 'soldier', x, 100));
    simulation.fog.update();

    advanceSeconds(simulation, 2);
    expect(simulation.redAI!.currentIntent).toBe('AttackBase');

    simulation.entities.remove(raiders[1].id);
    simulation.fog.update();
    advanceSeconds(simulation, 2);

    // A field survivor in sight of the objective must not turn around to regroup.
    expect(simulation.redAI!.currentIntent).toBe('AttackBase');
    expect(simulation.combat.manualTargetFor(raiders[0].id)).toBe('blue-base');
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


  it('keeps developing its economy after the army reaches the attack threshold', () => {
    const simulation = new Simulation(42, true);
    simulation.teams.red.coins = 1000;
    simulation.teams.red.wood = 1000;
    for (let i = 0; i < 5; i += 1) simulation.entities.spawnUnit('red', 'soldier', 170 - i, 100);
    simulation.fog.update();

    advanceSeconds(simulation, 2);

    expect(simulation.redAI!.currentIntent).toBe('AttackBase');
    expect(simulation.entities.all().some((entity) => entity.team === 'red' && entity.kind === 'barracks')).toBe(true);
  });

  it('sends the first scout exploring while production continues', () => {
    const simulation = new Simulation(42, true);
    simulation.teams.red.coins = 1000;
    simulation.teams.red.wood = 1000;
    const scout = simulation.entities.spawnUnit('red', 'scout', 170, 100);
    simulation.fog.update();

    advanceSeconds(simulation, 2);

    expect(scout.moveTarget).not.toBeNull();
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

describe('Fase 10 IA — Utility AI e Observabilidade', () => {
  it('provides observability via getDebugState with decision, priority, goal, desired resources and chosen action', () => {
    const simulation = new Simulation(42, true);
    const ai = simulation.redAI!;
    expect(ai).toBeDefined();

    advanceSeconds(simulation, 2);
    const debug = ai.getDebugState();

    expect(debug.team).toBe('red');
    expect(typeof debug.decision).toBe('string');
    expect(typeof debug.priority).toBe('number');
    expect(debug.priority).toBeGreaterThanOrEqual(0);
    expect(typeof debug.goal).toBe('string');
    expect(typeof debug.chosenAction).toBe('string');
    expect(debug.desiredResources).toHaveProperty('coins');
    expect(debug.desiredResources).toHaveProperty('wood');
    expect(debug.desiredResources).toHaveProperty('stone');
  });

  it('trains a builder and uses builder to construct barricades with wood and stone', () => {
    const simulation = new Simulation(42, true);
    // Grant resources
    simulation.teams.red.coins = 1000;
    simulation.teams.red.wood = 1000;
    simulation.teams.red.stone = 500;

    // Spawn 2 soldiers so opening troops exist and military threshold is met
    simulation.entities.spawnUnit('red', 'soldier', 174, 98);
    simulation.entities.spawnUnit('red', 'soldier', 173, 98);
    // Create a house so builder can be produced
    simulation.entities.createBuilding('red', 'house', 172, 94);
    simulation.fog.update();

    // Advance for AI to produce worker and then builder
    advanceSeconds(simulation, 15);

    const builder = simulation.entities.all().find((e): e is UnitEntity => e.team === 'red' && e.kind === 'builder');
    expect(builder).toBeDefined();

    // Advance for builder to place and build barricade
    advanceSeconds(simulation, 12);

    const barricade = simulation.entities.all().find((e): e is BuildingEntity => e.team === 'red' && e.kind === 'barricade');
    expect(barricade).toBeDefined();
  });

  it('builder constructs a watch tower when resources allow', () => {
    const simulation = new Simulation(42, true);
    simulation.teams.red.coins = 1000;
    simulation.teams.red.wood = 1000;
    simulation.teams.red.stone = 1000;

    // Provide troops and builder
    simulation.entities.spawnUnit('red', 'soldier', 174, 98);
    simulation.entities.spawnUnit('red', 'soldier', 173, 98);
    simulation.entities.spawnUnit('red', 'builder', 174, 96);
    // Provide barricades already so tower is prioritized
    simulation.entities.createBuilding('red', 'barricade', 168, 98);
    simulation.entities.createBuilding('red', 'barricade', 168, 102);
    simulation.fog.update();

    advanceSeconds(simulation, 14);

    const tower = simulation.entities.all().find((e): e is BuildingEntity => e.team === 'red' && e.kind === 'tower');
    expect(tower).toBeDefined();
  });

  it('builder repairs a damaged base prioritizing survival', () => {
    const simulation = new Simulation(42, true);
    simulation.teams.red.wood = 500;
    simulation.teams.red.stone = 500;

    const base = simulation.entities.get('red-base') as BuildingEntity;
    base.hp = 50; // Damaged

    const builder = simulation.entities.spawnUnit('red', 'builder', 174, 98);
    simulation.fog.update();

    advanceSeconds(simulation, 2);

    expect(simulation.redAI!.currentIntent).toBe('Repair');
    const task = simulation.construction.taskFor(builder.id);
    expect(task).toBeDefined();
    expect(task?.phase).toMatch(/travel|repairing/);
  });

  it('targets and attacks enemy barricades and towers in the field', () => {
    const simulation = new Simulation(42, true);
    // Spawn 3 red raiders marching forward
    const raider = simulation.entities.spawnUnit('red', 'soldier', 100, 100);
    simulation.entities.spawnUnit('red', 'soldier', 101, 100);
    simulation.entities.spawnUnit('red', 'soldier', 102, 100);

    // Spawn a blue barricade within visible range
    const enemyBarricade = simulation.entities.createBuilding('blue', 'barricade', 95, 100);
    simulation.fog.update();

    advanceSeconds(simulation, 2);

    const attackTarget = simulation.combat.manualTargetFor(raider.id);
    expect(attackTarget).toBe(enemyBarricade.id);
  });

  it('expands civilian capacity by building houses when capacity is reached', () => {
    const simulation = new Simulation(42, true);
    simulation.teams.red.coins = 1000;
    simulation.teams.red.wood = 1000;

    // Spawn 1 barracks and 1 soldier
    simulation.entities.createBuilding('red', 'barracks', 174, 94);
    simulation.entities.spawnUnit('red', 'soldier', 174, 98);
    // Civilian capacity starts at 2 (2 workers already exist)
    const capBefore = simulation.production.getCapacity('red');
    expect(capBefore.civilianCapacity).toBe(2);

    advanceSeconds(simulation, 15);

    const houses = simulation.entities.all().filter((e) => e.team === 'red' && e.kind === 'house');
    expect(houses.length).toBeGreaterThan(0);
  });
});

