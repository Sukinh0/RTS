import { BALANCE } from '../config/balance';
import type { MapGrid, Point, Team, Terrain } from '../map/MapGrid';
import type { BuildingEntity, EntityStore, GameEntity } from '../core/entities/EntityStore';
import type { BuildingMemory, FogState } from '../core/systems/FogOfWar';

export interface VisualPoint { x: number; y: number }
export interface VisualCell {
  state: FogState;
  terrain: Terrain | null;
  building: BuildingMemory | null;
}

/** Presentation-time vision and terrain memory, following interpolated unit positions. */
export class VisualFog {
  private readonly states: Uint8Array;
  private readonly terrain: Array<Terrain | null>;
  private readonly buildings = new Map<number, BuildingMemory>();
  private readonly dirtyTerrain: Point[] = [];
  private readonly visible: Uint8Array;
  private positions: ReadonlyMap<string, VisualPoint> = new Map();
  private lastVisionSignature = '';

  constructor(private readonly map: MapGrid, private readonly entities: EntityStore, readonly team: Team) {
    this.states = new Uint8Array(map.width * map.height);
    this.visible = new Uint8Array(map.width * map.height);
    this.terrain = Array<Terrain | null>(map.width * map.height).fill(null);
  }

  update(positions: ReadonlyMap<string, VisualPoint>, force = false): boolean {
    this.positions = positions;

    let sig = `${this.revealAll ? 1 : 0}|`;
    for (const entity of this.entities.all()) {
      if (entity.category === 'unit') {
        if (entity.team === this.team) {
          const pos = this.positions.get(entity.id) ?? entity;
          sig += `u:${entity.id}:${Math.round(pos.x)},${Math.round(pos.y)}:${entity.vision}|`;
        }
      } else {
        sig += `b:${entity.id}:${entity.hp}:${entity.underConstruction ? 0 : 1}|`;
      }
    }

    if (!force && sig === this.lastVisionSignature) {
      return false;
    }
    this.lastVisionSignature = sig;

    this.visible.fill(0);
    const buildingsByCell = new Map<number, BuildingEntity>();
    for (const entity of this.entities.all()) {
      if (entity.category === 'building') {
        for (let y = entity.y; y < entity.y + entity.height; y += 1) {
          for (let x = entity.x; x < entity.x + entity.width; x += 1) buildingsByCell.set(this.index(x, y), entity);
        }
      }
      if (entity.team !== this.team) continue;
      if (entity.category === 'unit') {
        const position = this.position(entity);
        this.revealCircle(position.x, position.y, entity.vision);
      } else {
        this.revealBuilding(entity);
      }
    }

    let changed = false;
    for (let y = 0; y < this.map.height; y += 1) {
      for (let x = 0; x < this.map.width; x += 1) {
        const index = this.index(x, y);
        const next = this.visible[index] ? 2 : this.states[index] ? 1 : 0;
        if (this.states[index] !== next) {
          this.states[index] = next;
          changed = true;
        }
        if (!this.visible[index]) continue;
        const cell = this.map.cellAt(x, y)!;
        if (this.terrain[index] !== cell.terrain) {
          this.terrain[index] = cell.terrain;
          this.dirtyTerrain.push([x, y]);
        }
        const building = buildingsByCell.get(index);
        if (building) this.buildings.set(index, this.snapshotBuilding(building));
        else this.buildings.delete(index);
      }
    }
    return changed;
  }

  revealAll = false;

  drainDirtyTerrain(): Point[] {
    return this.dirtyTerrain.splice(0);
  }

  rawState(x: number, y: number): number {
    if (!this.map.contains(x, y)) return 0;
    if (this.revealAll) return 2;
    return this.states[this.index(x, y)];
  }

  rawTerrain(x: number, y: number): Terrain | null {
    if (!this.map.contains(x, y)) return null;
    if (this.revealAll) return this.map.cellAt(x, y)?.terrain ?? null;
    return this.terrain[this.index(x, y)];
  }

  stateAt(x: number, y: number): FogState | null {
    if (!this.map.contains(x, y)) return null;
    if (this.revealAll) return 'visible';
    return (['unknown', 'explored', 'visible'] as const)[this.states[this.index(x, y)]];
  }

