import { BALANCE } from '../../config/balance';
import { TICKS_PER_SECOND } from '../../config/runtime';
import type { Point } from '../../map/MapGrid';
import type { BuildCommand, CommandResult } from '../commands/MoveCommand';
import { EntityStore, type BuildingEntity, type UnitEntity } from '../entities/EntityStore';
import type { TeamStock } from './EconomySystem';
import { FogOfWar } from './FogOfWar';
import { MovementSystem } from './MovementSystem';

export interface BuildTask {
  buildingId: string;
  builderId: string;
  phase: 'travel' | 'building';
  targetCell: Point;
}

export class ConstructionSystem {
  private readonly tasks = new Map<string, BuildTask>();

  constructor(
    private readonly entities: EntityStore,
    private readonly movement: MovementSystem,
    private readonly fog: FogOfWar,
    private readonly stocks: TeamStock,
  ) {}

  taskFor(builderId: string): Readonly<BuildTask> | null {
    const task = this.tasks.get(builderId);
    return task ? { ...task, targetCell: [...task.targetCell] as Point } : null;
  }

  cancel(builderId: string): void {
    this.tasks.delete(builderId);
  }

  issue(command: BuildCommand, currentTick: number): CommandResult {
    const builder = this.entities.get(command.builderId);
    if (!builder || builder.category !== 'unit') return { accepted: false, reason: 'unknown-unit' };
    if (builder.team !== command.team) return { accepted: false, reason: 'wrong-owner' };
    if (builder.kind !== 'worker') return { accepted: false, reason: 'not-worker' };
    if (currentTick < builder.cooldownUntilTick) return { accepted: false, reason: 'cooldown' };

    if (command.buildingKind !== 'house' && command.buildingKind !== 'barracks') {
      return { accepted: false, reason: 'invalid-unit-kind' };
    }

    const [bx, by] = command.position;
    const config = BALANCE.buildings[command.buildingKind];
    const width = config.width;
    const height = config.height;

    if (!this.entities.map.contains(bx, by) || !this.entities.map.contains(bx + width - 1, by + height - 1)) {
      return { accepted: false, reason: 'invalid-position' };
    }

    for (let y = by; y < by + height; y += 1) {
      for (let x = bx; x < bx + width; x += 1) {
        if (this.fog.stateAt(command.team, x, y) === 'unknown') {
          return { accepted: false, reason: 'unexplored' };
        }
      }
    }

    const stock = this.stocks[command.team];
    if (stock.coins < config.coins) return { accepted: false, reason: 'insufficient-coins' };
    if (stock.wood < config.wood) return { accepted: false, reason: 'insufficient-wood' };

    if (!this.entities.isAreaFreeForBuilding(bx, by, width, height)) {
      return { accepted: false, reason: 'blocked' };
    }

    const perimeterCells = this.perimeterFor(bx, by, width, height)
      .filter(([x, y]) => this.entities.isFreeForUnit(x, y, builder.id))
      .sort((a, b) => this.distanceSquared(builder, a) - this.distanceSquared(builder, b));

    if (perimeterCells.length === 0) {
      return { accepted: false, reason: 'no-path' };
    }

    const targetCell = perimeterCells[0];

    stock.coins -= config.coins;
    stock.wood -= config.wood;

    this.entities.map.occupyStructure(bx, by, width, height, command.team);
    const building = this.entities.createBuilding(command.team, command.buildingKind, bx, by, true);

    const isAlreadyAdjacent = this.isAdjacent(builder, building);
    if (isAlreadyAdjacent) {
      builder.moveTarget = null;
      builder.cooldownUntilTick = currentTick + Math.round(builder.cooldownSeconds * TICKS_PER_SECOND);
      this.tasks.set(builder.id, {
        buildingId: building.id,
        builderId: builder.id,
        phase: 'building',
        targetCell: [builder.x, builder.y],
      });
    } else {
      const moveResult = this.movement.issue(
        { type: 'move', team: builder.team, unitId: builder.id, destination: targetCell },
        currentTick,
      );
      if (!moveResult.accepted) {
        stock.coins += config.coins;
        stock.wood += config.wood;
        this.entities.remove(building.id);
        return { accepted: false, reason: 'no-path' };
      }
      this.tasks.set(builder.id, {
        buildingId: building.id,
        builderId: builder.id,
        phase: 'travel',
        targetCell,
      });
    }

    return { accepted: true };
  }

  update(currentTick: number): void {
    for (const [builderId, task] of this.tasks) {
      const builder = this.entities.get(builderId);
      const building = this.entities.get(task.buildingId);
      if (!builder || builder.category !== 'unit' || builder.hp <= 0 ||
          !building || building.category !== 'building' || building.hp <= 0) {
        this.tasks.delete(builderId);
        continue;
      }

      if (task.phase === 'travel') {
        if (this.isAdjacent(builder, building)) {
          task.phase = 'building';
          builder.moveTarget = null;
          builder.cooldownUntilTick = currentTick + Math.round(builder.cooldownSeconds * TICKS_PER_SECOND);
        } else if (!builder.moveTarget && currentTick >= builder.cooldownUntilTick) {
          const cell = this.perimeterFor(building.x, building.y, building.width, building.height)
            .filter(([x, y]) => this.entities.isFreeForUnit(x, y, builder.id))
            .sort((a, b) => this.distanceSquared(builder, a) - this.distanceSquared(builder, b))[0];
          if (cell) {
            task.targetCell = cell;
            this.movement.issue({ type: 'move', team: builder.team, unitId: builder.id, destination: cell }, currentTick);
          }
        }
      }

      if (task.phase === 'building') {
        if (!this.isAdjacent(builder, building)) {
          task.phase = 'travel';
          continue;
        }

        building.buildProgressTicks += 1;
        building.hp = Math.max(1, Math.floor((building.buildProgressTicks / building.buildTotalTicks) * building.maxHp));

        if (building.buildProgressTicks >= building.buildTotalTicks) {
          building.underConstruction = false;
          building.hp = building.maxHp;
          this.tasks.delete(builder.id);
          builder.cooldownUntilTick = currentTick + Math.round(builder.cooldownSeconds * TICKS_PER_SECOND);
          this.fog.update();
        }
      }
    }
  }

  private perimeterFor(bx: number, by: number, width: number, height: number): Point[] {
    const cells: Point[] = [];
    for (let y = by - 1; y <= by + height; y += 1) {
      for (let x = bx - 1; x <= bx + width; x += 1) {
        if (x >= bx && x < bx + width && y >= by && y < by + height) continue;
        if (this.entities.map.contains(x, y)) cells.push([x, y]);
      }
    }
    return cells;
  }

  private isAdjacent(worker: UnitEntity, building: BuildingEntity): boolean {
    const minX = building.x - 1;
    const maxX = building.x + building.width;
    const minY = building.y - 1;
    const maxY = building.y + building.height;
    return worker.x >= minX && worker.x <= maxX && worker.y >= minY && worker.y <= maxY
      && !(worker.x >= building.x && worker.x < building.x + building.width && worker.y >= building.y && worker.y < building.y + building.height);
  }

  private distanceSquared(unit: UnitEntity, point: Point): number {
    return (unit.x - point[0]) ** 2 + (unit.y - point[1]) ** 2;
  }
}
