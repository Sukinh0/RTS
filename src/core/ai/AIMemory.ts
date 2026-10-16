import { BALANCE } from '../../config/balance';
import type { BuildingKind, EntityStore, UnitKind } from '../entities/EntityStore';
import type { FogOfWar } from '../systems/FogOfWar';
import type { MapGrid, Point, Team } from '../../map/MapGrid';

export interface KnownEnemyBuilding {
  id: string;
  kind: BuildingKind;
  x: number;
  y: number;
  width: number;
  height: number;
  lastSeenTick: number;
}

export interface KnownEnemyUnit {
  id: string;
  kind: UnitKind;
  x: number;
  y: number;
  lastSeenTick: number;
}

export class AIMemory {
  readonly discoveredMines: Point[] = [];
  readonly discoveredForests: Point[] = [];
  readonly discoveredStones: Point[] = [];
  readonly knownEnemyBuildings = new Map<string, KnownEnemyBuilding>();
  readonly lastSeenEnemies = new Map<string, KnownEnemyUnit>();
  enemyBaseLocation: Point | null = null;

  private scannedCells?: Uint8Array;
  private lastResourceScanTick = -30;

  constructor(readonly team: Team) {}

  update(fog: FogOfWar, entities: EntityStore, map: MapGrid, currentTick: number): void {
    const visibleEntities = fog.visibleEntities(this.team);

    for (const entity of visibleEntities) {
      if (entity.team === this.team) continue;

      if (entity.category === 'unit') {
        this.lastSeenEnemies.set(entity.id, {
          id: entity.id,
          kind: entity.kind,
          x: entity.x,
          y: entity.y,
          lastSeenTick: currentTick,
        });
      } else if (entity.category === 'building') {
        this.knownEnemyBuildings.set(entity.id, {
          id: entity.id,
          kind: entity.kind,
          x: entity.x,
          y: entity.y,
          width: entity.width,
          height: entity.height,
          lastSeenTick: currentTick,
        });
        if (entity.kind === 'base') {
          this.enemyBaseLocation = [entity.x, entity.y];
        }
      }
    }

    // Prune enemy buildings if their location is currently visible and building is gone
    for (const [id, building] of this.knownEnemyBuildings.entries()) {
      if (fog.stateAt(this.team, building.x, building.y) === 'visible') {
        const actual = entities.get(id);
        if (!actual || actual.hp <= 0) {
          this.knownEnemyBuildings.delete(id);
          if (building.kind === 'base' && this.enemyBaseLocation && this.enemyBaseLocation[0] === building.x && this.enemyBaseLocation[1] === building.y) {
            this.enemyBaseLocation = null;
          }
        }
      }
    }

    // Scan resources once per decision interval; large building vision need not be rescanned every tick.
    if (currentTick - this.lastResourceScanTick < 30) return;
    this.lastResourceScanTick = currentTick;
    const scanned = this.scannedCells ??= new Uint8Array(map.width * map.height);
    // Scan newly visible/explored cells around own units and buildings to discover resources
    const ownEntities = entities.all().filter((e) => e.team === this.team);
    for (const ent of ownEntities) {
      const radius = ent.category === 'unit' ? ent.vision : BALANCE.buildings[ent.kind].vision;
      const minX = Math.max(0, ent.x - radius);
      const maxX = Math.min(map.width - 1, ent.x + (ent.category === 'building' ? ent.width - 1 : 0) + radius);
      const minY = Math.max(0, ent.y - radius);
      const maxY = Math.min(map.height - 1, ent.y + (ent.category === 'building' ? ent.height - 1 : 0) + radius);

      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const key = y * map.width + x;
          if (scanned[key]) continue;
          if (fog.stateAt(this.team, x, y) !== 'unknown') {
            scanned[key] = 1;
            const cell = map.cellAt(x, y);
            if (cell?.terrain === 'mine') {
              this.discoveredMines.push([x, y]);
            } else if (cell?.terrain === 'forest') {
              this.discoveredForests.push([x, y]);
            } else if (cell?.terrain === 'stone') {
              this.discoveredStones.push([x, y]);
            }
          }
        }
      }
    }
  }
}
