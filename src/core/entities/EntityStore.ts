import { BALANCE } from '../../config/balance';
import { TICKS_PER_SECOND } from '../../config/runtime';
import { MapGrid, type Point, type Team } from '../../map/MapGrid';

export type UnitKind = keyof typeof BALANCE.units;
export type BuildingKind = keyof typeof BALANCE.buildings;

interface EntityBase {
  id: string;
  team: Team;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export interface UnitEntity extends EntityBase {
  category: 'unit';
  kind: UnitKind;
  vision: number;
  movement: number;
  movementCooldownSeconds: number;
  cooldownSeconds: number;
  cooldownUntilTick: number;
  moveTarget: Point | null;
  attackMoveTarget: Point | null;
  carriedWood: number;
  carriedStone: number;
  damage: number;
  range: number;
}

export interface BuildingEntity extends EntityBase {
  category: 'building';
  kind: BuildingKind;
  width: number;
  height: number;
  underConstruction: boolean;
  buildProgressTicks: number;
  buildTotalTicks: number;
  rallyPoint: Point | null;
}

export type GameEntity = UnitEntity | BuildingEntity;

export function isUnitEntity(entity: GameEntity | undefined): entity is UnitEntity {
  return entity !== undefined && entity.category === 'unit';
}

export function isBuildingEntity(entity: GameEntity | undefined): entity is BuildingEntity {
  return entity !== undefined && entity.category === 'building';
}

/** Stable IDs and initial ownership, independent of rendering. */
export class EntityStore {
  private readonly byId = new Map<string, GameEntity>();
  private readonly nextUnitSequence = new Map<string, number>();
  private snapshot: readonly GameEntity[] | null = null;
  private readonly cells = new Map<number, Set<GameEntity>>();
  private readonly buckets = new Map<number, Set<GameEntity>>();
  private readonly bucketSize = 8;
  private readonly insertionOrder = new WeakMap<GameEntity, number>();
  private nextOrder = 0;
  /** Changes only when membership changes; consumers can retain sorted views. */
  revision = 0;
  spatialRevision = 0;

  constructor(readonly map: MapGrid) {
    for (const team of ['blue', 'red'] as const) {
      const start = map.definition.teamStarts[team];
      const base = BALANCE.buildings.base;
      this.add({
        id: `${team}-base`, category: 'building', kind: 'base', team,
        x: start.base[0], y: start.base[1], width: base.width, height: base.height,
        hp: base.hp, maxHp: base.hp,
        underConstruction: false, buildProgressTicks: 0, buildTotalTicks: 0,
        rallyPoint: null,
      });
      if (start.workers.length !== BALANCE.startingState.workers) {
        throw new Error(`Incorrect starting worker count for ${team}`);
      }
      start.workers.forEach(([x, y], index) => {
        if (!map.isPassable(x, y) || this.atCell(x, y)) throw new Error(`Invalid starting worker cell for ${team}`);
        const worker = BALANCE.units.worker;
        this.add({
          id: `${team}-worker-${index + 1}`, category: 'unit', kind: 'worker', team,
          x, y, hp: worker.hp, maxHp: worker.hp,
          vision: worker.vision, movement: worker.movement, movementCooldownSeconds: worker.movementCooldownSeconds,
          cooldownSeconds: worker.cooldownSeconds,
          cooldownUntilTick: 0, moveTarget: null, attackMoveTarget: null, carriedWood: 0, carriedStone: 0,
          damage: worker.damage, range: worker.range,
        });
      });
      this.nextUnitSequence.set(`${team}-worker`, start.workers.length + 1);
    }
  }

