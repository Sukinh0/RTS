import { BALANCE } from '../../config/balance';
import { TICKS_PER_SECOND } from '../../config/runtime';
import type { Point } from '../../map/MapGrid';
import type { CommandResult, ProduceCommand } from '../commands/MoveCommand';
import { EntityStore, type BuildingEntity, type UnitKind } from '../entities/EntityStore';
import type { TeamStock } from './EconomySystem';
import { FogOfWar } from './FogOfWar';

export interface ProductionItem {
  unitKind: UnitKind;
  progressTicks: number;
  totalTicks: number;
}

export class ProductionSystem {
  private readonly queues = new Map<string, ProductionItem[]>();

  constructor(
    private readonly entities: EntityStore,
    private readonly stocks: TeamStock,
    private readonly fog: FogOfWar,
  ) {}

  queueFor(buildingId: string): readonly ProductionItem[] {
    return this.queues.get(buildingId) ?? [];
  }

  cancel(buildingId: string): void {
    this.queues.delete(buildingId);
  }

  issue(command: ProduceCommand): CommandResult {
    const building = this.entities.get(command.buildingId);
    if (!building || building.category !== 'building') return { accepted: false, reason: 'unknown-building' };
    if (building.team !== command.team) return { accepted: false, reason: 'wrong-owner' };
    if (building.underConstruction) return { accepted: false, reason: 'under-construction' };

    if (building.kind === 'house') {
      if (command.unitKind !== 'worker') return { accepted: false, reason: 'invalid-unit-kind' };
    } else if (building.kind === 'barracks') {
      if (!['soldier', 'archer', 'shieldbearer', 'scout'].includes(command.unitKind)) {
        return { accepted: false, reason: 'invalid-unit-kind' };
      }
    } else {
      return { accepted: false, reason: 'invalid-unit-kind' };
    }

    const currentUnits = this.entities.all().filter((e) => e.category === 'unit' && e.team === command.team).length;
    let queuedUnits = 0;
    for (const b of this.entities.all()) {
      if (b.category === 'building' && b.team === command.team) {
        queuedUnits += (this.queues.get(b.id)?.length ?? 0);
      }
    }
    if (currentUnits + queuedUnits >= BALANCE.map.unitCapPerTeam) {
      return { accepted: false, reason: 'unit-cap-reached' };
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
        continue;
      }

      const active = queue[0];
      active.progressTicks += 1;
      if (active.progressTicks >= active.totalTicks) {
        const spawnCell = this.findSpawnCell(building);
        if (spawnCell) {
          this.entities.spawnUnit(building.team, active.unitKind, spawnCell[0], spawnCell[1]);
          queue.shift();
          this.fog.update();
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
