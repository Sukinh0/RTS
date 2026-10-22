import { describe, expect, it } from 'vitest';
import { MAP_DEFINITION } from '../config/map';
import { MapGrid } from './MapGrid';

const map = new MapGrid(MAP_DEFINITION);

describe('Fase 1 map', () => {
  it('has 200 × 200 integer-addressed cells', () => {
    expect([map.width, map.height]).toEqual([200, 200]);
    expect(map.cellAt(0, 0)).not.toBeNull();
    expect(map.cellAt(199, 199)).not.toBeNull();
    expect(map.cellAt(-1, 0)).toBeNull();
    expect(map.cellAt(1.5, 0)).toBeNull();
  });

  it('blocks water, mountain and starting bases', () => {
    expect(map.cellAt(76, 40)).toMatchObject({ terrain: 'water', blocked: true });
    expect(map.cellAt(90, 30)).toMatchObject({ terrain: 'mountain', blocked: true });
    expect(map.cellAt(20, 100)).toMatchObject({ structureTeam: 'blue', blocked: true });
    expect(map.cellAt(176, 100)).toMatchObject({ structureTeam: 'red', blocked: true });
    expect(map.isPassable(20, 100)).toBe(false);
  });

  it('keeps forest and mine cells passable for future work actions', () => {
    expect(map.cellAt(38, 35)).toMatchObject({ terrain: 'forest', blocked: false });
    expect(map.cellAt(58, 62)).toMatchObject({ terrain: 'mine', blocked: false });
  });

  it('mirrors terrain and provides three cross-map corridors', () => {
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        expect(map.cellAt(x, y)?.terrain).toBe(map.cellAt(map.width - x - 1, y)?.terrain);
      }
    }
    for (const y of [62, 100, 137]) {
      for (let x = 70; x <= 130; x += 1) expect(map.isPassable(x, y)).toBe(true);
    }
  });

  it('rejects terrain patches outside map bounds', () => {
    expect(() => new MapGrid({
      ...MAP_DEFINITION,
      terrainPatches: [{ terrain: 'water', x: 199, y: 0, width: 2, height: 1, mirrorX: false }],
    })).toThrow('outside map bounds');
  });
});
