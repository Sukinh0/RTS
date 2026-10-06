import type { BuildingKind, EntityStore, GameEntity, UnitKind } from '../entities/EntityStore';
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
  readonly knownEnemyBuildings = new Map<string, KnownEnemyBuilding>();
  readonly lastSeenEnemies = new Map<string, KnownEnemyUnit>();
  enemyBaseLocation: Point | null = null;

  private readonly scannedCells = new Set<string>();

  constructor(readonly team: Team) {}

  update(fog: FogOfWar, entities: EntityStore, map: MapGrid, currentTick: number): void {
    const visibleEntities = fog.visibleEntities(this.team);
    const visibleEnemyUnits = new Map<string, GameEntity>();

    for (const entity of visibleEntities) {
      if (entity.team === this.team) continue;

      if (entity.category === 'unit') {
        visibleEnemyUnits.set(entity.id, entity);
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

    // Scan newly visible/explored cells around own units and buildings to discover resources
    const ownEntities = entities.all().filter((e) => e.team === this.team);
    for (const ent of ownEntities) {
      const radius = ent.category === 'unit' ? ent.vision : 5;
      const minX = Math.max(0, ent.x - radius);
      const maxX = Math.min(map.width - 1, ent.x + (ent.category === 'building' ? ent.width - 1 : 0) + radius);
      const minY = Math.max(0, ent.y - radius);
      const maxY = Math.min(map.height - 1, ent.y + (ent.category === 'building' ? ent.height - 1 : 0) + radius);

      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const key = `${x},${y}`;
          if (this.scannedCells.has(key)) continue;
          if (fog.stateAt(this.team, x, y) !== 'unknown') {
            this.scannedCells.add(key);
            const cell = map.cellAt(x, y);
            if (cell?.terrain === 'mine') {
              this.discoveredMines.push([x, y]);
            } else if (cell?.terrain === 'forest') {
              this.discoveredForests.push([x, y]);
            }
          }
        }
      }
    }
  }
}
