import { BALANCE } from '../../config/balance';
import { TICKS_PER_SECOND } from '../../config/runtime';
import type { Point, Team } from '../../map/MapGrid';
import type { CommandResult, WorkCommand } from '../commands/MoveCommand';
import { EntityStore, type BuildingEntity, type UnitEntity } from '../entities/EntityStore';
import { FogOfWar } from './FogOfWar';
import { MovementSystem } from './MovementSystem';

export type TeamStock = Record<Team, { coins: number; wood: number }>;

interface MineTask {
  kind: 'mine';
  source: Point;
  workCell: Point;
  phase: 'travel' | 'working';
  progressTicks: number;
}

interface GatherTask {
  kind: 'gather';
  source: Point;
  workCell: Point;
  depot: Point | null;
  phase: 'toForest' | 'gathering' | 'toBase';
  progressTicks: number;
}

export type WorkerTask = MineTask | GatherTask;

/** Passive income, mine cycles and the forest-to-base hauling loop. */
export class EconomySystem {
  private readonly tasks = new Map<string, WorkerTask>();

  constructor(
    private readonly entities: EntityStore,
    private readonly movement: MovementSystem,
    private readonly fog: FogOfWar,
    private readonly stocks: TeamStock,
  ) {}

  taskFor(unitId: string): Readonly<WorkerTask> | null {
    const task = this.tasks.get(unitId);
    return task ? { ...task, source: [...task.source] as Point, workCell: [...task.workCell] as Point } : null;
  }

  cancel(unitId: string): void {
    this.tasks.delete(unitId);
  }

  issue(command: WorkCommand, currentTick: number): CommandResult {
    const worker = this.entities.get(command.unitId);
    if (!worker || worker.category !== 'unit') return { accepted: false, reason: 'unknown-unit' };
    if (worker.team !== command.team) return { accepted: false, reason: 'wrong-owner' };
    if (worker.kind !== 'worker') return { accepted: false, reason: 'not-worker' };
    if (currentTick < worker.cooldownUntilTick) return { accepted: false, reason: 'cooldown' };
    const [x, y] = command.target;
    if (this.fog.stateAt(command.team, x, y) === 'unknown') return { accepted: false, reason: 'invalid-destination' };
    const terrain = this.entities.map.cellAt(x, y)?.terrain;
    if (terrain !== (command.type === 'mine' ? 'mine' : 'forest')) return { accepted: false, reason: 'wrong-terrain' };
    if (command.type === 'mine') {
      const assigned = [...this.tasks.entries()].filter(([id, task]) => id !== worker.id && task.kind === 'mine'
        && task.source[0] === x && task.source[1] === y).length;
      if (assigned >= BALANCE.economy.mine.maxWorkersPerMine) return { accepted: false, reason: 'mine-full' };
    }

    const workCell = this.assignWorkCell(worker, command.type, command.target, currentTick);
    if (!workCell) return { accepted: false, reason: 'no-path' };
    this.tasks.set(worker.id, command.type === 'mine'
      ? { kind: 'mine', source: command.target, workCell, phase: 'travel', progressTicks: 0 }
      : { kind: 'gather', source: command.target, workCell, depot: null, phase: 'toForest', progressTicks: 0 });
    return { accepted: true };
  }

  update(currentTick: number): void {
    for (const [unitId, task] of this.tasks) {
      const entity = this.entities.get(unitId);
      if (!entity || entity.category !== 'unit' || entity.hp <= 0) {
        this.tasks.delete(unitId);
        continue;
      }
      if (task.kind === 'mine') this.updateMine(entity, task, currentTick);
      else this.updateGather(entity, task, currentTick);
    }

    if (currentTick % TICKS_PER_SECOND === 0) {
      for (const entity of this.entities.all()) {
        if (entity.category === 'unit' && entity.kind === 'worker'
          && !this.tasks.has(entity.id) && !entity.moveTarget && entity.hp > 0) {
          this.stocks[entity.team].coins += BALANCE.economy.passiveCoinsPerFreeWorkerPerSecond;
        }
      }
    }
  }

  private updateMine(worker: UnitEntity, task: MineTask, tick: number): void {
    if (!this.at(worker, task.workCell)) {
      if (task.phase === 'working') this.tasks.delete(worker.id);
      return;
    }
    if (task.phase === 'travel') {
      if (tick < worker.cooldownUntilTick) return;
      task.phase = 'working';
      worker.cooldownUntilTick = tick + Math.round(worker.cooldownSeconds * TICKS_PER_SECOND);
    }
    task.progressTicks += 1;
    if (task.progressTicks >= BALANCE.economy.mine.cycleSeconds * TICKS_PER_SECOND) {
      this.stocks[worker.team].coins += BALANCE.economy.mine.coinsPerCycle;
      task.progressTicks = 0;
    }
  }

