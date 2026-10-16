import { findPath } from '../../map/findPath';
import type { Point } from '../../map/MapGrid';
import { findReachableAttackCell } from '../commands/dispatchGroupAttack';
import type { BuildingEntity, GameEntity, UnitEntity } from '../entities/EntityStore';
import type { Simulation } from '../game/Simulation';

interface Engagement {
  destination: Point;
  targetId: string;
}

export function findBlockingEnemyStructure(
  simulation: Simulation,
  unit: UnitEntity,
  destination: Point,
): BuildingEntity | null {
  if (unit.damage <= 0) return null;
  let hasBarricade = false;
  for (const ent of simulation.entities.all()) {
    if (ent.category === 'building' && ent.team !== unit.team && ent.hp > 0 && ent.kind === 'barricade') {
      hasBarricade = true;
      break;
    }
  }
  if (!hasBarricade) return null;

  const path = findPath(
    simulation.map,
    [unit.x, unit.y],
    destination,
    (x, y) => {
      if (!simulation.map.isPassable(x, y)) {
        const ent = simulation.entities.atCell(x, y);
        if (ent && ent.category === 'building' && ent.team !== unit.team && ent.hp > 0) {
          return true;
        }
        return false;
      }
      return simulation.entities.isFreeForUnit(x, y, unit.id);
    },
  );
  if (!path) return null;
  for (const [x, y] of path) {
    const ent = simulation.entities.atCell(x, y);
    if (ent && ent.category === 'building' && ent.team !== unit.team && ent.hp > 0) {
      return ent as BuildingEntity;
    }
  }
  return null;
}

/** Diverts troops on attack-move toward enemies in their own vision, resuming march after threats are cleared. */
export class MarchEngagementSystem {
  private readonly active = new Map<string, Engagement>();

  constructor(private readonly simulation: Simulation) {}

  statusFor(unitId: string): Readonly<Engagement> | null {
    const state = this.active.get(unitId);
    return state ? { ...state, destination: [...state.destination] as Point } : null;
  }

  isEngaged(unitId: string): boolean { return this.active.has(unitId); }

  setTarget(unitId: string, destination: Point, targetId: string): void {
    this.active.set(unitId, { destination: [...destination] as Point, targetId });
    this.simulation.movement.cancel(unitId);
    const unit = this.simulation.entities.get(unitId);
    const target = this.simulation.entities.get(targetId);
    if (unit && unit.category === 'unit' && target && this.simulation.combat.distance(unit, target) <= unit.range) {
      this.simulation.combat.setManualTarget(unitId, targetId);
    }
  }

  cancel(unitId: string): void {
    this.active.delete(unitId);
  }

  update(currentTick: number): void {
    // 1. Process active engagements
    for (const [unitId, state] of this.active) {
      const unit = this.simulation.entities.get(unitId);
      if (!unit || unit.category !== 'unit' || unit.hp <= 0) {
        this.active.delete(unitId);
        continue;
      }
      const target = this.simulation.entities.get(state.targetId);
      const targetValid = target && target.hp > 0 && target.team !== unit.team && this.seenByUnit(unit, target);

      if (!targetValid) {
        this.simulation.combat.cancel(unitId);
        this.simulation.movement.cancel(unitId);

        // Check if there are other enemies in vision before resuming march
        const nextTarget = this.pickTarget(unit);
        if (nextTarget) {
          state.targetId = nextTarget.id;
          if (this.simulation.combat.distance(unit, nextTarget) <= unit.range) {
            this.simulation.combat.setManualTarget(unitId, nextTarget.id);
          }
          continue;
        }

        // Check if still blocked by enemy barricade to reach destination
        const blocking = findBlockingEnemyStructure(this.simulation, unit, state.destination);
        if (blocking) {
          state.targetId = blocking.id;
          if (this.simulation.combat.distance(unit, blocking) <= unit.range) {
            this.simulation.combat.setManualTarget(unitId, blocking.id);
          }
          continue;
        }

        // All threats cleared: resume march towards destination
        if (currentTick >= unit.cooldownUntilTick) {
          unit.attackMoveTarget = state.destination;
          const res = this.simulation.issueCommand({
            type: 'attack-move',
            team: unit.team,
            unitId,
            destination: state.destination,
          });
          if (res.accepted) {
            this.active.delete(unitId);
          }
        }
        continue;
      }

      // Target is valid:
      if (this.simulation.combat.distance(unit, target) <= unit.range) {
        this.simulation.movement.cancel(unitId);
        this.simulation.combat.setManualTarget(unitId, target.id);
        continue;
      }
      if (unit.moveTarget || currentTick < unit.cooldownUntilTick) continue;
      const approach = findReachableAttackCell(this.simulation, unit, target, new Set());
      if (approach) {
        this.simulation.movement.issue({ type: 'move', team: unit.team, unitId, destination: approach }, currentTick);
      }
    }

    // 2. Discover new targets for troops on attack-move
    for (const entity of this.simulation.entities.all()) {
      if (entity.category !== 'unit' || entity.hp <= 0 || entity.damage <= 0 || this.active.has(entity.id)) continue;
      if (this.simulation.combat.manualTargetFor(entity.id)) continue;

      // Only engage if unit is on ATTACK-MOVE (has attackMoveTarget)
      if (!entity.attackMoveTarget) continue;
      const destination = entity.attackMoveTarget;

      const target = this.pickTarget(entity);
      if (target) {
        this.active.set(entity.id, { destination: [...destination] as Point, targetId: target.id });
        this.simulation.movement.cancel(entity.id);
        if (this.simulation.combat.distance(entity, target) <= entity.range) {
          this.simulation.combat.setManualTarget(entity.id, target.id);
        }
        continue;
      }

      // If no enemy unit in sight, check if path to destination is blocked by an enemy barricade/structure
      if (!entity.moveTarget && currentTick % 10 === 0) {
        const blocking = findBlockingEnemyStructure(this.simulation, entity, destination);
        if (blocking) {
          this.active.set(entity.id, { destination: [...destination] as Point, targetId: blocking.id });
          this.simulation.movement.cancel(entity.id);
          if (this.simulation.combat.distance(entity, blocking) <= entity.range) {
            this.simulation.combat.setManualTarget(entity.id, blocking.id);
          }
        }
      }
    }
  }

  private pickTarget(unit: UnitEntity): GameEntity | null {
    if (unit.damage <= 0) return null;
    const candidates = this.simulation.entities.nearby(unit.x, unit.y, unit.vision).filter((target) => {
      if (target.team === unit.team || target.hp <= 0) return false;
      if (!this.seenByUnit(unit, target)) return false;
      // Barricades are only attacked automatically when blocking the path, not without context
      if (target.category === 'building' && target.kind === 'barricade') {
        return false;
      }
      return true;
    });
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      // Prioritize mobile units over buildings
      const aIsUnit = a.category === 'unit' ? 0 : 1;
      const bIsUnit = b.category === 'unit' ? 0 : 1;
      if (aIsUnit !== bIsUnit) return aIsUnit - bIsUnit;
      return this.simulation.combat.distance(unit, a) - this.simulation.combat.distance(unit, b)
        || a.hp - b.hp || a.id.localeCompare(b.id);
    });
    return candidates[0] ?? null;
  }

  private seenByUnit(unit: UnitEntity, target: GameEntity): boolean {
    return this.simulation.fog.isEntityVisible(unit.team, target)
      && this.simulation.combat.distance(unit, target) <= unit.vision;
  }
}
