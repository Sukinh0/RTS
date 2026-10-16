import type { Team } from '../../map/MapGrid';
import type { Simulation } from '../game/Simulation';
import type { CommandResult } from './MoveCommand';
import type { GameEntity, UnitEntity } from '../entities/EntityStore';

export interface GroupAttackResult {
  unitId: string;
  result: CommandResult;
}

export function findReachableAttackCell(
  simulation: Simulation,
  unit: UnitEntity,
  target: GameEntity,
  reserved: Set<string>,
): [number, number] | null {
  const maxRange = Math.max(1, Math.floor(unit.range));
  const candidates: Array<{ cell: [number, number]; distToUnit: number }> = [];

  if (target.category === 'unit') {
    for (let dy = -maxRange; dy <= maxRange; dy += 1) {
      for (let dx = -maxRange; dx <= maxRange; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const x = target.x + dx;
        const y = target.y + dy;
        const key = `${x},${y}`;
        if (reserved.has(key) || !simulation.map.contains(x, y)) continue;
        if (!simulation.entities.isFreeForUnit(x, y, unit.id)) continue;
        if (simulation.combat.distance({ ...unit, x, y }, target) <= unit.range) {
          candidates.push({
            cell: [x, y],
            distToUnit: Math.hypot(unit.x - x, unit.y - y),
          });
        }
      }
    }
  } else {
    for (let dy = target.y - maxRange; dy <= target.y + target.height - 1 + maxRange; dy += 1) {
      for (let dx = target.x - maxRange; dx <= target.x + target.width - 1 + maxRange; dx += 1) {
        if (dx >= target.x && dx < target.x + target.width && dy >= target.y && dy < target.y + target.height) {
          continue;
        }
        const key = `${dx},${dy}`;
        if (reserved.has(key) || !simulation.map.contains(dx, dy)) continue;
        if (!simulation.entities.isFreeForUnit(dx, dy, unit.id)) continue;
        if (simulation.combat.distance({ ...unit, x: dx, y: dy }, target) <= unit.range) {
          candidates.push({
            cell: [dx, dy],
            distToUnit: Math.hypot(unit.x - dx, unit.y - dy),
          });
        }
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.distToUnit - b.distToUnit);
  return candidates[0].cell;
}

/** Assigns attack orders to a group: units in range attack, units out of range move into attack range. */
export function dispatchGroupAttack(
  simulation: Simulation,
  team: Team,
  unitIds: readonly string[],
  targetId: string,
): GroupAttackResult[] {
  const target = simulation.entities.get(targetId);
  if (!target) {
    return unitIds.map((unitId) => ({ unitId, result: { accepted: false, reason: 'target-not-found' } }));
  }
  if (target.team === team) {
    return unitIds.map((unitId) => ({ unitId, result: { accepted: false, reason: 'target-friendly' } }));
  }
  if (!simulation.fog.isEntityVisible(team, target)) {
    return unitIds.map((unitId) => ({ unitId, result: { accepted: false, reason: 'target-not-visible' } }));
  }

  const results: GroupAttackResult[] = [];
  const reserved = new Set<string>();

  for (const unitId of unitIds) {
    const unit = simulation.entities.get(unitId);
    if (!unit || unit.category !== 'unit') {
      results.push({ unitId, result: { accepted: false, reason: 'unknown-unit' } });
      continue;
    }
    if (unit.team !== team) {
      results.push({ unitId, result: { accepted: false, reason: 'wrong-owner' } });
      continue;
    }
    if (unit.damage <= 0) {
      results.push({ unitId, result: { accepted: false, reason: 'cannot-attack' } });
      continue;
    }

    const dist = simulation.combat.distance(unit, target);
    if (dist <= unit.range) {
      const result = simulation.issueCommand({ type: 'attack', team, unitId, targetId });
      results.push({ unitId, result });
    } else {
      if (unit.moveTarget !== null && simulation.combat.manualTargetFor(unitId) === targetId) {
        results.push({ unitId, result: { accepted: true } });
        continue;
      }
      const targetCell = findReachableAttackCell(simulation, unit, target, reserved);
      if (!targetCell) {
        results.push({ unitId, result: { accepted: false, reason: 'no-path' } });
        continue;
      }
      const moveRes = simulation.issueCommand({ type: 'move', team, unitId, destination: targetCell });
      if (moveRes.accepted) {
        reserved.add(`${targetCell[0]},${targetCell[1]}`);
        simulation.combat.setManualTarget(unitId, targetId);
      }
      results.push({ unitId, result: moveRes });
    }
  }

  return results;
}
