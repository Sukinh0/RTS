import { BALANCE } from '../config/balance';

export type Terrain = 'plain' | 'water' | 'mountain' | 'forest' | 'mine';
export type Team = 'blue' | 'red';
export type Point = readonly [number, number];

export interface MapDefinition {
  id: string;
  width: number;
  height: number;
  teamStarts: Record<Team, { base: Point; workers: Point[] }>;
  terrainPatches: Array<{
    terrain: Exclude<Terrain, 'plain'>;
    x: number;
    y: number;
    width: number;
    height: number;
    mirrorX: boolean;
  }>;
}

export interface MapCell {
  terrain: Terrain;
  blocked: boolean;
  structureTeam: Team | null;
}

const TERRAINS: Terrain[] = ['plain', 'water', 'mountain', 'forest', 'mine'];

/** Logical terrain and static starting footprints. No Phaser or DOM dependency. */
export class MapGrid {
  readonly width: number;
  readonly height: number;
  private readonly terrain: Uint8Array;
  private readonly structures: Uint8Array;

  private readonly dirtyCells: Point[] = [];

  constructor(readonly definition: MapDefinition) {
    if (definition.width !== BALANCE.map.width || definition.height !== BALANCE.map.height) {
      throw new Error('Map dimensions must match balance configuration');
    }
    this.width = definition.width;
    this.height = definition.height;
    this.terrain = new Uint8Array(this.width * this.height);
    this.structures = new Uint8Array(this.width * this.height);

    for (const patch of definition.terrainPatches) {
      const code = TERRAINS.indexOf(patch.terrain);
      if (code < 1 || !Number.isInteger(patch.width) || !Number.isInteger(patch.height) || patch.width < 1 || patch.height < 1) {
        throw new Error('Invalid terrain patch');
      }
      this.paint(patch.x, patch.y, patch.width, patch.height, code);
      if (patch.mirrorX) this.paint(this.width - patch.x - patch.width, patch.y, patch.width, patch.height, code);
    }

    for (const team of ['blue', 'red'] as const) {
      const [x, y] = definition.teamStarts[team].base;
      const base = BALANCE.buildings.base;
      this.paintStructure(x, y, base.width, base.height, team === 'blue' ? 1 : 2);
    }
  }

  contains(x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  cellAt(x: number, y: number): MapCell | null {
    if (!this.contains(x, y)) return null;
    const index = this.index(x, y);
    const terrain = TERRAINS[this.terrain[index]];
    const structure = this.structures[index];
    return {
      terrain,
      blocked: terrain === 'water' || terrain === 'mountain' || structure !== 0,
      structureTeam: structure === 1 ? 'blue' : structure === 2 ? 'red' : null,
    };
  }

  isPassable(x: number, y: number): boolean {
    return this.cellAt(x, y)?.blocked === false;
  }

  setTerrain(x: number, y: number, terrain: Terrain): boolean {
    if (!this.contains(x, y)) return false;
    const code = TERRAINS.indexOf(terrain);
    if (code < 0) return false;
    const index = this.index(x, y);
    if (this.terrain[index] === code) return false;
    this.terrain[index] = code;
    this.dirtyCells.push([x, y]);
    return true;
  }

  occupyStructure(x: number, y: number, width: number, height: number, team: Team): boolean {
    if (!this.contains(x, y) || !this.contains(x + width - 1, y + height - 1)) return false;
    const code = team === 'blue' ? 1 : 2;
    for (let row = y; row < y + height; row += 1) {
      for (let col = x; col < x + width; col += 1) {
        const index = this.index(col, row);
        if (this.terrain[index] !== 0 || this.structures[index] !== 0) return false;
      }
    }
    for (let row = y; row < y + height; row += 1) {
      for (let col = x; col < x + width; col += 1) {
        const index = this.index(col, row);
        this.structures[index] = code;
        this.dirtyCells.push([col, row]);
      }
    }
    return true;
  }

  clearStructure(x: number, y: number, width: number, height: number): void {
    if (!this.contains(x, y) || !this.contains(x + width - 1, y + height - 1)) return;
    for (let row = y; row < y + height; row += 1) {
      for (let col = x; col < x + width; col += 1) {
        const index = this.index(col, row);
        this.structures[index] = 0;
        this.dirtyCells.push([col, row]);
      }
    }
  }

  drainDirtyCells(): Point[] {
    return this.dirtyCells.splice(0);
  }

  private index(x: number, y: number): number {
    return y * this.width + x;
  }

  private paint(x: number, y: number, width: number, height: number, code: number): void {
    if (!this.contains(x, y) || !this.contains(x + width - 1, y + height - 1)) {
      throw new Error('Terrain patch outside map bounds');
    }
    for (let row = y; row < y + height; row += 1) {
      for (let col = x; col < x + width; col += 1) this.terrain[this.index(col, row)] = code;
    }
  }

  private paintStructure(x: number, y: number, width: number, height: number, code: number): void {
    if (!this.contains(x, y) || !this.contains(x + width - 1, y + height - 1)) {
      throw new Error('Starting base outside map bounds');
    }
    for (let row = y; row < y + height; row += 1) {
      for (let col = x; col < x + width; col += 1) {
        const index = this.index(col, row);
        if (this.terrain[index] !== 0 || this.structures[index] !== 0) throw new Error('Starting base overlaps terrain or structure');
        this.structures[index] = code;
      }
    }
  }
}
