import { describe, expect, it } from 'vitest';
import { MAP_DEFINITION } from '../config/map';
import { EntityStore } from '../core/entities/EntityStore';
import { MapGrid } from '../map/MapGrid';
import { SelectionModel } from './SelectionModel';

function setup(): SelectionModel {
  return new SelectionModel(new EntityStore(new MapGrid(MAP_DEFINITION)), 'blue');
}

describe('Fase 2 selection', () => {
  it('selects a unit or building with one click and clears on empty click', () => {
    const selection = setup();
    selection.selectAt(25, 99);
    expect(selection.selectedIds).toEqual(['blue-worker-1']);
    selection.selectAt(21, 101);
    expect(selection.selectedIds).toEqual(['blue-base']);
    selection.selectAt(30, 101);
    expect(selection.selectedIds).toEqual([]);
  });

  it('rejects enemy ownership even when additive', () => {
    const selection = setup();
    selection.selectAt(25, 99);
    selection.selectAt(174, 99, true);
    expect(selection.selectedIds).toEqual(['blue-worker-1']);
    selection.selectAt(174, 99);
    expect(selection.selectedIds).toEqual([]);
  });

  it('box-selects friendly units and excludes buildings and enemies', () => {
    const selection = setup();
    selection.selectRect(26, 102, 19, 98);
    expect(selection.selectedIds).toEqual(['blue-worker-1', 'blue-worker-2']);
    selection.selectRect(0, 0, 199, 199);
    expect(selection.selectedIds).toEqual(['blue-worker-1', 'blue-worker-2']);
  });

  it('supports Shift toggle on click and additive box selection', () => {
    const selection = setup();
    selection.selectAt(25, 99);
    selection.selectAt(25, 101, true);
    expect(selection.selectedIds).toEqual(['blue-worker-1', 'blue-worker-2']);
    selection.selectAt(25, 99, true);
    expect(selection.selectedIds).toEqual(['blue-worker-2']);
    selection.selectRect(24, 98, 26, 100, true);
    expect(selection.selectedIds).toEqual(['blue-worker-2', 'blue-worker-1']);
  });
});