  private updateGather(worker: UnitEntity, task: GatherTask, tick: number): void {
    if (task.phase === 'toForest') {
      if (!this.at(worker, task.workCell)) {
        if (this.entities.map.cellAt(task.workCell[0], task.workCell[1])?.terrain !== 'forest') {
          this.sendToForest(worker, task, tick);
          return;
        }
        if (!worker.moveTarget && tick >= worker.cooldownUntilTick) this.sendToForest(worker, task, tick);
        return;
      }
      if (this.entities.map.cellAt(task.workCell[0], task.workCell[1])?.terrain !== 'forest') {
        this.sendToForest(worker, task, tick);
        return;
      }
      if (tick < worker.cooldownUntilTick) return;
      task.phase = 'gathering';
      task.progressTicks = 0;
      worker.cooldownUntilTick = tick + Math.round(worker.cooldownSeconds * TICKS_PER_SECOND);
    }
    if (task.phase === 'gathering') {
      if (!this.at(worker, task.workCell)) {
        this.tasks.delete(worker.id);
        return;
      }
      if (this.entities.map.cellAt(task.workCell[0], task.workCell[1])?.terrain !== 'forest') {
        if (worker.carriedWood > 0) this.sendToBase(worker, task, tick);
        else this.sendToForest(worker, task, tick);
        return;
      }
      task.progressTicks += 1;
      if (task.progressTicks % TICKS_PER_SECOND === 0) {
        worker.carriedWood = Math.min(BALANCE.economy.wood.workerCapacity,
          worker.carriedWood + BALANCE.economy.wood.gatherPerSecond);
      }
      if (worker.carriedWood >= BALANCE.economy.wood.workerCapacity) {
        this.entities.map.setTerrain(task.workCell[0], task.workCell[1], 'plain');
        this.sendToBase(worker, task, tick);
      }
      return;
    }
    if (task.phase === 'toBase' && task.depot && this.at(worker, task.depot) && tick >= worker.cooldownUntilTick) {
      this.stocks[worker.team].wood += worker.carriedWood;
      worker.carriedWood = 0;
      task.depot = null;
      task.phase = 'toForest';
      this.sendToForest(worker, task, tick);
    } else if (task.phase === 'toBase' && !worker.moveTarget && tick >= worker.cooldownUntilTick) {
      this.sendToBase(worker, task, tick);
    }
  }

  private assignWorkCell(worker: UnitEntity, kind: WorkCommand['type'], source: Point, tick: number): Point | null {
    const [sourceX, sourceY] = source;
    const radius = kind === 'mine' ? 1 : 16;
    const reserved = new Set([...this.tasks.entries()]
      .filter(([id]) => id !== worker.id)
      .map(([, task]) => `${task.workCell[0]},${task.workCell[1]}`));
    for (let distance = 0; distance <= radius; distance += 1) {
      for (let dy = -distance; dy <= distance; dy += 1) {
        for (let dx = -distance; dx <= distance; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== distance) continue;
          const x = sourceX + dx;
          const y = sourceY + dy;
          if (!this.entities.map.contains(x, y) || reserved.has(`${x},${y}`)) continue;
          if (kind === 'gather' && this.entities.map.cellAt(x, y)?.terrain !== 'forest') continue;
          if (!this.entities.isFreeForUnit(x, y, worker.id)) continue;
          if (this.at(worker, [x, y])) {
            worker.moveTarget = null;
            return [x, y];
          }
          if (this.movement.issue({ type: 'move', team: worker.team, unitId: worker.id, destination: [x, y] }, tick).accepted) {
            return [x, y];
          }
        }
      }
    }
    return null;
  }

  private sendToBase(worker: UnitEntity, task: GatherTask, tick: number): void {
    const base = this.entities.get(`${worker.team}-base`);
    if (!base || base.category !== 'building') return;
    const candidates = this.basePerimeter(base)
      .filter(([x, y]) => this.entities.isFreeForUnit(x, y, worker.id))
      .sort((a, b) => this.distanceSquared(worker, a) - this.distanceSquared(worker, b));
    for (const cell of candidates) {
      if (this.at(worker, cell)) {
        worker.moveTarget = null;
        task.depot = cell;
        task.phase = 'toBase';
        return;
      }
      if (this.movement.issue({ type: 'move', team: worker.team, unitId: worker.id, destination: cell }, tick).accepted) {
        task.depot = cell;
        task.phase = 'toBase';
        return;
      }
    }
  }

  private sendToForest(worker: UnitEntity, task: GatherTask, tick: number): void {
    const workCell = this.assignWorkCell(worker, 'gather', task.source, tick);
    if (workCell) {
      task.workCell = workCell;
      task.source = workCell;
    } else {
      this.tasks.delete(worker.id);
    }
  }

  private basePerimeter(base: BuildingEntity): Point[] {
    const cells: Point[] = [];
    for (let y = base.y - 1; y <= base.y + base.height; y += 1) {
      for (let x = base.x - 1; x <= base.x + base.width; x += 1) {
        if (x >= base.x && x < base.x + base.width && y >= base.y && y < base.y + base.height) continue;
        if (this.entities.map.contains(x, y)) cells.push([x, y]);
      }
    }
    return cells;
  }

  private distanceSquared(worker: UnitEntity, cell: Point): number {
    return (worker.x - cell[0]) ** 2 + (worker.y - cell[1]) ** 2;
  }

  private at(worker: UnitEntity, cell: Point): boolean {
    return worker.x === cell[0] && worker.y === cell[1];
  }
}
