import { TICKS_PER_SECOND } from '../../config/runtime';
import { findPath, terrainHeuristic } from '../../map/findPath';
import type { Point } from '../../map/MapGrid';
import type { MoveCommand, CommandResult } from '../commands/MoveCommand';
import { EntityStore, type UnitEntity } from '../entities/EntityStore';

export interface MovementEvent {
  unitId: string;
  path: Point[];
}
export interface MovementFailureEvent {
  unitId: string;
  reason: 'no-path' | 'invalid-destination';
}


/** Executes one bounded movement action per available unit per cooldown cycle. */
export class MovementSystem {
  private readonly events: MovementEvent[] = [];
  private readonly failures: MovementFailureEvent[] = [];
  private speedLimitProvider?: (unit: UnitEntity) => number;
  private readonly routes = new WeakMap<UnitEntity, {
    goal: Point; path: Point[] | null; x: number; y: number; spatial: number; navigation: number; blockedSinceTick?: number;
  }>();
  private sortedRevision = -1;
  private sortedUnits: UnitEntity[] = [];

  constructor(private readonly entities: EntityStore) {}

  setSpeedLimitProvider(provider: (unit: UnitEntity) => number): void {
    this.speedLimitProvider = provider;
  }

  issue(command: MoveCommand, currentTick: number): CommandResult {
    const entity = this.entities.get(command.unitId);
    if (!entity || entity.category !== 'unit') return { accepted: false, reason: 'unknown-unit' };
    if (entity.team !== command.team) return { accepted: false, reason: 'wrong-owner' };
    // A unit already marching may change its destination; its next step still waits for cooldown.
    if (currentTick < entity.cooldownUntilTick && !entity.moveTarget) return { accepted: false, reason: 'cooldown' };
    const [x, y] = command.destination;
    if (!this.entities.map.contains(x, y) || !this.entities.isFreeForUnit(x, y, entity.id)) {
      return { accepted: false, reason: 'invalid-destination' };
    }
    if (entity.x === x && entity.y === y) return { accepted: false, reason: 'already-there' };
    // Dynamic congestion is explicitly allowed by this command contract. Checking a
    // dynamic path first did the same expensive search again at the next action.
    if (!this.hasStaticPath(entity, command.destination)) {
      return { accepted: false, reason: 'no-path' };
    }
    entity.moveTarget = [x, y];
    if (command.attackMove) {
      entity.attackMoveTarget = [x, y];
    }
    return { accepted: true };
  }

  update(currentTick: number): number {
    let moved = 0;
    const firstTeam = Math.floor(currentTick / TICKS_PER_SECOND) % 2 === 0 ? 'blue' : 'red';
    if (this.sortedRevision !== this.entities.revision) {
      this.sortedUnits = this.entities.all().filter((entity): entity is UnitEntity => entity.category === 'unit')
        .sort((a, b) => a.id.localeCompare(b.id));
      this.sortedRevision = this.entities.revision;
    }
    const units = [...this.sortedUnits.filter(u => u.team === firstTeam), ...this.sortedUnits.filter(u => u.team !== firstTeam)];
    for (const entity of units) {
      if (!entity.moveTarget || currentTick < entity.cooldownUntilTick) continue;

      const [destX, destY] = entity.moveTarget;
      if (entity.x === destX && entity.y === destY) {
        entity.moveTarget = null;
        if (entity.attackMoveTarget && entity.attackMoveTarget[0] === destX && entity.attackMoveTarget[1] === destY) {
          entity.attackMoveTarget = null;
        }
        continue;
      }

      // Check if destination is occupied by an ally
      let effectiveGoal: Point = [destX, destY];
      const occupier = this.entities.atCell(destX, destY);
      if (occupier && occupier.id !== entity.id) {
        if (occupier.category === 'unit' && occupier.team === entity.team) {
          const distToGoal = Math.max(Math.abs(entity.x - destX), Math.abs(entity.y - destY));
          if (distToGoal <= 1) {
            entity.moveTarget = null;
            if (entity.attackMoveTarget && entity.attackMoveTarget[0] === destX && entity.attackMoveTarget[1] === destY) {
              entity.attackMoveTarget = null;
            }
            continue;
          }
          const freeNeighbor = this.findNearestFreeNeighbor(destX, destY, entity.id);
          if (freeNeighbor) {
            effectiveGoal = freeNeighbor;
          }
        }
      }

      const path = this.pathFor(entity, effectiveGoal, currentTick);
      if (!path || path.length < 2) {
        if (this.hasStaticPath(entity, effectiveGoal)) {
          // Path exists on map terrain, but is temporarily congested by friendly units.
          // Wait 2 ticks instead of cancelling the movement order.
          entity.cooldownUntilTick = currentTick + 2;
          continue;
        }
        this.failures.push({ unitId: entity.id, reason: 'no-path' });
        entity.moveTarget = null;
        continue;
      }

      const maxAllowed = this.speedLimitProvider ? Math.min(entity.movement, this.speedLimitProvider(entity)) : entity.movement;
      const steps = Math.min(maxAllowed, path.length - 1);
      let stepped = -1;
      for (let s = steps; s >= 1; s--) {
        const [x, y] = path[s];
        if (this.entities.moveUnit(entity.id, x, y)) {
          stepped = s;
          break;
        }
      }

      if (stepped >= 1) {
        this.events.push({ unitId: entity.id, path: path.slice(0, stepped + 1) });
        moved += 1;
        entity.cooldownUntilTick = currentTick + Math.round(entity.movementCooldownSeconds * TICKS_PER_SECOND);
        if (entity.x === entity.moveTarget[0] && entity.y === entity.moveTarget[1]) {
          entity.moveTarget = null;
          if (entity.attackMoveTarget && entity.x === entity.attackMoveTarget[0] && entity.y === entity.attackMoveTarget[1]) {
            entity.attackMoveTarget = null;
          }
        }
      } else {
        // Steps temporarily occupied by other units ahead. Wait 2 ticks for them to move.
        entity.cooldownUntilTick = currentTick + 2;
      }
    }
    return moved;
  }

