import { BALANCE } from '../../config/balance';
import { TICKS_PER_SECOND } from '../../config/runtime';
import type { Point, Team } from '../../map/MapGrid';
import type { CommandResult, ProduceCommand, SetRallyPointCommand } from '../commands/MoveCommand';
import { EntityStore, type BuildingEntity, type UnitEntity, type UnitKind } from '../entities/EntityStore';
import type { TeamStock } from './EconomySystem';
import { FogOfWar } from './FogOfWar';

export function isCivilianUnit(kind: UnitKind): boolean {
  return kind === 'worker' || kind === 'builder';
}

export function isMilitaryUnit(kind: UnitKind): boolean {
  return !isCivilianUnit(kind);
}

export type UnitSpawnCallback = (unit: UnitEntity, building: BuildingEntity, rallyPoint: Point) => void;

export interface TeamCapacity {
  civilianUnits: number;
  civilianQueued: number;
  civilianCapacity: number;
  militaryUnits: number;
  militaryQueued: number;
  militaryCapacity: number;
  totalUnits: number;
  totalQueued: number;
  maxTotalUnits: number;
}

export interface ProductionItem {
  unitKind: UnitKind;
  progressTicks: number;
  totalTicks: number;
}

export class ProductionSystem {
  private readonly queues = new Map<string, ProductionItem[]>();
  private readonly rallyPoints = new Map<string, Point>();
  private onUnitSpawned?: UnitSpawnCallback;
  private onUnitProduced?: (unit: UnitEntity) => void;
  instantProduction = false;

  constructor(
    private readonly entities: EntityStore,
    private readonly stocks: TeamStock,
    private readonly fog: FogOfWar,
  ) {}

  setOnUnitSpawned(callback: UnitSpawnCallback): void {
    this.onUnitSpawned = callback;
  }

  setOnUnitProduced(callback: (unit: UnitEntity) => void): void {
    this.onUnitProduced = callback;
  }

  getRallyPoint(buildingId: string): Point | null {
    return this.rallyPoints.get(buildingId) ?? (this.entities.get(buildingId) as BuildingEntity)?.rallyPoint ?? null;
  }

  clearRallyPoint(buildingId: string): void {
    this.rallyPoints.delete(buildingId);
    const building = this.entities.get(buildingId);
    if (building && building.category === 'building') {
      building.rallyPoint = null;
    }
  }

  setRallyPoint(command: SetRallyPointCommand): CommandResult {
    const building = this.entities.get(command.buildingId);
    if (!building || building.category !== 'building') return { accepted: false, reason: 'unknown-building' };
    if (building.team !== command.team) return { accepted: false, reason: 'wrong-owner' };
    if (building.kind !== 'house' && building.kind !== 'barracks') {
      return { accepted: false, reason: 'unsupported-building' };
    }
    if (command.point !== null) {
      const [x, y] = command.point;
      if (!this.entities.map.contains(x, y)) {
        return { accepted: false, reason: 'invalid-destination' };
      }
    }
    if (command.point) {
      this.rallyPoints.set(building.id, [...command.point]);
      building.rallyPoint = [...command.point];
    } else {
      this.rallyPoints.delete(building.id);
      building.rallyPoint = null;
    }
    return { accepted: true };
  }

  getCapacity(team: Team): TeamCapacity {
    let civilianUnits = 0;
    let militaryUnits = 0;
    let civilianCapacity = 0;
    let militaryCapacity = 0;
    let civilianQueued = 0;
    let militaryQueued = 0;

    for (const entity of this.entities.all()) {
      if (entity.team !== team) continue;
      if (entity.category === 'unit') {
        if (isCivilianUnit(entity.kind)) {
          civilianUnits += 1;
        } else {
          militaryUnits += 1;
        }
      } else if (entity.category === 'building') {
        if (!entity.underConstruction && entity.hp > 0) {
          const config = BALANCE.buildings[entity.kind];
          civilianCapacity += config.civilianCapacity ?? 0;
          militaryCapacity += config.militaryCapacity ?? 0;
        }
        const queue = this.queues.get(entity.id);
        if (queue) {
          for (const item of queue) {
            if (isCivilianUnit(item.unitKind)) {
              civilianQueued += 1;
            } else {
              militaryQueued += 1;
            }
          }
        }
      }
    }

    return {
      civilianUnits,
      civilianQueued,
      civilianCapacity,
      militaryUnits,
      militaryQueued,
      militaryCapacity,
      totalUnits: civilianUnits + militaryUnits,
      totalQueued: civilianQueued + militaryQueued,
      maxTotalUnits: BALANCE.map.unitCapPerTeam,
    };
  }

