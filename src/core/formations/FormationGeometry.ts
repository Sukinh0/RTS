import type { Point } from '../../map/MapGrid';
import type { UnitKind } from '../entities/EntityStore';

export type FormationType = 'line' | 'wedge' | 'block' | 'double-rank';

export type MilitaryRole = 'vanguard' | 'frontline' | 'flank' | 'rear';

export interface FormationUnitInfo {
  id: string;
  kind: UnitKind;
  movement: number;
  x: number;
  y: number;
}

export interface SlotOffset {
  u: number; // Lateral offset relative to marching direction (0 = center, negative = left, positive = right)
  v: number; // Longitudinal offset relative to marching direction (0 = front, negative = rear)
  preferredRole?: MilitaryRole;
}

export interface UnitSlotAssignment {
  unitId: string;
  role: MilitaryRole;
  slotIndex: number;
  offset: SlotOffset;
  destination: Point;
}

export function isMilitaryKind(kind: UnitKind): boolean {
  return kind === 'soldier' || kind === 'shieldbearer' || kind === 'archer' || kind === 'scout';
}

export function getMilitaryRole(kind: UnitKind): MilitaryRole | null {
  switch (kind) {
    case 'shieldbearer':
      return 'vanguard';
    case 'soldier':
      return 'frontline';
    case 'scout':
      return 'flank';
    case 'archer':
      return 'rear';
    default:
      return null;
  }
}

export type MarchDirection = 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW';

/**
 * Calculates marching direction based on delta from start to target.
 */
export function getMarchDirection(from: Point, to: Point): MarchDirection {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (dx === 0 && dy === 0) return 'E';

  const angle = Math.atan2(dy, dx); // radians from -PI to PI (0 is +X, PI/2 is +Y)
  // Convert angle to 8 sectors of 45 degrees (PI/4)
  const deg = (angle * 180) / Math.PI;

  if (deg >= -22.5 && deg < 22.5) return 'E';
  if (deg >= 22.5 && deg < 67.5) return 'SE';
  if (deg >= 67.5 && deg < 112.5) return 'S';
  if (deg >= 112.5 && deg < 157.5) return 'SW';
  if (deg >= 157.5 || deg < -157.5) return 'W';
  if (deg >= -157.5 && deg < -112.5) return 'NW';
  if (deg >= -112.5 && deg < -67.5) return 'N';
  return 'NE';
}

/**
 * Transforms relative formation offset (u = lateral, v = forward/rear)
 * into world grid offsets (dx, dy) aligned with marching direction.
 */
export function transformOffsetToWorld(u: number, v: number, dir: MarchDirection): [number, number] {
  switch (dir) {
    case 'E':
      // Forward is +X, lateral is +Y
      return [v, u];
    case 'W':
      // Forward is -X, lateral is -Y
      return [-v, -u];
    case 'S':
      // Forward is +Y, lateral is -X
      return [-u, v];
    case 'N':
      // Forward is -Y, lateral is +X
      return [u, -v];
    case 'SE':
      // Diagonal: rotate 45 deg clockwise
      return [v - u, v + u];
    case 'SW':
      return [-v - u, v - u];
    case 'NW':
      return [-v + u, -v - u];
    case 'NE':
      return [v + u, -v + u];
  }
}

/**
 * Generates relative slots (u, v) for the given formation type and unit count.
 * Sorted from highest front priority (vanguard/frontline) to rear.
 */
