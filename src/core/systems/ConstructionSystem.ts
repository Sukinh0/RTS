import { BALANCE } from '../../config/balance';
import { TICKS_PER_SECOND } from '../../config/runtime';
import { findPath } from '../../map/findPath';
import type { Point, Team } from '../../map/MapGrid';
import type { BuildCommand, BuildLineCommand, CommandFailureReason, CommandResult, RepairCommand } from '../commands/MoveCommand';
import { EntityStore, type BuildingEntity, type UnitEntity } from '../entities/EntityStore';
import type { TeamStock } from './EconomySystem';
import { FogOfWar } from './FogOfWar';
import { MovementSystem } from './MovementSystem';

export interface BuildTask {
  buildingId: string;
  builderId: string;
  phase: 'travel' | 'building' | 'repairing';
  targetCell: Point;
  woodAcc?: number;
  stoneAcc?: number;
  coinsAcc?: number;
}

export type LinePlanState =
  | 'PLANEJADA'
  | 'DESLOCANDO'
  | 'CONSTRUINDO'
  | 'PAUSADA'
  | 'CONCLUIDA'
  | 'CANCELADA';

export interface BarricadeLinePlan {
  id: string;
  ownerTeam: Team;
  builderId: string;
  cells: Point[];
  currentPieceIndex: number;
  committedWood: number;
  committedStone: number;
  spentWood: number;
  spentStone: number;
  reservedCells: Set<string>;
  completedPieces: number;
  state: LinePlanState;
  blockedReason?: string;
  activeBuildingId?: string;
}

export class ConstructionSystem {
  private readonly tasks = new Map<string, BuildTask>();
  private readonly linePlans = new Map<string, BarricadeLinePlan>();
  private readonly reservedCells = new Map<string, string>();
  private planSequence = 1;
  instantBuild = false;

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

  planFor(builderId: string): Readonly<BarricadeLinePlan> | null {
    const plan = this.linePlans.get(builderId);
    if (!plan) return null;
    return {
      ...plan,
      cells: plan.cells.map((p) => [...p] as Point),
      reservedCells: new Set(plan.reservedCells),
    };
  }

  isCellReserved(x: number, y: number): boolean {
    return this.reservedCells.has(`${x},${y}`);
  }

  getReservedBarricadeCount(team: Team): number {
    let count = 0;
    for (const plan of this.linePlans.values()) {
      if (plan.ownerTeam === team) {
        count += plan.reservedCells.size;
      }
    }
    return count;
  }

  cancel(entityId: string): void {
    this.tasks.delete(entityId);
    this.cancelLinePlan(entityId, 'cancelled');

    // Also check if entityId is an activeBuildingId of any plan
    for (const [builderId, plan] of this.linePlans) {
      if (plan.activeBuildingId === entityId) {
        this.cancelLinePlan(builderId, 'foundation-destroyed');
      }
    }
  }

  cancelLinePlan(builderId: string, reason?: string): void {
    const plan = this.linePlans.get(builderId);
    if (!plan || plan.state === 'CANCELADA' || plan.state === 'CONCLUIDA') return;
    plan.state = 'CANCELADA';
    plan.blockedReason = reason;

    // Release all reserved cells for this plan
    for (const key of plan.reservedCells) {
      if (this.reservedCells.get(key) === plan.id) {
        this.reservedCells.delete(key);
      }
    }
    plan.reservedCells.clear();

    // Clear task from worker
    this.tasks.delete(plan.builderId);

    // Calculate unstarted pieces refund
    // A piece is started only if an actual building entity was created for it
    const startedCount = plan.completedPieces + (plan.activeBuildingId ? 1 : 0);
    const unstartedCount = Math.max(0, plan.cells.length - startedCount);
    const config = BALANCE.buildings.barricade;
    const refundWood = unstartedCount * config.wood;
    const refundStone = unstartedCount * (config.stone ?? 0);

    if (refundWood > 0 || refundStone > 0) {
      const stock = this.stocks[plan.ownerTeam];
      stock.wood += refundWood;
      stock.stone += refundStone;
    }

    this.linePlans.delete(builderId);
  }