  queueFor(buildingId: string): readonly ProductionItem[] {
    return this.queues.get(buildingId) ?? [];
  }

  cancel(buildingId: string): void {
    this.queues.delete(buildingId);
    this.clearRallyPoint(buildingId);
  }

  issue(command: ProduceCommand): CommandResult {
    const building = this.entities.get(command.buildingId);
    if (!building || building.category !== 'building') return { accepted: false, reason: 'unknown-building' };
    if (building.team !== command.team) return { accepted: false, reason: 'wrong-owner' };
    if (building.underConstruction) return { accepted: false, reason: 'under-construction' };

    if (building.kind === 'house') {
      if (command.unitKind !== 'worker' && command.unitKind !== 'builder') return { accepted: false, reason: 'invalid-unit-kind' };
    } else if (building.kind === 'barracks') {
      if (!['soldier', 'archer', 'shieldbearer', 'scout'].includes(command.unitKind)) {
        return { accepted: false, reason: 'invalid-unit-kind' };
      }
    } else {
      return { accepted: false, reason: 'invalid-unit-kind' };
    }

    const capacity = this.getCapacity(command.team);
    if (capacity.totalUnits + capacity.totalQueued >= capacity.maxTotalUnits) {
      return { accepted: false, reason: 'unit-cap-reached' };
    }

    if (isCivilianUnit(command.unitKind)) {
      if (capacity.civilianUnits + capacity.civilianQueued >= capacity.civilianCapacity) {
        return { accepted: false, reason: 'civilian-capacity-reached' };
      }
    } else {
      if (capacity.militaryUnits + capacity.militaryQueued >= capacity.militaryCapacity) {
        return { accepted: false, reason: 'military-capacity-reached' };
      }
    }

    const unitConfig = BALANCE.units[command.unitKind];
    const stock = this.stocks[command.team];
    if (stock.coins < unitConfig.coins) return { accepted: false, reason: 'insufficient-coins' };
    if (stock.wood < unitConfig.wood) return { accepted: false, reason: 'insufficient-wood' };

    stock.coins -= unitConfig.coins;
    stock.wood -= unitConfig.wood;

    const totalTicks = Math.round(unitConfig.productionSeconds * TICKS_PER_SECOND);
    const item: ProductionItem = {
      unitKind: command.unitKind,
      progressTicks: 0,
      totalTicks,
    };
    const queue = this.queues.get(building.id) ?? [];
    queue.push(item);
    this.queues.set(building.id, queue);

    return { accepted: true };
  }

  update(): void {
    for (const [buildingId, queue] of this.queues.entries()) {
      if (queue.length === 0) continue;
      const building = this.entities.get(buildingId);
      if (!building || building.category !== 'building' || building.hp <= 0) {
        this.queues.delete(buildingId);
        this.clearRallyPoint(buildingId);
        continue;
      }

      const active = queue[0];
      active.progressTicks += this.instantProduction ? active.totalTicks : 1;
      if (active.progressTicks >= active.totalTicks) {
        const spawnCell = this.findSpawnCell(building);
        if (spawnCell) {
          const unit = this.entities.spawnUnit(building.team, active.unitKind, spawnCell[0], spawnCell[1]);
          queue.shift();
          this.fog.update();
          const rally = this.getRallyPoint(building.id);
          this.onUnitProduced?.(unit);
          if (rally) this.onUnitSpawned?.(unit, building, rally);
        }
      }
    }
  }

  private findSpawnCell(building: BuildingEntity): Point | null {
    for (let distance = 1; distance <= 5; distance += 1) {
      for (let y = building.y - distance; y <= building.y + building.height - 1 + distance; y += 1) {
        for (let x = building.x - distance; x <= building.x + building.width - 1 + distance; x += 1) {
          if (x >= building.x && x < building.x + building.width && y >= building.y && y < building.y + building.height) {
            continue;
          }
          if (this.entities.map.contains(x, y) && this.entities.isFreeForUnit(x, y, '')) {
            return [x, y];
          }
        }
      }
    }
    return null;
  }
}
