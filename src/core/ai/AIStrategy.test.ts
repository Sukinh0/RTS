import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../../config/runtime';
import { Simulation } from '../game/Simulation';
import { DEFAULT_STRATEGY, LEGACY_STRATEGY, type AIStrategy } from './AIStrategy';

function advance(simulation: Simulation, seconds: number): void {
  for (let i = 0; i < seconds * TICKS_PER_SECOND; i += 1) simulation.advance(1000 / TICKS_PER_SECOND);
}

function match(overrides: Partial<AIStrategy>): Simulation {
  const simulation = new Simulation(44, true);
  simulation.enableAI('red', { ...LEGACY_STRATEGY, ...overrides });
  return simulation;
}

/** Reveals a patch of plain ground to red, as an earlier scouting trip would. */
function reveal(simulation: Simulation, x: number, y: number): void {
  for (let dy = -8; dy <= 8; dy += 1) {
    for (let dx = -8; dx <= 8; dx += 1) simulation.map.setTerrain(x + dx, y + dy, 'plain');
  }
  const lookout = simulation.entities.spawnUnit('red', 'scout', x, y);
  simulation.fog.update();
  simulation.entities.remove(lookout.id);
  simulation.fog.update();
}

describe('AI strategy capabilities', () => {
  it('places the first watch tower forward, towards the enemy', () => {
    const simulation = match({ forwardTowerDistance: 35 });
    reveal(simulation, 141, 101);
    Object.assign(simulation.teams.red, { coins: 200, wood: 150, stone: 100 });
    simulation.entities.spawnUnit('red', 'builder', 160, 101);
    for (const y of [96, 98]) simulation.entities.spawnUnit('red', 'soldier', 172, y);
    // Existing production buildings and home barricades leave the tower as the next build.
    simulation.entities.createBuilding('red', 'barracks', 170, 106);
    simulation.entities.createBuilding('red', 'house', 166, 106);
    for (const y of [95, 97]) simulation.entities.createBuilding('red', 'barricade', 170, y);
    simulation.fog.update();
    advance(simulation, 2);
    const base = simulation.entities.get('red-base')!;
    const tower = simulation.entities.all().find((e) => e.team === 'red' && e.kind === 'tower');
    expect(tower).toBeDefined();
    expect(base.x - tower!.x).toBeGreaterThan(25);
  });

  it('screens a finished forward tower with barricades on the enemy side', () => {
    const simulation = match({ forwardTowerDistance: 35, forwardBarricades: 4 });
    reveal(simulation, 141, 101);
    const tower = simulation.entities.createBuilding('red', 'tower', 141, 100);
    simulation.entities.spawnUnit('red', 'builder', 145, 104);
    Object.assign(simulation.teams.red, { coins: 0, wood: 100, stone: 100 });
    simulation.fog.update();
    advance(simulation, 3);
    const screen = simulation.entities.all().filter((e) => e.team === 'red' && e.kind === 'barricade');
    expect(screen.length).toBeGreaterThan(0);
    expect(screen.every((barricade) => barricade.x < tower.x)).toBe(true);
  });

  it('sends home reserves after a fighter hunting a distant worker', () => {
    for (const smartDefense of [false, true]) {
      const simulation = match({ smartDefense });
      reveal(simulation, 135, 101);
      simulation.entities.spawnUnit('red', 'soldier', 172, 98);
      const reserve = simulation.entities.spawnUnit('red', 'soldier', 160, 101);
      simulation.entities.spawnUnit('red', 'worker', 135, 101);
      const hunter = simulation.entities.spawnUnit('blue', 'soldier', 131, 101);
      simulation.fog.update();
      advance(simulation, 2);
      expect(simulation.combat.manualTargetFor(reserve.id) === hunter.id).toBe(smartDefense);
    }
  });

  it('holds a new wave while revealed enemy fighters approach', () => {
    for (const earlyWarningDistance of [0, 60]) {
      const simulation = match({ earlyWarningDistance });
      reveal(simulation, 128, 101);
      for (const y of [96, 98, 100]) simulation.entities.spawnUnit('red', 'soldier', 172, y);
      for (const y of [100, 102]) simulation.entities.spawnUnit('blue', 'soldier', 128, y);
      simulation.fog.update();
      advance(simulation, 1);
      expect(simulation.redAI!.currentIntent === 'Rally').toBe(earlyWarningDistance > 0);
    }
  });

  it('enables the tuned capabilities in the game by default', () => {
    const simulation = new Simulation(1, true);
    expect(simulation.redAI!.strategy).toEqual(DEFAULT_STRATEGY);
  });
});

describe('saving for the first watch tower', () => {
  /** A red base with barracks, plenty of idle gold below the house price, and an army of `soldiers`. */
  function army(defenseAfterTroops: number, soldiers: number, coins: number): Simulation {
    const simulation = match({ defenseAfterTroops, openingArmy: 6, trainScout: false });
    simulation.entities.createBuilding('red', 'barracks', 170, 106);
    for (let i = 0; i < soldiers; i += 1) simulation.entities.spawnUnit('red', 'soldier', 172, 94 + i * 2);
    Object.assign(simulation.teams.red, { coins, wood: 0, stone: 0 });
    simulation.fog.update();
    return simulation;
  }
  const ordered = (simulation: Simulation) => simulation.production.getCapacity('red').militaryQueued;

  it('stops buying soldiers while the gold is needed for the house', () => {
    const before = army(0, 3, 140);
    advance(before, 2);
    expect(ordered(before)).toBeGreaterThan(0);
    const saving = army(3, 3, 140);
    advance(saving, 2);
    expect(ordered(saving)).toBe(0);
  });

  it('keeps buying soldiers while the army is below the threshold', () => {
    const simulation = army(3, 2, 140);
    advance(simulation, 2);
    expect(ordered(simulation)).toBeGreaterThan(0);
  });

  it('spends on the army again when enemy fighters reach the base', () => {
    const simulation = army(3, 3, 140);
    for (const y of [96, 99]) simulation.entities.spawnUnit('blue', 'soldier', 164, y);
    simulation.fog.update();
    advance(simulation, 2);
    expect(ordered(simulation)).toBeGreaterThan(0);
  });

  it('builds a tower in normal matches far more often than before', () => {
    // Real matches, no spawned resources: the feature has to work end to end.
    const towers = (defenseAfterTroops: number) => [1, 2, 3, 4, 5, 6].filter((seed) => {
      const simulation = new Simulation(seed);
      simulation.enableAI('blue', LEGACY_STRATEGY);
      simulation.enableAI('red', { ...DEFAULT_STRATEGY, defenseAfterTroops });
      for (let second = 0; second < 1200 && !simulation.result; second += 1) {
        advance(simulation, 1);
        if (simulation.entities.all().some((e) => e.team === 'red' && e.kind === 'tower')) return true;
      }
      return false;
    }).length;
    expect(towers(DEFAULT_STRATEGY.defenseAfterTroops)).toBeGreaterThan(towers(0));
  }, 120_000);
});