  /** Low-level entity creation; production rules and costs belong to a later system. */
  spawnUnit(team: Team, kind: UnitKind, x: number, y: number): UnitEntity {
    if (!this.isFreeForUnit(x, y, '')) throw new Error('Unit spawn cell is occupied or blocked');
    const units = this.all().filter((entity) => entity.category === 'unit' && entity.team === team);
    if (units.length >= BALANCE.map.unitCapPerTeam) throw new Error('Unit cap reached');
    const counterKey = `${team}-${kind}`;
    const next = this.nextUnitSequence.get(counterKey) ?? 1;
    const config = BALANCE.units[kind];
    const unit: UnitEntity = {
      id: `${team}-${kind}-${next}`, category: 'unit', kind, team, x, y,
      hp: config.hp, maxHp: config.hp, vision: config.vision, movement: config.movement,
      movementCooldownSeconds: config.movementCooldownSeconds,
      cooldownSeconds: config.cooldownSeconds, cooldownUntilTick: 0, moveTarget: null, attackMoveTarget: null, carriedWood: 0, carriedStone: 0,
      damage: config.damage, range: config.range,
    };
    this.add(unit);
    this.nextUnitSequence.set(counterKey, next + 1);
    return unit;
  }

  createBuilding(team: Team, kind: BuildingKind, x: number, y: number, underConstruction = false): BuildingEntity {
    const config = BALANCE.buildings[kind];
    const counterKey = `${team}-${kind}`;
    const next = this.nextUnitSequence.get(counterKey) ?? 1;
    this.nextUnitSequence.set(counterKey, next + 1);
    const building: BuildingEntity = {
      id: `${team}-${kind}-${next}`,
      category: 'building',
      kind,
      team,
      x,
      y,
      width: config.width,
      height: config.height,
      hp: underConstruction ? 1 : config.hp,
      maxHp: config.hp,
      underConstruction,
      buildProgressTicks: 0,
      buildTotalTicks: Math.round(config.buildSeconds * TICKS_PER_SECOND),
      rallyPoint: null,
    };
    this.map.occupyStructure(x, y, config.width, config.height, team);
    this.add(building);
    return building;
  }

  isAreaFreeForBuilding(x: number, y: number, width: number, height: number): boolean {
    if (!this.map.contains(x, y) || !this.map.contains(x + width - 1, y + height - 1)) {
      return false;
    }
    for (let row = y; row < y + height; row += 1) {
      for (let col = x; col < x + width; col += 1) {
        const cell = this.map.cellAt(col, row);
        if (!cell || cell.terrain !== 'plain' || cell.structureTeam !== null) {
          return false;
        }
        if (this.atCell(col, row)) {
          return false;
        }
      }
    }
    return true;
  }

  all(): readonly GameEntity[] {
    return this.snapshot ??= [...this.byId.values()];
  }

  get(id: string): GameEntity | undefined {
    return this.byId.get(id);
  }

  atCell(x: number, y: number): GameEntity | undefined {
    if (!this.map.contains(x, y)) return undefined;
    let first: GameEntity | undefined;
    for (const entity of this.cells.get(y * this.map.width + x) ?? []) {
      if (!first || this.insertionOrder.get(entity)! < this.insertionOrder.get(first)!) first = entity;
    }
    return first;
  }

  /** Broad phase includes every intersecting building footprint and neighboring cell. */
  nearby(x: number, y: number, radius: number): GameEntity[] {
    const found = new Set<GameEntity>();
    const stride = Math.ceil(this.map.width / this.bucketSize);
    for (let row = Math.floor(Math.max(0, y - radius) / this.bucketSize); row <= Math.floor(Math.min(this.map.height - 1, y + radius) / this.bucketSize); row++) {
      for (let col = Math.floor(Math.max(0, x - radius) / this.bucketSize); col <= Math.floor(Math.min(this.map.width - 1, x + radius) / this.bucketSize); col++) {
        const bucket = this.buckets.get(row * stride + col);
        if (bucket) for (const entity of bucket) {
          const width = entity.category === 'building' ? entity.width : 1;
          const height = entity.category === 'building' ? entity.height : 1;
          if (entity.x <= x + radius && entity.x + width - 1 >= x - radius && entity.y <= y + radius && entity.y + height - 1 >= y - radius) found.add(entity);
        }
      }
    }
    return [...found];
  }

