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