export function generateFormationSlots(type: FormationType, count: number): SlotOffset[] {
  if (count <= 0) return [];

  const slots: SlotOffset[] = [];

  switch (type) {
    case 'line': {
      // Single continuous line perpendicular to march direction (v = 0).
      // Slots spread out laterally from center: 0, 1, -1, 2, -2, 3, -3...
      const lateralOrder: number[] = [0];
      for (let i = 1; lateralOrder.length < count; i++) {
        lateralOrder.push(i);
        if (lateralOrder.length < count) lateralOrder.push(-i);
      }
      for (let i = 0; i < count; i++) {
        const u = lateralOrder[i];
        // Center is vanguard/front, extreme edges are flank
        const isFlank = Math.abs(u) >= Math.floor(count / 2) && count >= 4;
        slots.push({
          u,
          v: 0,
          preferredRole: isFlank ? 'flank' : (Math.abs(u) <= 1 ? 'vanguard' : 'frontline'),
        });
      }
      break;
    }

    case 'wedge': {
      // Wedge (V-shape) pointing forward.
      // Tip at (0, 0), wings at (+1, -1), (-1, -1), (+2, -2), (-2, -2)...
      // Interior filled for rear units if needed.
      slots.push({ u: 0, v: 0, preferredRole: 'vanguard' });
      let currentDepth = 1;
      while (slots.length < count) {
        // Wings first
        slots.push({ u: -currentDepth, v: -currentDepth, preferredRole: 'frontline' });
        if (slots.length < count) {
          slots.push({ u: currentDepth, v: -currentDepth, preferredRole: 'frontline' });
        }
        // Fill interior of previous rows if formation is large
        if (currentDepth > 1 && slots.length < count) {
          for (let fillU = -currentDepth + 1; fillU <= currentDepth - 1 && slots.length < count; fillU++) {
            if (!slots.some((s) => s.u === fillU && s.v === -currentDepth)) {
              slots.push({ u: fillU, v: -currentDepth, preferredRole: 'rear' });
            }
          }
        }
        currentDepth++;
      }
      // Re-tag the outermost rear wings as flanks
      const maxV = Math.min(...slots.map((s) => s.v));
      slots.forEach((s) => {
        if (s.v === maxV && Math.abs(s.u) > 0) {
          s.preferredRole = 'flank';
        }
      });
      break;
    }

    case 'double-rank': {
      // Two parallel lines: v = 0 (front rank) and v = -1 (rear rank).
      const frontCount = Math.ceil(count / 2);
      const rearCount = count - frontCount;

      const genRank = (v: number, n: number, defaultRole: MilitaryRole): SlotOffset[] => {
        const uOrder: number[] = [0];
        for (let i = 1; uOrder.length < n; i++) {
          uOrder.push(i);
          if (uOrder.length < n) uOrder.push(-i);
        }
        return uOrder.map((u) => {
          const isEdge = Math.abs(u) === Math.max(...uOrder.map(Math.abs));
          return {
            u,
            v,
            preferredRole: isEdge && n >= 4 ? 'flank' : defaultRole,
          };
        });
      };

      const frontSlots = genRank(0, frontCount, 'vanguard');
      const rearSlots = genRank(-1, rearCount, 'rear');
      slots.push(...frontSlots, ...rearSlots);
      break;
    }

    case 'block': {
      // Rectangular solid block. Width ~ 1.5x depth.
      const width = Math.max(3, Math.ceil(Math.sqrt(count * 1.5)));
      const rows = Math.ceil(count / width);

      for (let r = 0; r < rows && slots.length < count; r++) {
        const v = -r; // 0 = front, -1 = second row, etc.
        const rowCapacity = Math.min(width, count - slots.length);
        const uOrder: number[] = [0];
        for (let i = 1; uOrder.length < rowCapacity; i++) {
          uOrder.push(i);
          if (uOrder.length < rowCapacity) uOrder.push(-i);
        }
        uOrder.sort((a, b) => a - b); // order left to right

        for (let c = 0; c < rowCapacity; c++) {
          const u = uOrder[c];
          const isFlankCol = c === 0 || c === rowCapacity - 1;
          let role: MilitaryRole = 'frontline';
          if (r === 0) role = isFlankCol ? 'flank' : 'vanguard';
          else if (r === rows - 1) role = isFlankCol ? 'flank' : 'rear';
          else role = isFlankCol ? 'flank' : (r > 1 ? 'rear' : 'frontline');

          slots.push({ u, v, preferredRole: role });
        }
      }
      break;
    }
  }

  return slots;
}

/**
 * Sorts military units to match tactical slot expectations:
 * Vanguard (Shieldbearer) -> Frontline (Soldier) -> Flank (Scout) -> Rear (Archer).
 */
export function sortUnitsByRolePriority(units: readonly FormationUnitInfo[]): FormationUnitInfo[] {
  const roleScore: Record<MilitaryRole, number> = {
    vanguard: 0,
    frontline: 1,
    flank: 2,
    rear: 3,
  };

  return [...units].sort((a, b) => {
    const roleA = getMilitaryRole(a.kind) ?? 'frontline';
    const roleB = getMilitaryRole(b.kind) ?? 'frontline';
    if (roleScore[roleA] !== roleScore[roleB]) {
      return roleScore[roleA] - roleScore[roleB];
    }
    // Stable tie-breaker
    return a.id.localeCompare(b.id);
  });
}

/**
 * Computes destination points on the world grid for each unit according to formation geometry.
 */
export function assignFormationSlots(
  units: readonly FormationUnitInfo[],
  formationType: FormationType,
  destination: Point,
  direction: MarchDirection,
): UnitSlotAssignment[] {
  // 1. Filter out civilians (workers and builders are NOT in military formations)
  const militaryUnits = units.filter((u) => isMilitaryKind(u.kind));
  if (militaryUnits.length === 0) return [];

  // 2. Generate geometry slots
  const slots = generateFormationSlots(formationType, militaryUnits.length);

  // 3. Sort units by tactical role
  const sortedUnits = sortUnitsByRolePriority(militaryUnits);

  // 4. Sort slots by preferred role priority so vanguard units get vanguard slots
  const slotRoleScore: Record<MilitaryRole, number> = {
    vanguard: 0,
    frontline: 1,
    flank: 2,
    rear: 3,
  };

  // Sort slots indexing by roleScore, while keeping v >= 0 front priority
  const indexedSlots = slots.map((slot, index) => ({ slot, originalIndex: index }));
  indexedSlots.sort((a, b) => {
    const scoreA = slotRoleScore[a.slot.preferredRole ?? 'frontline'];
    const scoreB = slotRoleScore[b.slot.preferredRole ?? 'frontline'];
    if (scoreA !== scoreB) return scoreA - scoreB;
    // Tie-break: closer to front (higher v), then closer to center (|u|)
    if (a.slot.v !== b.slot.v) return b.slot.v - a.slot.v;
    return Math.abs(a.slot.u) - Math.abs(b.slot.u);
  });

  const [destX, destY] = destination;
  const assignments: UnitSlotAssignment[] = [];

  for (let i = 0; i < sortedUnits.length; i++) {
    const unit = sortedUnits[i];
    const { slot, originalIndex } = indexedSlots[i];
    const role = getMilitaryRole(unit.kind) ?? 'frontline';
    const [dx, dy] = transformOffsetToWorld(slot.u, slot.v, direction);

    assignments.push({
      unitId: unit.id,
      role,
      slotIndex: originalIndex,
      offset: slot,
      destination: [destX + dx, destY + dy],
    });
  }

  return assignments;
}
