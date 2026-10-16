import { describe, expect, it } from 'vitest';
import {
  assignFormationSlots,
  generateFormationSlots,
  getMarchDirection,
  getMilitaryRole,
  isMilitaryKind,
  transformOffsetToWorld,
  type FormationUnitInfo,
} from './FormationGeometry';

describe('FormationGeometry', () => {
  it('excludes civilian units (workers and builders) from military formations', () => {
    expect(isMilitaryKind('worker')).toBe(false);
    expect(isMilitaryKind('builder')).toBe(false);
    expect(isMilitaryKind('soldier')).toBe(true);
    expect(isMilitaryKind('shieldbearer')).toBe(true);
    expect(isMilitaryKind('archer')).toBe(true);
    expect(isMilitaryKind('scout')).toBe(true);

    expect(getMilitaryRole('worker')).toBeNull();
    expect(getMilitaryRole('builder')).toBeNull();
    expect(getMilitaryRole('shieldbearer')).toBe('vanguard');
    expect(getMilitaryRole('soldier')).toBe('frontline');
    expect(getMilitaryRole('scout')).toBe('flank');
    expect(getMilitaryRole('archer')).toBe('rear');
  });

  it('determines the 8 cardinal and diagonal marching directions correctly', () => {
    expect(getMarchDirection([10, 10], [20, 10])).toBe('E');
    expect(getMarchDirection([20, 10], [10, 10])).toBe('W');
    expect(getMarchDirection([10, 10], [10, 20])).toBe('S');
    expect(getMarchDirection([10, 20], [10, 10])).toBe('N');
    expect(getMarchDirection([10, 10], [20, 20])).toBe('SE');
    expect(getMarchDirection([20, 10], [10, 20])).toBe('SW');
    expect(getMarchDirection([20, 20], [10, 10])).toBe('NW');
    expect(getMarchDirection([10, 20], [20, 10])).toBe('NE');
  });

  describe('Geometries generation', () => {
    it('generates line formation with single depth (v = 0)', () => {
      const slots = generateFormationSlots('line', 7);
      expect(slots).toHaveLength(7);
      for (const slot of slots) {
        expect(slot.v).toBe(0);
      }
      // Check distinct u values
      const uValues = new Set(slots.map((s) => s.u));
      expect(uValues.size).toBe(7);
    });

    it('generates wedge formation with front tip at (0, 0)', () => {
      const slots = generateFormationSlots('wedge', 5);
      expect(slots).toHaveLength(5);
      expect(slots[0]).toEqual({ u: 0, v: 0, preferredRole: 'vanguard' });
      // Wings have negative v (behind tip)
      expect(slots[1].v).toBeLessThan(0);
      expect(slots[2].v).toBeLessThan(0);
    });

    it('generates double-rank formation with exactly two ranks (v = 0 and v = -1)', () => {
      const slots = generateFormationSlots('double-rank', 8);
      expect(slots).toHaveLength(8);
      const v0 = slots.filter((s) => s.v === 0);
      const vMinus1 = slots.filter((s) => s.v === -1);
      expect(v0).toHaveLength(4);
      expect(vMinus1).toHaveLength(4);
    });

    it('generates block formation with multi-row rectangular shape', () => {
      const slots = generateFormationSlots('block', 12);
      expect(slots).toHaveLength(12);
      const rows = new Set(slots.map((s) => s.v));
      expect(rows.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Tactical Role-Based Slot Assignment', () => {
    it('assigns shieldbearer to vanguard tip and archers to rear in wedge', () => {
      const mixedUnits: FormationUnitInfo[] = [
        { id: 'u-arc-1', kind: 'archer', movement: 3, x: 0, y: 0 },
        { id: 'u-sld-1', kind: 'soldier', movement: 3, x: 0, y: 0 },
        { id: 'u-shd-1', kind: 'shieldbearer', movement: 2, x: 0, y: 0 },
        { id: 'u-sct-1', kind: 'scout', movement: 6, x: 0, y: 0 },
      ];

      const assignments = assignFormationSlots(mixedUnits, 'wedge', [50, 50], 'E');
      expect(assignments).toHaveLength(4);

      const shieldSlot = assignments.find((a) => a.unitId === 'u-shd-1');
      const archerSlot = assignments.find((a) => a.unitId === 'u-arc-1');

      expect(shieldSlot).toBeDefined();
      expect(archerSlot).toBeDefined();

      // Shieldbearer should be at the vanguard / frontmost slot (v = 0)
      expect(shieldSlot!.offset.v).toBe(0);
      expect(shieldSlot!.role).toBe('vanguard');

      // Archer should be behind the vanguard
      expect(archerSlot!.offset.v).toBeLessThanOrEqual(shieldSlot!.offset.v);
      expect(archerSlot!.role).toBe('rear');
    });

    it('ignores workers when assigning military formation slots', () => {
      const unitsWithWorker: FormationUnitInfo[] = [
        { id: 'u-wrk-1', kind: 'worker', movement: 5, x: 0, y: 0 },
        { id: 'u-bld-1', kind: 'builder', movement: 5, x: 0, y: 0 },
        { id: 'u-sld-1', kind: 'soldier', movement: 3, x: 0, y: 0 },
        { id: 'u-shd-1', kind: 'shieldbearer', movement: 2, x: 0, y: 0 },
      ];

      const assignments = assignFormationSlots(unitsWithWorker, 'line', [50, 50], 'E');
      expect(assignments).toHaveLength(2);
      expect(assignments.map((a) => a.unitId)).toEqual(['u-shd-1', 'u-sld-1']);
    });

    it('transforms offsets correctly in world space across directions', () => {
      // Offset u = 1 (lateral), v = 2 (forward)
      const east = transformOffsetToWorld(1, 2, 'E');
      expect(east).toEqual([2, 1]); // +X forward, +Y right

      const west = transformOffsetToWorld(1, 2, 'W');
      expect(west).toEqual([-2, -1]);

      const south = transformOffsetToWorld(1, 2, 'S');
      expect(south).toEqual([-1, 2]);

      const north = transformOffsetToWorld(1, 2, 'N');
      expect(north).toEqual([1, -2]);
    });
  });

  describe('Scale tests', () => {
    it('handles 5, 20, and 50 units without duplicate slot collisions across all directions', () => {
      const directions = ['E', 'W', 'S', 'N', 'SE', 'SW', 'NW', 'NE'] as const;
      for (const count of [5, 20, 50]) {
        for (const type of ['line', 'wedge', 'block', 'double-rank'] as const) {
          for (const dir of directions) {
            const units: FormationUnitInfo[] = Array.from({ length: count }, (_, i) => ({
              id: `u-${i}`,
              kind: i % 4 === 0 ? 'shieldbearer' : (i % 4 === 1 ? 'soldier' : (i % 4 === 2 ? 'archer' : 'scout')),
              movement: 3,
              x: 10,
              y: 10,
            }));

            const slots = assignFormationSlots(units, type, [100, 100], dir);
            expect(slots).toHaveLength(count);

            const keys = new Set(slots.map((s) => `${s.destination[0]},${s.destination[1]}`));
            expect(keys.size).toBe(count); // Every unit must have a distinct cell!
          }
        }
      }
    });
  });
});
