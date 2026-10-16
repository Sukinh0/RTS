import { BALANCE } from '../../config/balance';
import { MapGrid, type Point, type Team, type Terrain } from '../../map/MapGrid';
import { EntityStore, type BuildingEntity, type GameEntity, type UnitEntity } from '../entities/EntityStore';

export type FogState = 'unknown' | 'explored' | 'visible';
export type BuildingMemory = Readonly<Pick<BuildingEntity, 'id' | 'team' | 'kind' | 'x' | 'y' | 'width' | 'height' | 'hp' | 'maxHp'>>;
export type ObservedEntity = Readonly<GameEntity>;

export interface FogCellView {
  state: FogState;
  terrain: Terrain | null;
  building: BuildingMemory | null;
}

interface TeamFog {
  state: Uint8Array;
  visible: Uint8Array;
  terrain: Array<Terrain | null>;
  buildings: Map<number, BuildingMemory>;
}

const STATE_NAMES: FogState[] = ['unknown', 'explored', 'visible'];

/** Per-team observation and memory; callers receive snapshots, never hidden entity references. */
export class FogOfWar {
  private readonly teams: Record<Team, TeamFog>;

  constructor(private readonly map: MapGrid, private readonly entities: EntityStore) {
    const makeFog = (): TeamFog => ({
      state: new Uint8Array(map.width * map.height),
      visible: new Uint8Array(map.width * map.height),
      terrain: Array<Terrain | null>(map.width * map.height).fill(null),
      buildings: new Map(),
    });
    this.teams = { blue: makeFog(), red: makeFog() };
  }

  update(): void {
    for (const team of ['blue', 'red'] as const) this.updateTeam(team);
  }

  cell(team: Team, x: number, y: number): FogCellView | null {
    if (!this.map.contains(x, y)) return null;
    const index = this.index(x, y);
    const fog = this.teams[team];
    return {
      state: STATE_NAMES[fog.state[index]],
      terrain: fog.terrain[index],
      building: fog.buildings.get(index) ? { ...fog.buildings.get(index)! } : null,
    };
  }

  stateAt(team: Team, x: number, y: number): FogState | null {
    if (!this.map.contains(x, y)) return null;
    return STATE_NAMES[this.teams[team].state[this.index(x, y)]];
  }

  /** Includes current friendly entities and only currently observable enemies. */
  visibleEntities(team: Team): ObservedEntity[] {
    return this.entities.all()
      .filter((entity) => this.isEntityVisible(team, entity))
      .map((entity) => entity.category === 'unit'
        ? { ...entity, moveTarget: entity.moveTarget ? [entity.moveTarget[0], entity.moveTarget[1]] as Point : null }
        : { ...entity });
  }

  knownBuildings(team: Team): BuildingMemory[] {
    const unique = new Map<string, BuildingMemory>();
    for (const building of this.teams[team].buildings.values()) unique.set(building.id, building);
    return [...unique.values()].map((building) => ({ ...building }));
  }

  isEntityVisible(team: Team, entity: GameEntity): boolean {
    if (entity.team === team) return true;
    if (entity.category === 'unit') {
      if (this.stateAt(team, entity.x, entity.y) !== 'visible') return false;
      if (entity.kind !== 'scout') return true;
      return this.isWithinTowerVision(team, entity.x, entity.y) || this.scoutDetected(entity);
    }
    for (let y = entity.y; y < entity.y + entity.height; y += 1) {
      for (let x = entity.x; x < entity.x + entity.width; x += 1) {
        if (this.stateAt(team, x, y) === 'visible') return true;
      }
    }
    return false;
  }