  unitsInRect(minX: number, minY: number, maxX: number, maxY: number): UnitEntity[] {
    const result: UnitEntity[] = [];
    for (const entity of this.byId.values()) {
      if (entity.category === 'unit' && entity.x >= minX && entity.x <= maxX && entity.y >= minY && entity.y <= maxY) {
        result.push(entity);
      }
    }
    return result;
  }

  isFreeForUnit(x: number, y: number, movingUnitId: string): boolean {
    if (!this.map.isPassable(x, y)) return false;
    for (const entity of this.cells.get(y * this.map.width + x) ?? []) {
      if (entity.category === 'unit' && entity.id !== movingUnitId && entity.x === x && entity.y === y) {
        return false;
      }
    }
    return true;
  }

  moveUnit(id: string, x: number, y: number): boolean {
    const entity = this.byId.get(id);
    if (!entity || entity.category !== 'unit' || !this.isFreeForUnit(x, y, id)) return false;
    this.unindex(entity);
    entity.x = x;
    entity.y = y;
    this.index(entity);
    this.spatialRevision++;
    return true;
  }

  remove(id: string): boolean {
    const entity = this.byId.get(id);
    if (!entity) return false;
    this.unindex(entity);
    this.byId.delete(id);
    this.snapshot = null;
    this.revision++;
    this.spatialRevision++;
    if (entity.category === 'building') {
      this.map.clearStructure(entity.x, entity.y, entity.width, entity.height);
    }
    return true;
  }

  private add(entity: GameEntity): void {
    if (this.byId.has(entity.id)) throw new Error(`Duplicate entity ID ${entity.id}`);
    this.byId.set(entity.id, entity);
    this.insertionOrder.set(entity, this.nextOrder++);
    this.index(entity);
    this.snapshot = null;
    this.revision++;
    this.spatialRevision++;
  }

  private index(entity: GameEntity): void {
    this.updateBuckets(entity, true);
    const width = entity.category === 'building' ? entity.width : 1;
    const height = entity.category === 'building' ? entity.height : 1;
    for (let y = entity.y; y < entity.y + height; y++) {
      for (let x = entity.x; x < entity.x + width; x++) {
        const key = y * this.map.width + x;
        let cell = this.cells.get(key);
        if (!cell) this.cells.set(key, cell = new Set());
        cell.add(entity);
      }
    }
  }

  private unindex(entity: GameEntity): void {
    this.updateBuckets(entity, false);
    const width = entity.category === 'building' ? entity.width : 1;
    const height = entity.category === 'building' ? entity.height : 1;
    for (let y = entity.y; y < entity.y + height; y++) {
      for (let x = entity.x; x < entity.x + width; x++) {
        const key = y * this.map.width + x;
        const cell = this.cells.get(key);
        cell?.delete(entity);
        if (cell?.size === 0) this.cells.delete(key);
      }
    }
  }

  private updateBuckets(entity: GameEntity, add: boolean): void {
    const width = entity.category === 'building' ? entity.width : 1;
    const height = entity.category === 'building' ? entity.height : 1;
    const stride = Math.ceil(this.map.width / this.bucketSize);
    for (let row = Math.floor(entity.y / this.bucketSize); row <= Math.floor((entity.y + height - 1) / this.bucketSize); row++) {
      for (let col = Math.floor(entity.x / this.bucketSize); col <= Math.floor((entity.x + width - 1) / this.bucketSize); col++) {
        const key = row * stride + col;
        let bucket = this.buckets.get(key);
        if (add) {
          if (!bucket) this.buckets.set(key, bucket = new Set());
          bucket.add(entity);
        } else {
          bucket?.delete(entity);
          if (bucket?.size === 0) this.buckets.delete(key);
        }
      }
    }
  }
}
