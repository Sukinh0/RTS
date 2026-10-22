import { describe, expect, it } from 'vitest';
import { MAP_DEFINITION } from '../config/map';
import { MapGrid } from './MapGrid';
import { findPath } from './findPath';

const map = new MapGrid(MAP_DEFINITION);

describe('A* on MAP_ORGANIC_01', () => {
  it('routes around irregular water rather than crossing blocked cells', () => {
    const path = findPath(map, [55, 25], [84, 38]);
    expect(path).not.toBeNull();
    expect(path![0]).toEqual([55, 25]);
    expect(path!.at(-1)).toEqual([84, 38]);
    expect(path!.some(([, y]) => y > 33)).toBe(true);
    for (let i = 1; i < path!.length; i += 1) {
      const [x, y] = path![i];
      const [prevX, prevY] = path![i - 1];
      expect(map.isPassable(x, y)).toBe(true);
      expect(Math.abs(x - prevX)).toBeLessThanOrEqual(1);
      expect(Math.abs(y - prevY)).toBeLessThanOrEqual(1);
    }
  });

  it('does not cut a blocked diagonal corner', () => {
    const cornerMap = new MapGrid({
      ...MAP_DEFINITION,
      terrainPatches: [
        { terrain: 'water', x: 11, y: 10, width: 1, height: 1, mirrorX: false },
        { terrain: 'water', x: 10, y: 11, width: 1, height: 1, mirrorX: false },
      ],
    });
    const path = findPath(cornerMap, [10, 10], [11, 11]);
    expect(path?.[1]).not.toEqual([11, 11]);
  });

  it('rejects water, mountain and base destinations', () => {
    expect(findPath(map, [55, 25], [70, 25])).toBeNull();
    expect(findPath(map, [55, 25], [73, 86])).toBeNull();
    expect(findPath(map, [55, 25], [20, 100])).toBeNull();
  });

  it('routes around a starting base footprint', () => {
    const path = findPath(map, [19, 101], [25, 101]);
    expect(path).not.toBeNull();
    expect(path!.some(([x, y]) => x >= 20 && x <= 23 && y >= 100 && y <= 103)).toBe(false);
  });
});

