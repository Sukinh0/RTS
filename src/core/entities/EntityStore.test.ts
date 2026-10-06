import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../config/balance';
import { MAP_DEFINITION } from '../../config/map';
import { MapGrid } from '../../map/MapGrid';
import { EntityStore } from './EntityStore';

const entities = new EntityStore(new MapGrid(MAP_DEFINITION));

describe('Fase 2 entities', () => {
  it('creates stable IDs and ownership for initial bases and workers', () => {
    expect(entities.all().map((entity) => entity.id)).toEqual([
      'blue-base', 'blue-worker-1', 'blue-worker-2',
      'red-base', 'red-worker-1', 'red-worker-2',
    ]);
    expect(entities.all().filter((entity) => entity.team === 'blue')).toHaveLength(3);
    expect(entities.all().filter((entity) => entity.team === 'red')).toHaveLength(3);
  });

  it('takes initial HP and unit attributes from balance config', () => {
    expect(entities.get('blue-base')).toMatchObject({ hp: BALANCE.buildings.base.hp, width: 4, height: 4 });
    expect(entities.get('blue-worker-1')).toMatchObject({
      hp: BALANCE.units.worker.hp,
      vision: BALANCE.units.worker.vision,
      movement: BALANCE.units.worker.movement,
      cooldownSeconds: BALANCE.units.worker.cooldownSeconds,
    });
  });

  it('locates a unit or any cell of a building footprint', () => {
    expect(entities.atCell(25, 99)?.id).toBe('blue-worker-1');
    expect(entities.atCell(23, 103)?.id).toBe('blue-base');
    expect(entities.atCell(24, 103)).toBeUndefined();
  });

  it('returns units within a rectangle without buildings', () => {
    expect(entities.unitsInRect(19, 98, 26, 102).map((unit) => unit.id)).toEqual([
      'blue-worker-1', 'blue-worker-2',
    ]);
  });
});