  cellAt(x: number, y: number): VisualCell | null {
    if (!this.map.contains(x, y)) return null;
    const index = this.index(x, y);
    return {
      state: this.stateAt(x, y)!,
      terrain: this.terrain[index],
      building: this.buildings.get(index) ? { ...this.buildings.get(index)! } : null,
    };
  }

  knownBuildings(): BuildingMemory[] {
    const unique = new Map<string, BuildingMemory>();
    for (const building of this.buildings.values()) unique.set(building.id, building);
    return [...unique.values()].map((building) => ({ ...building }));
  }

  visibleEntities(): GameEntity[] {
    return this.entities.all().filter((entity) => this.isEntityVisible(entity));
  }

  isEntityVisible(entity: GameEntity): boolean {
    if (this.revealAll || entity.team === this.team) return true;
    if (entity.category === 'unit') {
      const position = this.position(entity);
      if (this.stateAt(Math.round(position.x), Math.round(position.y)) !== 'visible') return false;
      if (entity.kind === 'scout') {
        return this.isWithinTowerVision(position.x, position.y) || this.scoutDetected(position, entity.team);
      }
      return true;
    }
    for (let y = entity.y; y < entity.y + entity.height; y += 1) {
      for (let x = entity.x; x < entity.x + entity.width; x += 1) {
        if (this.stateAt(x, y) === 'visible') return true;
      }
    }
    return false;
  }

  isWithinTowerVision(x: number, y: number): boolean {
    for (const entity of this.entities.all()) {
      if (entity.team === this.team && entity.category === 'building' && entity.kind === 'tower' && !entity.underConstruction) {
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

  private position(entity: GameEntity): VisualPoint {
    const pos = entity.category === 'unit' ? this.positions.get(entity.id) ?? entity : entity;
    return { x: Math.round(pos.x), y: Math.round(pos.y) };
  }

  private revealCircle(cx: number, cy: number, radius: number): void {
    for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(this.map.height - 1, Math.ceil(cy + radius)); y += 1) {
      for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(this.map.width - 1, Math.ceil(cx + radius)); x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) this.visible[this.index(x, y)] = 1;
      }
    }
  }

  private revealBuilding(building: BuildingEntity): void {
    if (building.kind === 'tower') {
      if (!building.underConstruction) {
        const halfSpan = 9;
        const minX = Math.max(0, building.x - halfSpan);
        const maxX = Math.min(this.map.width - 1, building.x + building.width - 1 + halfSpan);
        const minY = Math.max(0, building.y - halfSpan);
        const maxY = Math.min(this.map.height - 1, building.y + building.height - 1 + halfSpan);
        for (let y = minY; y <= maxY; y += 1) {
          for (let x = minX; x <= maxX; x += 1) {
            this.visible[this.index(x, y)] = 1;
          }
        }
      }
      return;
    }
    const radius = BALANCE.buildings[building.kind].vision;
    for (let y = Math.max(0, building.y - radius); y <= Math.min(this.map.height - 1, building.y + building.height - 1 + radius); y += 1) {
      for (let x = Math.max(0, building.x - radius); x <= Math.min(this.map.width - 1, building.x + building.width - 1 + radius); x += 1) {
        const nearX = Math.max(building.x, Math.min(x, building.x + building.width - 1));
        const nearY = Math.max(building.y, Math.min(y, building.y + building.height - 1));
        if ((x - nearX) ** 2 + (y - nearY) ** 2 <= radius ** 2) this.visible[this.index(x, y)] = 1;
      }
    }
  }

  private scoutDetected(position: VisualPoint, scoutTeam: Team): boolean {
    const radius = BALANCE.units.scout.stealthDetectionDistance;
    return this.entities.all().some((enemy) => {
      if (enemy.team === scoutTeam) return false;
      if (enemy.category === 'unit') {
        const other = this.position(enemy);
        return Math.hypot(other.x - position.x, other.y - position.y) <= radius;
      }
      const nearX = Math.max(enemy.x, Math.min(position.x, enemy.x + enemy.width - 1));
      const nearY = Math.max(enemy.y, Math.min(position.y, enemy.y + enemy.height - 1));
      return Math.hypot(nearX - position.x, nearY - position.y) <= radius;
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
