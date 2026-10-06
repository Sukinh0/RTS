import { TICKS_PER_SECOND } from '../../config/runtime';
import { findPath } from '../../map/findPath';
import type { Point } from '../../map/MapGrid';
import type { MoveCommand, CommandResult } from '../commands/MoveCommand';
import { EntityStore, type UnitEntity } from '../entities/EntityStore';

export interface MovementEvent {
  unitId: string;
  path: Point[];
}

/** Executes one bounded movement action per available unit per cooldown cycle. */
export class MovementSystem {
  private readonly events: MovementEvent[] = [];

  constructor(private readonly entities: EntityStore) {}

  issue(command: MoveCommand, currentTick: number): CommandResult {
    const entity = this.entities.get(command.unitId);
    if (!entity || entity.category !== 'unit') return { accepted: false, reason: 'unknown-unit' };
    if (entity.team !== command.team) return { accepted: false, reason: 'wrong-owner' };
    if (currentTick < entity.cooldownUntilTick) return { accepted: false, reason: 'cooldown' };
    const [x, y] = command.destination;
    if (!this.entities.map.contains(x, y) || !this.entities.isFreeForUnit(x, y, entity.id)) {
      return { accepted: false, reason: 'invalid-destination' };
    }
    if (entity.x === x && entity.y === y) return { accepted: false, reason: 'already-there' };
    if (!this.pathFor(entity, command.destination)) return { accepted: false, reason: 'no-path' };
    entity.moveTarget = [x, y];
    return { accepted: true };
  }

  update(currentTick: number): number {
    let moved = 0;
    for (const entity of this.entities.all()) {
      if (entity.category !== 'unit' || !entity.moveTarget || currentTick < entity.cooldownUntilTick) continue;
      const path = this.pathFor(entity, entity.moveTarget);
      if (!path || path.length < 2) {
        entity.moveTarget = null;
        continue;
      }
      const steps = Math.min(entity.movement, path.length - 1);
      const [x, y] = path[steps];
      if (!this.entities.moveUnit(entity.id, x, y)) {
        entity.moveTarget = null;
        continue;
      }
      this.events.push({ unitId: entity.id, path: path.slice(0, steps + 1) });
      moved += 1;
      entity.cooldownUntilTick = currentTick + Math.round(entity.cooldownSeconds * TICKS_PER_SECOND);
      if (x === entity.moveTarget[0] && y === entity.moveTarget[1]) entity.moveTarget = null;
    }
    return moved;
  }

  drainEvents(): MovementEvent[] {
    return this.events.splice(0);
  }

  cooldownRemainingTicks(unit: UnitEntity, currentTick: number): number {
    return Math.max(0, unit.cooldownUntilTick - currentTick);
  }

  cancel(unitId: string): void {
    const entity = this.entities.get(unitId);
    if (entity && entity.category === 'unit') {
      entity.moveTarget = null;
    }
  }

  private pathFor(unit: UnitEntity, goal: Point): Point[] | null {
    return findPath(this.entities.map, [unit.x, unit.y], goal,
      (x, y) => this.entities.isFreeForUnit(x, y, unit.id));
  }
}
