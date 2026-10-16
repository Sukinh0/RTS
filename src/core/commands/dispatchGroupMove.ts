import type { Point, Team } from '../../map/MapGrid';
import { isMilitaryKind, type FormationType } from '../formations/FormationGeometry';
import type { Simulation } from '../game/Simulation';
import type { CommandResult } from './MoveCommand';

export interface GroupMoveResult {
  unitId: string;
  result: CommandResult;
}

/** Assigns destinations based on formation geometry (if military troops) or radial dispersion (for civilians/fallback). */
export function dispatchGroupMove(
  simulation: Simulation,
  team: Team,
  unitIds: readonly string[],
  destination: Point,
  attackMove = false,
  formationType?: FormationType | null,
): GroupMoveResult[] {
  const results: GroupMoveResult[] = [];
  const processed = new Set<string>();

  // If no formation is selected (Free Mode), release units from any previous formations
  if (!formationType) {
    for (const id of unitIds) {
      simulation.formations.removeUnit(id);
    }
  }

  // 1. If a formation type is requested and there are >= 2 military units, form a tactical formation
  if (formationType) {
    const militaryIds = unitIds.filter((id) => {
      const ent = simulation.entities.get(id);
      return ent && ent.category === 'unit' && ent.team === team && isMilitaryKind(ent.kind) && ent.hp > 0;
    });

    if (militaryIds.length >= 2) {
      const group = simulation.formations.createFormation(team, militaryIds, formationType, destination, attackMove);
      if (group) {
        for (const [unitId, slot] of group.slots) {
          processed.add(unitId);
          let result = simulation.issueCommand(
            attackMove
              ? { type: 'attack-move', team, unitId, destination: slot.currentTarget }
              : { type: 'move', team, unitId, destination: slot.currentTarget },
          );

          if (!result.accepted) {
            const altCell = simulation.movement.findNearestFreeNeighbor(slot.currentTarget[0], slot.currentTarget[1], unitId)
              ?? slot.destination;
            slot.currentTarget = altCell;
            result = simulation.issueCommand(
              attackMove
                ? { type: 'attack-move', team, unitId, destination: altCell }
                : { type: 'move', team, unitId, destination: altCell },
            );
            if (!result.accepted) {
              const entity = simulation.entities.get(unitId);
              if (entity && entity.category === 'unit') {
                entity.moveTarget = altCell;
                if (attackMove) {
                  entity.attackMoveTarget = altCell;
                } else {
                  entity.attackMoveTarget = null;
                }
                simulation.engagements.cancel(unitId);
                simulation.combat.cancel(unitId);
                simulation.economy.cancel(unitId);
                simulation.construction.cancel(unitId);
                result = { accepted: true };
              }
            }
          }

          results.push({ unitId, result });
        }
      }
    }
  }

  // 2. Units not in military formation (civilians like workers/builders, or remaining units) use normal dispersion
  const remainingIds = unitIds.filter((id) => !processed.has(id));
  if (remainingIds.length === 0) {
    return results;
  }

  const reserved = new Set<string>();
  const [targetX, targetY] = destination;
  const maxRadius = Math.max(5, Math.ceil(Math.sqrt(remainingIds.length)) + 2);

  for (const unitId of remainingIds) {
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
          result = simulation.issueCommand(
            attackMove
              ? { type: 'attack-move', team, unitId, destination: [x, y] }
              : { type: 'move', team, unitId, destination: [x, y] },
          );
          if (result.accepted) {
            reserved.add(key);
            accepted = true;
            break;
          }
          if (result.reason === 'cooldown') {
            if (
              !(entity.x === x && entity.y === y) &&
              simulation.entities.isFreeForUnit(x, y, entity.id) &&
              simulation.movement.hasStaticPath(entity, [x, y])
            ) {
              entity.moveTarget = [x, y];
              if (attackMove) {
                entity.attackMoveTarget = [x, y];
              } else {
                entity.attackMoveTarget = null;
              }
              simulation.engagements.cancel(unitId);
              simulation.combat.cancel(unitId);
              simulation.economy.cancel(unitId);
              simulation.construction.cancel(unitId);
              reserved.add(key);
              accepted = true;
              result = { accepted: true };
              break;
            }
          }
          if (result.reason === 'wrong-owner' || result.reason === 'unknown-unit') {
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

export function dispatchGroupAttackMove(
  simulation: Simulation,
  team: Team,
  unitIds: readonly string[],
  destination: Point,
  formationType?: FormationType | null,
): GroupMoveResult[] {
  return dispatchGroupMove(simulation, team, unitIds, destination, true, formationType);
}