  isWithinTowerVision(team: Team, x: number, y: number): boolean {
    for (const entity of this.entities.all()) {
      if (entity.team === team && entity.category === 'building' && entity.kind === 'tower' && !entity.underConstruction) {
        const halfSpan = 9;
        const minX = entity.x - halfSpan;
        const maxX = entity.x + entity.width - 1 + halfSpan;
        const minY = entity.y - halfSpan;
        const maxY = entity.y + entity.height - 1 + halfSpan;
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
          return true;
        }
      }
    }
    return false;
  }

  private updateTeam(team: Team): void {
    const fog = this.teams[team];
    const visible = fog.visible;
    visible.fill(0);
    for (const entity of this.entities.all()) {
      if (entity.team !== team) continue;
      if (entity.category === 'unit') {
        const radius = entity.vision;
        for (let y = Math.max(0, entity.y - radius); y <= Math.min(this.map.height - 1, entity.y + radius); y += 1) {
          for (let x = Math.max(0, entity.x - radius); x <= Math.min(this.map.width - 1, entity.x + radius); x += 1) {
            if ((x - entity.x) ** 2 + (y - entity.y) ** 2 <= radius ** 2) visible[this.index(x, y)] = 1;
          }
        }
      } else {
        if (entity.kind === 'tower') {
          if (!entity.underConstruction) {
            const halfSpan = 9;
            const minX = Math.max(0, entity.x - halfSpan);
            const maxX = Math.min(this.map.width - 1, entity.x + entity.width - 1 + halfSpan);
            const minY = Math.max(0, entity.y - halfSpan);
            const maxY = Math.min(this.map.height - 1, entity.y + entity.height - 1 + halfSpan);
            for (let y = minY; y <= maxY; y += 1) {
              for (let x = minX; x <= maxX; x += 1) {
                visible[this.index(x, y)] = 1;
              }
            }
          }
        } else {
          const radius = BALANCE.buildings[entity.kind].vision;
          for (let y = Math.max(0, entity.y - radius); y <= Math.min(this.map.height - 1, entity.y + entity.height - 1 + radius); y += 1) {
            for (let x = Math.max(0, entity.x - radius); x <= Math.min(this.map.width - 1, entity.x + entity.width - 1 + radius); x += 1) {
              const nearestX = Math.max(entity.x, Math.min(x, entity.x + entity.width - 1));
              const nearestY = Math.max(entity.y, Math.min(y, entity.y + entity.height - 1));
              if ((x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2) visible[this.index(x, y)] = 1;
            }
          }
        }
      }
    }

    for (let y = 0; y < this.map.height; y += 1) {
      for (let x = 0; x < this.map.width; x += 1) {
        const index = this.index(x, y);
        if (visible[index]) {
          fog.state[index] = 2;
          fog.terrain[index] = this.map.cellAt(x, y)!.terrain;
          const occupant = this.entities.atCell(x, y);
          if (occupant?.category === 'building') fog.buildings.set(index, this.snapshotBuilding(occupant));
          else fog.buildings.delete(index);
        } else if (fog.state[index] !== 0) {
          fog.state[index] = 1;
        }
      }
    }
  }

  private scoutDetected(scout: UnitEntity): boolean {
    const maxDistance = BALANCE.units.scout.stealthDetectionDistance;
    return this.entities.nearby(scout.x, scout.y, maxDistance).some((enemy) => {
      if (enemy.team === scout.team) return false;
      const nearestX = enemy.category === 'building'
        ? Math.max(enemy.x, Math.min(scout.x, enemy.x + enemy.width - 1)) : enemy.x;
      const nearestY = enemy.category === 'building'
        ? Math.max(enemy.y, Math.min(scout.y, enemy.y + enemy.height - 1)) : enemy.y;
      return (nearestX - scout.x) ** 2 + (nearestY - scout.y) ** 2 <= maxDistance ** 2;
    });
  }

  private snapshotBuilding(building: BuildingEntity): BuildingMemory {
    return {
      id: building.id, team: building.team, kind: building.kind,
      x: building.x, y: building.y, width: building.width, height: building.height,
      hp: building.hp, maxHp: building.maxHp,
    };
  }

  private index(x: number, y: number): number {
    return y * this.map.width + x;
  }
}
