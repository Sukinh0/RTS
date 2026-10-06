import { describe, expect, it } from 'vitest';
import { Simulation } from '../game/Simulation';

describe('Fase 4 fog and stealth', () => {
  it('starts unknown beyond unit vision and visible nearby', () => {
    const simulation = new Simulation(1);
    expect(simulation.fog.cell('blue', 25, 99)).toMatchObject({ state: 'visible', terrain: 'plain' });
    expect(simulation.fog.cell('blue', 80, 80)).toEqual({ state: 'unknown', terrain: null, building: null });
    expect(simulation.fog.stateAt('blue', -1, 0)).toBeNull();
    expect(simulation.fog.stateAt('red', 174, 99)).toBe('visible');
  });

  it('remembers terrain after vision moves away', () => {
    const simulation = new Simulation(1);
    expect(simulation.fog.stateAt('blue', 30, 99)).toBe('visible');
    expect(simulation.entities.moveUnit('blue-worker-1', 40, 99)).toBe(true);
    simulation.fog.update();
    expect(simulation.fog.cell('blue', 30, 99)).toEqual({ state: 'explored', terrain: 'plain', building: null });
    expect(simulation.fog.stateAt('blue', 40, 99)).toBe('visible');
  });

  it('keeps last known building data while hidden', () => {
    const simulation = new Simulation(1);
    expect(simulation.entities.moveUnit('blue-worker-1', 172, 100)).toBe(true);
    simulation.fog.update();
    expect(simulation.fog.visibleEntities('blue').some((entity) => entity.id === 'red-base')).toBe(true);
    expect(simulation.fog.knownBuildings('blue').find((building) => building.id === 'red-base')?.hp).toBe(150);

    expect(simulation.entities.moveUnit('blue-worker-1', 25, 99)).toBe(true);
    simulation.fog.update();
    const redBase = simulation.entities.get('red-base');
    if (!redBase) throw new Error('Missing red base');
    redBase.hp = 50;
    expect(simulation.fog.visibleEntities('blue').some((entity) => entity.id === 'red-base')).toBe(false);
    expect(simulation.fog.knownBuildings('blue').find((building) => building.id === 'red-base')?.hp).toBe(150);
    expect(simulation.fog.stateAt('blue', 176, 100)).toBe('explored');
  });

  it('does not expose current positions of troops beyond vision', () => {
    const simulation = new Simulation(1);
    const soldier = simulation.entities.spawnUnit('red', 'soldier', 30, 99);
    simulation.fog.update();
    const lastSeen = simulation.fog.visibleEntities('blue').find((entity) => entity.id === soldier.id);
    expect(lastSeen).toMatchObject({ x: 30, y: 99 });
    expect(simulation.entities.moveUnit(soldier.id, 60, 99)).toBe(true);
    simulation.fog.update();
    expect(simulation.fog.visibleEntities('blue').some((entity) => entity.id === soldier.id)).toBe(false);
    expect(lastSeen).toMatchObject({ x: 30, y: 99 });
  });

  it('lets an allied structure keep nearby enemy troops visible', () => {
    const simulation = new Simulation(1);
    simulation.entities.moveUnit('blue-worker-1', 40, 99);
    simulation.entities.moveUnit('blue-worker-2', 40, 101);
    const enemy = simulation.entities.spawnUnit('red', 'soldier', 25, 99);
    simulation.fog.update();
    expect(simulation.fog.stateAt('blue', 25, 99)).toBe('visible');
    expect(simulation.fog.visibleEntities('blue').some((entity) => entity.id === enemy.id)).toBe(true);
  });

  it('hides scouts beyond detection distance even inside vision', () => {
    const simulation = new Simulation(1);
    simulation.entities.spawnUnit('blue', 'archer', 50, 50);
    const scout = simulation.entities.spawnUnit('red', 'scout', 56, 50);
    simulation.fog.update();
    expect(simulation.fog.stateAt('blue', 56, 50)).toBe('visible');
    expect(simulation.fog.visibleEntities('blue').some((entity) => entity.id === scout.id)).toBe(false);

    expect(simulation.entities.moveUnit(scout.id, 55, 50)).toBe(true);
    simulation.fog.update();
    expect(simulation.fog.visibleEntities('blue').some((entity) => entity.id === scout.id)).toBe(true);

    expect(simulation.entities.moveUnit(scout.id, 56, 50)).toBe(true);
    simulation.fog.update();
    expect(simulation.fog.visibleEntities('blue').some((entity) => entity.id === scout.id)).toBe(false);
  });
});
