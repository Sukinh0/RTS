import { describe, expect, it } from 'vitest';
import { MAP_DEFINITION } from '../config/map';
import { findPath } from './findPath';
import { MapGrid } from './MapGrid';

const map = new MapGrid(MAP_DEFINITION);
const mines = (): [number, number][] => {
  const cells: [number, number][] = [];
  for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
    if (map.cellAt(x, y)?.terrain === 'mine') cells.push([x, y]);
  }
  return cells;
};

describe('MAP_ORGANIC_01', () => {
  it('preserves a 200 × 200 grid and the original base footprints', () => {
    expect([map.width, map.height]).toEqual([200, 200]);
    expect(map.cellAt(0, 0)).not.toBeNull();
    expect(map.cellAt(199, 199)).not.toBeNull();
    expect(map.cellAt(-1, 0)).toBeNull();
    expect(map.cellAt(20, 100)).toMatchObject({ structureTeam: 'blue', blocked: true });
    expect(map.cellAt(176, 100)).toMatchObject({ structureTeam: 'red', blocked: true });
  });

  it('has eight individually placed gold deposits and an asymmetric terrain layout', () => {
    expect(mines()).toHaveLength(8);
    let asymmetricCells = 0;
    for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width / 2; x += 1) {
      if (map.cellAt(x, y)?.terrain !== map.cellAt(map.width - 1 - x, y)?.terrain) asymmetricCells += 1;
    }
    expect(asymmetricCells).toBeGreaterThan(1000);
  });

  it('uses irregular blocked terrain while keeping the base approaches open', () => {
    expect(map.cellAt(70, 25)).toMatchObject({ terrain: 'water', blocked: true });
    expect(map.cellAt(73, 86)).toMatchObject({ terrain: 'mountain', blocked: true });
    expect(map.cellAt(38, 35)?.terrain).toBe('forest');
    for (const [team, worker] of [['blue', MAP_DEFINITION.teamStarts.blue.workers[0]], ['red', MAP_DEFINITION.teamStarts.red.workers[0]]] as const) {
      const base = MAP_DEFINITION.teamStarts[team].base;
      const exits = [[base[0] - 1, base[1] + 1], [base[0] + 4, base[1] + 1], [base[0] + 1, base[1] - 1], [base[0] + 1, base[1] + 4]] as const;
      expect(exits.filter(([x, y]) => findPath(map, worker, [x, y]) !== null).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps both starts connected to all mines and nearby wood and stone', () => {
    for (const team of ['blue', 'red'] as const) {
      const worker = MAP_DEFINITION.teamStarts[team].workers[0];
      for (const mine of mines()) expect(findPath(map, worker, mine)).not.toBeNull();
    }
    const nearbyResources = [
      [MAP_DEFINITION.teamStarts.blue.workers[0], [40, 80], [28, 127]],
      [MAP_DEFINITION.teamStarts.red.workers[0], [166, 67], [137, 105]],
    ] as const;
    for (const [worker, forest, stone] of nearbyResources) {
      expect(map.cellAt(forest[0], forest[1])?.terrain).toBe('forest');
      expect(map.cellAt(stone[0], stone[1])?.terrain).toBe('stone');
      expect(findPath(map, worker, forest)!.length).toBeLessThan(45);
      expect(findPath(map, worker, stone)!.length).toBeLessThan(45);
    }
  });
  it('keeps initial gold access reasonably close between the two teams', () => {
    const starts = ['blue', 'red'].map(team => MAP_DEFINITION.teamStarts[team as 'blue' | 'red'].workers[0]);
    const distances = starts.map(start => Math.min(...mines().map(mine => findPath(map, start, mine)!.length)));
    expect(Math.abs(distances[0] - distances[1])).toBeLessThanOrEqual(12);
  });

  it('keeps an alternate route between the two starting territories', () => {
    const blue = MAP_DEFINITION.teamStarts.blue.workers[0];
    const red = MAP_DEFINITION.teamStarts.red.workers[0];
    const first = findPath(map, blue, red);
    expect(first).not.toBeNull();
    const blocked = new MapGrid(MAP_DEFINITION);
    for (const [x, y] of first!.slice(1, -1)) blocked.setTerrain(x, y, 'mountain');
    expect(findPath(blocked, blue, red)).not.toBeNull();
  });

  it('rejects terrain patches outside map bounds', () => {
    expect(() => new MapGrid({
      ...MAP_DEFINITION,
      terrainPatches: [{ terrain: 'water', x: 199, y: 0, width: 2, height: 1, mirrorX: false }],
    })).toThrow('outside map bounds');
  });

  it('paints seeded blob patches deterministically with irregular edges', () => {
    const blob = { terrain: 'water' as const, shape: 'blob' as const, seed: 9, x: 5, y: 5, width: 11, height: 9, mirrorX: false };
    const first = new MapGrid({ ...MAP_DEFINITION, terrainPatches: [blob] });
    const second = new MapGrid({ ...MAP_DEFINITION, terrainPatches: [blob] });
    for (let y = 5; y < 14; y += 1) for (let x = 5; x < 16; x += 1) {
      expect(first.cellAt(x, y)?.terrain).toBe(second.cellAt(x, y)?.terrain);
    }
    expect(first.cellAt(5, 5)?.terrain).toBe('plain');
    expect(first.cellAt(10, 9)?.terrain).toBe('water');
  });
});

