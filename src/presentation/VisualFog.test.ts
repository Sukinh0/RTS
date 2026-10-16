import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/game/Simulation';
import { VisualFog } from './VisualFog';

describe('visual fog follows displayed positions and remembers explored cells', () => {
  it('holds terrain and building memory until the cells become visible again', () => {
    const simulation = new Simulation(1);
    simulation.map.setTerrain(100, 20, 'plain');
    const fog = new VisualFog(simulation.map, simulation.entities, 'blue');
    const positions = new Map([['blue-worker-1', { x: 100, y: 20 }]]);
    fog.update(positions);
    expect(fog.cellAt(100, 20)?.terrain).toBe('plain');
    expect(fog.cellAt(100, 35)).toEqual({ state: 'unknown', terrain: null, building: null });

    positions.set('blue-worker-1', { x: 110, y: 20 });
    fog.update(positions);
    expect(fog.stateAt(100, 20)).toBe('explored');
    fog.drainDirtyTerrain();
    simulation.map.setTerrain(100, 20, 'forest');
    fog.update(positions);
    expect(fog.cellAt(100, 20)?.terrain).toBe('plain');
    expect(fog.drainDirtyTerrain()).not.toContainEqual([100, 20]);

    positions.set('blue-worker-1', { x: 100, y: 20 });
    fog.update(positions);
    expect(fog.cellAt(100, 20)?.terrain).toBe('forest');
    expect(fog.drainDirtyTerrain()).toContainEqual([100, 20]);
  });

  it('uses interpolated display coordinates to reveal an enemy without a logical-position jump', () => {
    const simulation = new Simulation(2);
    simulation.map.setTerrain(105, 100, 'plain');
    const enemy = simulation.entities.spawnUnit('red', 'soldier', 105, 100);
    const fog = new VisualFog(simulation.map, simulation.entities, 'blue');
    const positions = new Map([['blue-worker-1', { x: 98, y: 100 }], [enemy.id, { x: 105, y: 100 }]]);
    fog.update(positions);
    expect(fog.isEntityVisible(enemy)).toBe(false);
    positions.set('blue-worker-1', { x: 101, y: 100 });
    fog.update(positions);
    expect(fog.isEntityVisible(enemy)).toBe(true);
  });

  it('keeps the last seen building snapshot while it is hidden', () => {
    const simulation = new Simulation(3);
    const fog = new VisualFog(simulation.map, simulation.entities, 'blue');
    const positions = new Map([['blue-worker-1', { x: 172, y: 100 }]]);
    fog.update(positions);
    expect(fog.knownBuildings().find((building) => building.id === 'red-base')?.hp).toBe(150);
    positions.set('blue-worker-1', { x: 25, y: 99 });
    fog.update(positions);
    const base = simulation.entities.get('red-base')!;
    base.hp = 50;
    fog.update(positions);
    expect(fog.knownBuildings().find((building) => building.id === 'red-base')?.hp).toBe(150);
    positions.set('blue-worker-1', { x: 172, y: 100 });
    fog.update(positions);
    expect(fog.knownBuildings().find((building) => building.id === 'red-base')?.hp).toBe(50);
  });
});