  issue(command: BuildCommand, currentTick: number): CommandResult {
    const builder = this.entities.get(command.builderId);
    if (!builder || builder.category !== 'unit') return { accepted: false, reason: 'unknown-unit' };
    if (builder.team !== command.team) return { accepted: false, reason: 'wrong-owner' };
    if (builder.kind !== 'worker' && builder.kind !== 'builder') return { accepted: false, reason: 'not-worker' };
    if ((command.buildingKind === 'barricade' || command.buildingKind === 'tower') && builder.kind !== 'builder') {
      return { accepted: false, reason: 'not-builder' };
    }
    if (currentTick < builder.cooldownUntilTick) return { accepted: false, reason: 'cooldown' };

    if (command.buildingKind !== 'house' && command.buildingKind !== 'barracks' && command.buildingKind !== 'barricade' && command.buildingKind !== 'tower') {
      return { accepted: false, reason: 'invalid-unit-kind' };
    }

    const [bx, by] = command.position;
    const config = BALANCE.buildings[command.buildingKind];
    const width = config.width;
    const height = config.height;

    const maxPerTeam = (config as { maxPerTeam?: number }).maxPerTeam;
    if (maxPerTeam !== undefined) {
      const currentCount = this.entities.all().filter((e) => e.category === 'building'
        && e.team === command.team && e.kind === command.buildingKind).length;
      const reservedCount = command.buildingKind === 'barricade' ? this.getReservedBarricadeCount(command.team) : 0;
      if (currentCount + reservedCount >= maxPerTeam) {
        return { accepted: false, reason: 'building-limit-reached' };
      }
    }

    if (!this.entities.map.contains(bx, by) || !this.entities.map.contains(bx + width - 1, by + height - 1)) {
      return { accepted: false, reason: 'invalid-position' };
    }

    const base = this.entities.get(`${command.team}-base`);
    if (!base || base.category !== 'building') return { accepted: false, reason: 'invalid-position' };
    const baseCenterX = base.x + (base.width - 1) / 2;
    const baseCenterY = base.y + (base.height - 1) / 2;
    const buildCenterX = bx + (width - 1) / 2;
    const buildCenterY = by + (height - 1) / 2;
    if (Math.hypot(buildCenterX - baseCenterX, buildCenterY - baseCenterY)
      > BALANCE.construction.maxDistanceFromBase) {
      return { accepted: false, reason: 'out-of-build-range' };
    }

    for (let y = by; y < by + height; y += 1) {
      for (let x = bx; x < bx + width; x += 1) {
        if (this.fog.stateAt(command.team, x, y) === 'unknown') {
          return { accepted: false, reason: 'unexplored' };
        }
        if (this.isCellReserved(x, y)) {
          return { accepted: false, reason: 'blocked' };
        }
      }
    }

    const stoneCost = (config as { stone?: number }).stone ?? 0;
    const stock = this.stocks[command.team];
    if (stock.coins < config.coins) return { accepted: false, reason: 'insufficient-coins' };
    if (stock.wood < config.wood) return { accepted: false, reason: 'insufficient-wood' };
    if (stock.stone < stoneCost) return { accepted: false, reason: 'insufficient-stone' };

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
    stock.stone -= stoneCost;

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
        stock.stone += stoneCost;
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

  validateBuildLine(
    command: BuildLineCommand,
    currentTick: number,
  ): { valid: boolean; reason?: CommandFailureReason } {
    const builder = this.entities.get(command.builderId);
    if (!builder || builder.category !== 'unit') return { valid: false, reason: 'unknown-unit' };
    if (builder.team !== command.team) return { valid: false, reason: 'wrong-owner' };
    if (builder.kind !== 'builder') return { valid: false, reason: 'not-builder' };
    if (currentTick < builder.cooldownUntilTick) return { valid: false, reason: 'cooldown' };

    const { cells } = command;
    if (!cells || cells.length === 0) return { valid: false, reason: 'invalid-destination' };

    const config = BALANCE.buildings.barricade;
    const maxPerTeam = config.maxPerTeam ?? 100;
    const existingCount = this.entities.all().filter((e) =>
      e.category === 'building' && e.team === command.team && e.kind === 'barricade',
    ).length;
    const reservedCount = this.getReservedBarricadeCount(command.team);

    if (existingCount + reservedCount + cells.length > maxPerTeam) {
      return { valid: false, reason: 'building-limit-reached' };
    }

    const base = this.entities.get(`${command.team}-base`);
    if (!base || base.category !== 'building') return { valid: false, reason: 'invalid-position' };
    const baseCenterX = base.x + (base.width - 1) / 2;
    const baseCenterY = base.y + (base.height - 1) / 2;

    for (const [cx, cy] of cells) {
      if (!this.entities.map.contains(cx, cy)) {
        return { valid: false, reason: 'invalid-position' };
      }

      if (Math.hypot(cx - baseCenterX, cy - baseCenterY) > BALANCE.construction.maxDistanceFromBase) {
        return { valid: false, reason: 'out-of-build-range' };
      }

      if (this.fog.stateAt(command.team, cx, cy) === 'unknown') {
        return { valid: false, reason: 'unexplored' };
      }

      const cell = this.entities.map.cellAt(cx, cy);
      if (!cell || cell.terrain !== 'plain' || cell.structureTeam !== null) {
        return { valid: false, reason: 'blocked' };
      }

      const existingEntity = this.entities.atCell(cx, cy);
      if (existingEntity && existingEntity.category === 'building') {
        return { valid: false, reason: 'blocked' };
      }

      if (this.isCellReserved(cx, cy)) {
        return { valid: false, reason: 'blocked' };
      }
    }

    const woodNeeded = cells.length * config.wood;
    const stoneNeeded = cells.length * (config.stone ?? 0);
    const stock = this.stocks[command.team];

    if (stock.wood < woodNeeded) return { valid: false, reason: 'insufficient-wood' };
    if (stock.stone < stoneNeeded) return { valid: false, reason: 'insufficient-stone' };

    // Initial accessibility check
    const first = cells[0];
    const last = cells[cells.length - 1];
    const perimFirst = this.getBestPerimeterCells(builder, first);
    const perimLast = this.getBestPerimeterCells(builder, last);

    if (perimFirst.length === 0 && perimLast.length === 0) {
      return { valid: false, reason: 'no-path' };
    }

    const canEnter = (x: number, y: number) => this.entities.isFreeForUnit(x, y, builder.id);
    const reachable = (perim: Point[]) => perim.some((p) => {
      if (builder.x === p[0] && builder.y === p[1]) return true;
      return findPath(this.entities.map, [builder.x, builder.y], p, canEnter) !== null;
    });

    if (!reachable(perimFirst) && !reachable(perimLast)) {
      return { valid: false, reason: 'no-path' };
    }

    return { valid: true };
  }

  issueBuildLine(command: BuildLineCommand, currentTick: number): CommandResult {
    const validation = this.validateBuildLine(command, currentTick);
    if (!validation.valid) {
      return { accepted: false, reason: validation.reason ?? 'invalid-position' };
    }

    const builder = this.entities.get(command.builderId) as UnitEntity;
    const { cells } = command;
    const config = BALANCE.buildings.barricade;
    const woodCost = cells.length * config.wood;
    const stoneCost = cells.length * (config.stone ?? 0);
    const stock = this.stocks[command.team];

    // Atomic upfront resource reservation
    stock.wood -= woodCost;
    stock.stone -= stoneCost;

    // Evaluate accessibility and direction
    const orderedCells = this.chooseOptimalLineDirection(builder, cells);

    const planId = `plan-${command.team}-${builder.id}-${this.planSequence++}`;
    const reservedCellsSet = new Set<string>();

    for (const [x, y] of orderedCells) {
      const key = `${x},${y}`;
      this.reservedCells.set(key, planId);
      reservedCellsSet.add(key);
    }

    const plan: BarricadeLinePlan = {
      id: planId,
      ownerTeam: command.team,
      builderId: builder.id,
      cells: orderedCells,
      currentPieceIndex: 0,
      committedWood: woodCost,
      committedStone: stoneCost,
      spentWood: 0,
      spentStone: 0,
      reservedCells: reservedCellsSet,
      completedPieces: 0,
      state: 'PLANEJADA',
    };

    this.linePlans.set(builder.id, plan);

    // Start piece 0
    const started = this.advancePlanToCurrentPiece(plan, currentTick);
    if (!started) {
      this.cancelLinePlan(builder.id, 'no-path');
      return { accepted: false, reason: 'no-path' };
    }

    return { accepted: true };
  }

  chooseOptimalLineDirection(builder: UnitEntity, cells: Point[]): Point[] {
    if (cells.length <= 1) return cells;

    const first = cells[0];
    const last = cells[cells.length - 1];

    const perimFirst = this.getBestPerimeterCells(builder, first);
    const perimLast = this.getBestPerimeterCells(builder, last);

    const canEnter = (x: number, y: number) => this.entities.isFreeForUnit(x, y, builder.id);

    const pathFirst = perimFirst.length > 0 && perimFirst.some((p) => {
      if (builder.x === p[0] && builder.y === p[1]) return true;
      return findPath(this.entities.map, [builder.x, builder.y], p, canEnter) !== null;
    });

    const pathLast = perimLast.length > 0 && perimLast.some((p) => {
      if (builder.x === p[0] && builder.y === p[1]) return true;
      return findPath(this.entities.map, [builder.x, builder.y], p, canEnter) !== null;
    });

    if (pathFirst && !pathLast) return cells;
    if (pathLast && !pathFirst) return [...cells].reverse();

    // Check corridor / cut-off: if building from first would cut off access to last
    const canEnterWithoutFirst = (x: number, y: number) =>
      !(x === first[0] && y === first[1]) && canEnter(x, y);
    const canEnterWithoutLast = (x: number, y: number) =>
      !(x === last[0] && y === last[1]) && canEnter(x, y);

    const canReachLastWithoutFirst = perimLast.some((p) => {
      if (builder.x === p[0] && builder.y === p[1]) return true;
      return findPath(this.entities.map, [builder.x, builder.y], p, canEnterWithoutFirst) !== null;
    });
    const canReachFirstWithoutLast = perimFirst.some((p) => {
      if (builder.x === p[0] && builder.y === p[1]) return true;
      return findPath(this.entities.map, [builder.x, builder.y], p, canEnterWithoutLast) !== null;
    });

    if (!canReachLastWithoutFirst && canReachFirstWithoutLast) {
      return [...cells].reverse();
    }
    if (!canReachFirstWithoutLast && canReachLastWithoutFirst) {
      return cells;
    }

    const adjFirst = this.isAdjacentToCell(builder, first);
    const adjLast = this.isAdjacentToCell(builder, last);
    if (adjFirst && !adjLast) return cells;
    if (adjLast && !adjFirst) return [...cells].reverse();

    // Default: choose end closest to builder
    const distFirst = Math.min(...perimFirst.map((p) => this.distanceSquared(builder, p)), Infinity);
    const distLast = Math.min(...perimLast.map((p) => this.distanceSquared(builder, p)), Infinity);

    if (distLast < distFirst) {
      return [...cells].reverse();
    }
    return cells;
  }

  private advancePlanToCurrentPiece(plan: BarricadeLinePlan, currentTick: number): boolean {
    if (plan.currentPieceIndex >= plan.cells.length) {
      plan.state = 'CONCLUIDA';
      this.tasks.delete(plan.builderId);
      this.linePlans.delete(plan.builderId);
      return true;
    }

    const builder = this.entities.get(plan.builderId);
    if (!builder || builder.category !== 'unit' || builder.hp <= 0) {
      this.cancelLinePlan(plan.builderId, 'builder-dead');
      return false;
    }

    const targetPiece = plan.cells[plan.currentPieceIndex];

    const cell = this.entities.map.cellAt(targetPiece[0], targetPiece[1]);
    if (!cell || cell.terrain !== 'plain' || cell.structureTeam !== null) {
      this.cancelLinePlan(plan.builderId, 'blocked');
      return false;
    }
    const existing = this.entities.atCell(targetPiece[0], targetPiece[1]);
    if (existing && existing.category === 'building') {
      this.cancelLinePlan(plan.builderId, 'blocked');
      return false;
    }

    if (this.isAdjacentToCell(builder, targetPiece)) {
      const building = this.entities.createBuilding(plan.ownerTeam, 'barricade', targetPiece[0], targetPiece[1], true);
      const cellKey = `${targetPiece[0]},${targetPiece[1]}`;
      this.reservedCells.delete(cellKey);
      plan.reservedCells.delete(cellKey);

      plan.activeBuildingId = building.id;
      plan.spentWood += BALANCE.buildings.barricade.wood;
      plan.spentStone += BALANCE.buildings.barricade.stone ?? 0;
      plan.state = 'CONSTRUINDO';

      builder.moveTarget = null;
      builder.cooldownUntilTick = currentTick + Math.round(builder.cooldownSeconds * TICKS_PER_SECOND);

      this.tasks.set(builder.id, {
        buildingId: building.id,
        builderId: builder.id,
        phase: 'building',
        targetCell: [builder.x, builder.y],
      });
      return true;
    }

    // Need to travel to target piece perimeter
    plan.state = 'DESLOCANDO';
    const perim = this.getBestPerimeterCells(builder, targetPiece, plan);
    if (perim.length === 0) {
      this.cancelLinePlan(plan.builderId, 'no-path');
      return false;
    }

    const targetCell = perim[0];
    if (currentTick >= builder.cooldownUntilTick) {
      const moveRes = this.movement.issue({
        type: 'move',
        team: builder.team,
        unitId: builder.id,
        destination: targetCell,
      }, currentTick);

      if (!moveRes.accepted && moveRes.reason !== 'cooldown') {
        this.cancelLinePlan(plan.builderId, 'no-path');
        return false;
      }
    }

    this.tasks.set(builder.id, {
      buildingId: '',
      builderId: builder.id,
      phase: 'travel',
      targetCell,
    });
    return true;
  }

  issueRepair(command: RepairCommand, currentTick: number): CommandResult {
    const builder = this.entities.get(command.builderId);
    if (!builder || builder.category !== 'unit') return { accepted: false, reason: 'unknown-unit' };
    if (builder.team !== command.team) return { accepted: false, reason: 'wrong-owner' };
    if (builder.kind !== 'builder') return { accepted: false, reason: 'not-builder' };

    const building = this.entities.get(command.buildingId);
    if (!building || building.category !== 'building') return { accepted: false, reason: 'unknown-building' };
    if (building.team !== command.team) return { accepted: false, reason: 'wrong-owner' };
    if (building.underConstruction) return { accepted: false, reason: 'under-construction' };
    if (building.hp >= building.maxHp) return { accepted: false, reason: 'building-at-max-hp' };

    if (currentTick < builder.cooldownUntilTick) return { accepted: false, reason: 'cooldown' };

    const config = BALANCE.buildings[building.kind];
    const costConfig = (config as { repairCostPerSecond?: { wood?: number; stone?: number; coins?: number } }).repairCostPerSecond;
    const woodRate = costConfig?.wood ?? 0;
    const stoneRate = costConfig?.stone ?? 0;
    const coinsRate = costConfig?.coins ?? 0;
    const stock = this.stocks[command.team];
    if (woodRate > 0 && stock.wood < 1) {
      return { accepted: false, reason: 'insufficient-wood' };
    }
    if (stoneRate > 0 && stock.stone < 1) {
      return { accepted: false, reason: 'insufficient-stone' };
    }
    if (coinsRate > 0 && stock.coins < 1) {
      return { accepted: false, reason: 'insufficient-coins' };
    }

    const isAlreadyAdjacent = this.isAdjacent(builder, building);
    if (isAlreadyAdjacent) {
      builder.moveTarget = null;
      builder.cooldownUntilTick = currentTick + Math.round(builder.cooldownSeconds * TICKS_PER_SECOND);
      this.tasks.set(builder.id, {
        buildingId: building.id,
        builderId: builder.id,
        phase: 'repairing',
        targetCell: [builder.x, builder.y],
        woodAcc: 0,
        stoneAcc: 0,
        coinsAcc: 0,
      });
      return { accepted: true };
    }

    const perimeterCells = this.perimeterFor(building.x, building.y, building.width, building.height)
      .filter(([x, y]) => this.entities.isFreeForUnit(x, y, builder.id))
      .sort((a, b) => this.distanceSquared(builder, a) - this.distanceSquared(builder, b));

    if (perimeterCells.length === 0) {
      return { accepted: false, reason: 'no-path' };
    }

    const targetCell = perimeterCells[0];
    const moveResult = this.movement.issue(
      { type: 'move', team: builder.team, unitId: builder.id, destination: targetCell },
      currentTick,
    );
    if (!moveResult.accepted) {
      return { accepted: false, reason: 'no-path' };
    }

    this.tasks.set(builder.id, {
      buildingId: building.id,
      builderId: builder.id,
      phase: 'travel',
      targetCell,
      woodAcc: 0,
      stoneAcc: 0,
      coinsAcc: 0,
    });
    return { accepted: true };
  }

  isBeingRepaired(buildingId: string): boolean {
    for (const task of this.tasks.values()) {
      if (task.buildingId === buildingId && task.phase === 'repairing') return true;
    }
    return false;
  }

  update(currentTick: number): void {
    // 1. Update single tasks (ignoring workers executing line plans)
    for (const [builderId, task] of this.tasks) {
      if (this.linePlans.has(builderId)) continue;
      const builder = this.entities.get(builderId);
      const building = this.entities.get(task.buildingId);
      if (!builder || builder.category !== 'unit' || builder.hp <= 0) {
        this.tasks.delete(builderId);
        continue;
      }
      if (!building || building.category !== 'building' || building.hp <= 0) {
        this.tasks.delete(builderId);
        builder.moveTarget = null;
        continue;
      }

      if (task.phase === 'travel') {
        if (this.isAdjacent(builder, building)) {
          task.phase = building.underConstruction ? 'building' : 'repairing';
          if (task.phase === 'repairing') {
            task.woodAcc = 0;
            task.stoneAcc = 0;
            task.coinsAcc = 0;
          }
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

        building.buildProgressTicks += this.instantBuild ? building.buildTotalTicks : 1;
        building.hp = Math.max(1, Math.floor((building.buildProgressTicks / building.buildTotalTicks) * building.maxHp));

        if (building.buildProgressTicks >= building.buildTotalTicks) {
          building.underConstruction = false;
          building.hp = building.maxHp;
          this.tasks.delete(builder.id);
          builder.cooldownUntilTick = currentTick + Math.round(builder.cooldownSeconds * TICKS_PER_SECOND);
          this.fog.update();
        }
      }

      if (task.phase === 'repairing') {
        if (!this.isAdjacent(builder, building)) {
          task.phase = 'travel';
          continue;
        }

        if (building.hp >= building.maxHp) {
          building.hp = building.maxHp;
          this.tasks.delete(builder.id);
          builder.cooldownUntilTick = currentTick + Math.round(builder.cooldownSeconds * TICKS_PER_SECOND);
          continue;
        }

        const config = BALANCE.buildings[building.kind];
        const repairRate = (config as { repairRateHpPerSecond?: number }).repairRateHpPerSecond ?? 4;
        const hpPerTick = repairRate / TICKS_PER_SECOND;
        const costConfig = (config as { repairCostPerSecond?: { wood?: number; stone?: number; coins?: number } }).repairCostPerSecond;
        const stock = this.stocks[building.team];
        const woodRate = costConfig?.wood ?? 0;
        const stoneRate = costConfig?.stone ?? 0;
        const coinsRate = costConfig?.coins ?? 0;

        task.woodAcc = (task.woodAcc ?? 0) + woodRate;
        task.stoneAcc = (task.stoneAcc ?? 0) + stoneRate;
        task.coinsAcc = (task.coinsAcc ?? 0) + coinsRate;

        const woodNeeded = Math.floor(task.woodAcc / TICKS_PER_SECOND);
        const stoneNeeded = Math.floor(task.stoneAcc / TICKS_PER_SECOND);
        const coinsNeeded = Math.floor(task.coinsAcc / TICKS_PER_SECOND);

        if (
          (woodRate > 0 && stock.wood < Math.max(1, woodNeeded))
          || (stoneRate > 0 && stock.stone < Math.max(1, stoneNeeded))
          || (coinsRate > 0 && stock.coins < Math.max(1, coinsNeeded))
        ) {
          this.tasks.delete(builder.id);
          builder.cooldownUntilTick = currentTick + Math.round(builder.cooldownSeconds * TICKS_PER_SECOND);
          continue;
        }

        if (woodNeeded > 0) {
          stock.wood = Math.max(0, stock.wood - woodNeeded);
          task.woodAcc -= woodNeeded * TICKS_PER_SECOND;
        }
        if (stoneNeeded > 0) {
          stock.stone = Math.max(0, stock.stone - stoneNeeded);
          task.stoneAcc -= stoneNeeded * TICKS_PER_SECOND;
        }
        if (coinsNeeded > 0) {
          stock.coins = Math.max(0, stock.coins - coinsNeeded);
          task.coinsAcc -= coinsNeeded * TICKS_PER_SECOND;
        }

        building.hp = Math.min(building.maxHp, building.hp + hpPerTick);
        if (building.hp >= building.maxHp) {
          building.hp = building.maxHp;
          this.tasks.delete(builder.id);
          builder.cooldownUntilTick = currentTick + Math.round(builder.cooldownSeconds * TICKS_PER_SECOND);
        }
      }
    }

    // 2. Update multi-piece barricade line plans
    for (const [builderId, plan] of this.linePlans) {
      this.updateLinePlan(builderId, plan, currentTick);
    }
  }

  private updateLinePlan(builderId: string, plan: BarricadeLinePlan, currentTick: number): void {
    if (plan.state === 'CONCLUIDA' || plan.state === 'CANCELADA') {
      this.linePlans.delete(builderId);
      return;
    }

    const builder = this.entities.get(builderId);
    if (!builder || builder.category !== 'unit' || builder.hp <= 0) {
      this.cancelLinePlan(builderId, 'builder-dead');
      return;
    }

    if (plan.currentPieceIndex >= plan.cells.length) {
      plan.state = 'CONCLUIDA';
      this.tasks.delete(builderId);
      this.linePlans.delete(builderId);
      return;
    }

    const targetPiece = plan.cells[plan.currentPieceIndex];

    if (plan.state === 'DESLOCANDO') {
      if (this.isAdjacentToCell(builder, targetPiece)) {
        this.advancePlanToCurrentPiece(plan, currentTick);
      } else if (!builder.moveTarget && currentTick >= builder.cooldownUntilTick) {
        const perim = this.getBestPerimeterCells(builder, targetPiece, plan);
        if (perim.length > 0) {
          const moveRes = this.movement.issue(
            { type: 'move', team: builder.team, unitId: builder.id, destination: perim[0] },
            currentTick,
          );
          if (!moveRes.accepted && moveRes.reason !== 'cooldown') {
            this.cancelLinePlan(builderId, 'no-path');
          }
        } else {
          this.cancelLinePlan(builderId, 'no-path');
        }
      }
      return;
    }

    if (plan.state === 'CONSTRUINDO') {
      const building = plan.activeBuildingId ? this.entities.get(plan.activeBuildingId) : undefined;
      if (!building || building.category !== 'building' || building.hp <= 0) {
        this.cancelLinePlan(builderId, 'foundation-destroyed');
        builder.moveTarget = null;
        return;
      }

      if (!this.isAdjacentToCell(builder, targetPiece)) {
        plan.state = 'DESLOCANDO';
        return;
      }

      building.buildProgressTicks += this.instantBuild ? building.buildTotalTicks : 1;
      building.hp = Math.max(1, Math.floor((building.buildProgressTicks / building.buildTotalTicks) * building.maxHp));

      if (building.buildProgressTicks >= building.buildTotalTicks) {
        building.underConstruction = false;
        building.hp = building.maxHp;
        this.tasks.delete(builder.id);
        plan.activeBuildingId = undefined;
        plan.completedPieces += 1;
        plan.currentPieceIndex += 1;
        builder.cooldownUntilTick = currentTick + Math.round(builder.cooldownSeconds * TICKS_PER_SECOND);
        this.fog.update();

        if (plan.currentPieceIndex >= plan.cells.length) {
          plan.state = 'CONCLUIDA';
          this.linePlans.delete(builderId);
          return;
        }

        this.advancePlanToCurrentPiece(plan, currentTick);
      }
    }
  }

  getBestPerimeterCells(builder: UnitEntity, targetCell: Point, plan?: BarricadeLinePlan): Point[] {
    const [bx, by] = targetCell;
    const isLineCell = (p: Point) => plan?.cells.some((c) => c[0] === p[0] && c[1] === p[1]) ?? false;

    return this.perimeterFor(bx, by, 1, 1)
      .filter(([x, y]) => this.entities.isFreeForUnit(x, y, builder.id))
      .sort((a, b) => {
        const aLine = isLineCell(a) ? 1 : 0;
        const bLine = isLineCell(b) ? 1 : 0;
        if (aLine !== bLine) return aLine - bLine;
        return this.distanceSquared(builder, a) - this.distanceSquared(builder, b);
      });
  }

  isAdjacentToCell(unit: UnitEntity, cell: Point): boolean {
    const dx = Math.abs(unit.x - cell[0]);
    const dy = Math.abs(unit.y - cell[1]);
    return (dx <= 1 && dy <= 1) && !(dx === 0 && dy === 0);
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
