import { describe, expect, it } from 'vitest';
import { barricadeNeighborMask, barricadeVariantForMask } from './VisualRegistry';
import { BarricadeTopology, type BarricadeNode } from './BarricadeTopology';

describe('barricade visual connectivity', () => {
  it('encodes N/E/S/W as 1/2/4/8', () => {
    expect(barricadeNeighborMask(false, false, false, false)).toBe(0);
    expect(barricadeNeighborMask(true, false, false, false)).toBe(1);
    expect(barricadeNeighborMask(false, true, false, false)).toBe(2);
    expect(barricadeNeighborMask(false, false, true, false)).toBe(4);
    expect(barricadeNeighborMask(false, false, false, true)).toBe(8);
  });

  it.each([
    [0, 'isolated'], [2, 'horizontal-end'], [1, 'vertical-end'], [10, 'horizontal'],
    [5, 'vertical'], [3, 'corner'], [11, 't-junction'], [15, 'cross'],
  ] as const)('classifies mask %i as %s', (mask, expected) => {
    expect(barricadeVariantForMask(mask)).toBe(expected);
  });

  it('recalculates the two new ends after the center of a line is removed', () => {
    const topology = new BarricadeTopology();
    const line: BarricadeNode[] = [
      { id: 'a', x: 0, y: 0, team: 'blue' },
      { id: 'b', x: 1, y: 0, team: 'blue' },
      { id: 'c', x: 2, y: 0, team: 'blue' },
    ];
    topology.sync(1, line);
    expect(line.map(({ id }) => topology.maskFor(id))).toEqual([2, 10, 8]);
    topology.sync(2, [line[0], line[2]]);
    expect(topology.maskFor('a')).toBe(0);
    expect(topology.maskFor('c')).toBe(0);
    expect(topology.maskFor('b')).toBe(0);
  });

  it('connects same-team neighbors only', () => {
    const topology = new BarricadeTopology();
    topology.sync(1, [
      { id: 'a', x: 0, y: 0, team: 'blue' },
      { id: 'b', x: 1, y: 0, team: 'red' },
    ]);
    expect(topology.maskFor('a')).toBe(0);
    expect(topology.maskFor('b')).toBe(0);
  });
});
