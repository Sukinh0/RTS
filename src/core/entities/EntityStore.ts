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
  cooldownSeconds: number;
  cooldownUntilTick: number;
  moveTarget: Point | null;
  carriedWood: number;
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
}

export type GameEntity = UnitEntity | BuildingEntity;

/** Stable IDs and initial ownership, independent of rendering. */
export class EntityStore {
  private readonly byId = new Map<string, GameEntity>();
  private readonly nextUnitSequence = new Map<string, number>();

  constructor(readonly map: MapGrid) {
    for (const team of ['blue', 'red'] as const) {
      const start = map.definition.teamStarts[team];
      const base = BALANCE.buildings.base;
      this.add({
        id: `${team}-base`, category: 'building', kind: 'base', team,
        x: start.base[0], y: start.base[1], width: base.width, height: base.height,
        hp: base.hp, maxHp: base.hp,
        underConstruction: false, buildProgressTicks: 0, buildTotalTicks: 0,
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
          vision: worker.vision, movement: worker.movement, cooldownSeconds: worker.cooldownSeconds,
          cooldownUntilTick: 0, moveTarget: null, carriedWood: 0,
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
      cooldownSeconds: config.cooldownSeconds, cooldownUntilTick: 0, moveTarget: null, carriedWood: 0,
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
    };
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
        if (this.all().some((e) => {
          if (e.category === 'unit') return e.x === col && e.y === row;
          return col >= e.x && col < e.x + e.width && row >= e.y && row < e.y + e.height;
        })) {
          return false;
        }
      }
    }
    return true;
  }

  all(): readonly GameEntity[] {
    return [...this.byId.values()];
  }

  get(id: string): GameEntity | undefined {
    return this.byId.get(id);
  }

  atCell(x: number, y: number): GameEntity | undefined {
    return this.all().find((entity) => entity.category === 'unit'
      ? entity.x === x && entity.y === y
      : x >= entity.x && x < entity.x + entity.width && y >= entity.y && y < entity.y + entity.height);
  }

  unitsInRect(minX: number, minY: number, maxX: number, maxY: number): UnitEntity[] {
    return this.all().filter((entity): entity is UnitEntity => entity.category === 'unit'
      && entity.x >= minX && entity.x <= maxX && entity.y >= minY && entity.y <= maxY);
  }

  isFreeForUnit(x: number, y: number, movingUnitId: string): boolean {
    return this.map.isPassable(x, y) && !this.all().some((entity) => entity.category === 'unit'
      && entity.id !== movingUnitId && entity.x === x && entity.y === y);
  }

  moveUnit(id: string, x: number, y: number): boolean {
    const entity = this.byId.get(id);
    if (!entity || entity.category !== 'unit' || !this.isFreeForUnit(x, y, id)) return false;
    entity.x = x;
    entity.y = y;
    return true;
  }

  remove(id: string): boolean {
    const entity = this.byId.get(id);
    if (!entity) return false;
    this.byId.delete(id);
    if (entity.category === 'building') {
      this.map.clearStructure(entity.x, entity.y, entity.width, entity.height);
    }
    return true;
  }

  private add(entity: GameEntity): void {
    if (this.byId.has(entity.id)) throw new Error(`Duplicate entity ID ${entity.id}`);
    this.byId.set(entity.id, entity);
  }
}