  drainEvents(): MovementEvent[] {
    return this.events.splice(0);
  }

  drainFailures(): MovementFailureEvent[] {
    return this.failures.splice(0);
  }

  cooldownRemainingTicks(unit: UnitEntity, currentTick: number): number {
    return Math.max(0, unit.cooldownUntilTick - currentTick);
  }

  cancel(unitId: string): void {
    const entity = this.entities.get(unitId);
    if (entity && entity.category === 'unit') {
      entity.moveTarget = null;
      this.routes.delete(entity);
    }
  }

  private pathFor(unit: UnitEntity, goal: Point, currentTick: number): Point[] | null {
    if (!this.entities.map.hasStaticConnection([unit.x, unit.y], goal)) return null;
    const cached = this.routes.get(unit);
    const navigation = this.entities.map.navigationRevision;
    const spatial = this.entities.spatialRevision;
    if (cached && cached.goal[0] === goal[0] && cached.goal[1] === goal[1] && cached.navigation === navigation) {
      if (cached.x === unit.x && cached.y === unit.y && cached.spatial === spatial) return cached.path;
      if (cached.path) {
        const start = cached.path.findIndex(p => p[0] === unit.x && p[1] === unit.y);
        if (start >= 0 && this.routeIsFree(unit, cached.path, start)) {
          cached.path = cached.path.slice(start);
          cached.x = unit.x; cached.y = unit.y; cached.spatial = spatial;
          cached.blockedSinceTick = undefined;
          return cached.path;
        }
        if (start >= 0 && this.blockedByAlly(unit, cached.path, start)) {
          cached.blockedSinceTick ??= currentTick;
          if (currentTick - cached.blockedSinceTick < 8) {
            this.entities.map.diagnostics?.record('allyCongestionWaits', 0);
            return null;
          }
        }
      }
    }
    const useGuide = this.sortedUnits.length >= 32 && Math.max(Math.abs(goal[0] - unit.x), Math.abs(goal[1] - unit.y)) > 24
      && this.entities.map.isPassable(unit.x, unit.y);
    const path = findPath(this.entities.map, [unit.x, unit.y], goal,
      (x, y) => {
        if (!this.entities.map.isPassable(x, y)) return false;
        const b = this.entities.atCell(x, y);
        if (b && b.category === 'building') return false;
        if (b && b.category === 'unit' && b.id !== unit.id) {
          if (x === goal[0] && y === goal[1]) return false;
          if (b.team !== unit.team) return false;
          if (!b.moveTarget) return false;
        }
        return true;
      },
      useGuide ? terrainHeuristic(this.entities.map, goal) : undefined);
    this.routes.set(unit, { goal: [goal[0], goal[1]], path, x: unit.x, y: unit.y, spatial, navigation });
    return path;
  }

  private routeIsFree(unit: UnitEntity, path: Point[], start: number): boolean {
    // Validate two movement actions ahead. A distant temporary occupier is handled
    // when approached instead of invalidating the entire formation's route now.
    const end = Math.min(path.length, start + Math.max(1, unit.movement) * 2 + 1);
    for (let i = start + 1; i < end; i++) {
      const [x, y] = path[i];
      const [px, py] = path[i - 1];
      if (!this.entities.isFreeForUnit(x, y, unit.id)) return false;
      if (x !== px && y !== py && (!this.entities.isFreeForUnit(x, py, unit.id) || !this.entities.isFreeForUnit(px, y, unit.id))) return false;
    }
    return true;
  }

  private blockedByAlly(unit: UnitEntity, path: Point[], start: number): boolean {
    const end = Math.min(path.length, start + Math.max(1, unit.movement) * 2 + 1);
    for (let i = start + 1; i < end; i++) {
      const [x, y] = path[i];
      const [px, py] = path[i - 1];
      for (const [cx, cy] of x !== px && y !== py ? [[x, y], [x, py], [px, y]] : [[x, y]]) {
        if (this.entities.isFreeForUnit(cx, cy, unit.id)) continue;
        const occupant = this.entities.atCell(cx, cy);
        return occupant?.category === 'unit' && occupant.team === unit.team;
      }
    }
    return false;
  }

  hasStaticPath(unit: UnitEntity, goal: Point): boolean {
    if (!this.entities.map.hasStaticConnection([unit.x, unit.y], goal)) return false;
    if (this.entities.map.isPassable(unit.x, unit.y)) return true;
    return findPath(this.entities.map, [unit.x, unit.y], goal, (x, y) => {
      if (!this.entities.map.isPassable(x, y)) return false;
      const b = this.entities.atCell(x, y);
      return !b || b.category !== 'building';
    }) !== null;
  }

  findNearestFreeNeighbor(targetX: number, targetY: number, unitId: string): Point | null {
    for (let r = 1; r <= 4; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = targetX + dx;
          const y = targetY + dy;
          if (this.entities.isFreeForUnit(x, y, unitId)) {
            return [x, y];
          }
        }
      }
    }
    return null;
  }
}
