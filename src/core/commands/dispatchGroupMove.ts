import type { Point, Team } from '../../map/MapGrid';
import type { Simulation } from '../game/Simulation';
import type { CommandResult } from './MoveCommand';

export interface GroupMoveResult {
  unitId: string;
  result: CommandResult;
}

/** Assigns nearby distinct destinations, then uses the same move command API as any player. */
export function dispatchGroupMove(
  simulation: Simulation,
  team: Team,
  unitIds: readonly string[],
  destination: Point,
): GroupMoveResult[] {
  const reserved = new Set<string>();
  const results: GroupMoveResult[] = [];
  const [targetX, targetY] = destination;
  const maxRadius = unitIds.length === 1 ? 0 : Math.ceil(Math.sqrt(unitIds.length)) + 2;
  for (const unitId of unitIds) {
    const entity = simulation.entities.get(unitId);
    if (!entity || entity.category !== 'unit') {
      results.push({ unitId, result: { accepted: false, reason: 'unknown-unit' } });
      continue;
    }
    let result: CommandResult = { accepted: false, reason: 'invalid-destination' };
    for (let radius = 0; radius <= maxRadius; radius += 1) {
      let accepted = false;
      for (let dy = -radius; dy <= radius && !accepted; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const x = targetX + dx;
          const y = targetY + dy;
          const key = `${x},${y}`;
          if (reserved.has(key) || !simulation.map.contains(x, y)) continue;
          result = simulation.issueCommand({ type: 'move', team, unitId, destination: [x, y] });
          if (result.accepted) {
            reserved.add(key);
            accepted = true;
            break;
          }
          if (result.reason === 'cooldown' || result.reason === 'wrong-owner' || result.reason === 'unknown-unit') {
            accepted = true;
            break;
          }
        }
      }
      if (accepted) break;
    }
    results.push({ unitId, result });
  }
  return results;
}
