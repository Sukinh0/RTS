import { BALANCE } from '../config/balance';
import type { PerformanceMonitor } from '../core/game/PerformanceMonitor';

export type Terrain = 'plain' | 'water' | 'mountain' | 'forest' | 'mine' | 'stone';
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
    shape?: 'rectangle' | 'organic';
  }>;
}

export interface MapCell {
  terrain: Terrain;
  blocked: boolean;
  structureTeam: Team | null;
}

const TERRAINS: Terrain[] = ['plain', 'water', 'mountain', 'forest', 'mine', 'stone'];

/** Logical terrain and static starting footprints. No Phaser or DOM dependency. */
export class MapGrid {
  diagnostics?: PerformanceMonitor;
  readonly width: number;
  readonly height: number;
  private readonly terrain: Uint8Array;
  private readonly structures: Uint8Array;

  private readonly dirtyCells: Point[] = [];
  navigationRevision = 0;
  private componentRevision = -1;
  private components?: Int32Array;
  /** Static connectivity only; dynamic unit collisions are still checked by A*. */
  hasStaticConnection(start: Point, goal: Point): boolean {
    if (!this.isPassable(goal[0], goal[1])) return false;
    // A* permits leaving a blocked start. Preserve that contract for low-level callers.
    if (!this.isPassable(start[0], start[1])) return true;
    if (this.componentRevision !== this.navigationRevision) {
      const labels = this.components ??= new Int32Array(this.width * this.height);
      labels.fill(0);
      const queue = new Int32Array(labels.length);
      let component = 0;
      for (let index = 0; index < labels.length; index++) {
        if (labels[index] || !this.isPassable(index % this.width, Math.floor(index / this.width))) continue;
        component++;
        let head = 0, tail = 0;
        queue[tail++] = index;
        labels[index] = component;
        while (head < tail) {
          const cell = queue[head++];
          const x = cell % this.width, y = Math.floor(cell / this.width);
          for (const next of [cell - this.width, cell + 1, cell + this.width, cell - 1]) {
            const nx = next % this.width, ny = Math.floor(next / this.width);
            if (Math.abs(nx - x) + Math.abs(ny - y) !== 1 || !this.isPassable(nx, ny) || labels[next]) continue;
            labels[next] = component;
            queue[tail++] = next;
          }
        }
      }
      this.componentRevision = this.navigationRevision;
    }
    return this.components![start[1] * this.width + start[0]] === this.components![goal[1] * this.width + goal[0]];
  }

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
      if (patch.shape === 'organic') {
        this.paintOrganicEdge(patch, code, false);
        if (patch.mirrorX) this.paintOrganicEdge(patch, code, true);
      }
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
    if (!this.contains(x, y)) return false;
    const index = this.index(x, y);
    return this.terrain[index] !== 1 && this.terrain[index] !== 2 && this.structures[index] === 0;
  }

  setTerrain(x: number, y: number, terrain: Terrain): boolean {
    if (!this.contains(x, y)) return false;
    const code = TERRAINS.indexOf(terrain);
    if (code < 0) return false;
    const index = this.index(x, y);
    if (this.terrain[index] === code) return false;
    this.terrain[index] = code;
    this.navigationRevision++;
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
    this.navigationRevision++;
    return true;
  }

  clearStructure(x: number, y: number, width: number, height: number): void {
    if (!this.contains(x, y) || !this.contains(x + width - 1, y + height - 1)) return;
    this.navigationRevision++;
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


  /**
   * Grows irregular 1–3 cell fringes around hand-authored terrain patches.
   * The original footprint remains intact, keeping mined resources, economy
   * starts, map landmarks, and attack corridors stable. Growth is deterministic,
   * mirrors exactly, and never overwrites another terrain type.
   */
  private paintOrganicEdge(
    patch: MapDefinition['terrainPatches'][number], code: number, mirrored: boolean,
  ): void {
    if (patch.terrain === 'mine') return;
    const paintFringe = (rawX: number, rawY: number, localX: number, localY: number, depth: number): void => {
      const x = mirrored ? this.width - 1 - rawX : rawX;
      if (!this.contains(x, rawY)) return;
      // Maintain guaranteed cross-map paths at the three validation lanes.
      if ((code === 1 || code === 2) && x >= 68 && x <= 131
        && ([62, 100, 137] as const).some((y) => Math.abs(y - rawY) <= 2)) return;
      const index = this.index(x, rawY);
      if (this.terrain[index] !== 0) return;
      // Smooth broad chunks, plus a stable small-scale irregular outline.
      const wave = Math.sin((localX + patch.x * 0.19) * 0.71)
        + Math.cos((localY + patch.y * 0.31) * 0.43);
      const hash = ((localX * 73856093) ^ (localY * 19349663) ^ (patch.x * 83492791) ^ (patch.y * 2654435761)) >>> 0;
      if (wave * 0.38 + (hash % 100) / 100 > depth * 0.28 + 0.16) {
        this.terrain[index] = code;
      }
    };
    // Add mass beside the long edges and soften the hard rectangle corners.
    const spread = patch.terrain === 'forest' ? 4 : patch.terrain === 'stone' ? 3 : 2;
    for (let y = 0; y < patch.height; y++) {
      for (let d = 1; d <= spread; d++) {
        paintFringe(patch.x - d, patch.y + y, -d, y, d);
        paintFringe(patch.x + patch.width - 1 + d, patch.y + y, patch.width - 1 + d, y, d);
      }
    }
    // Blocking terrain may curve at its sides, not grow into the navigable
    // endpoints of authored channels: A* target cells at the mouths remain free.
    if (patch.terrain === 'forest' || patch.terrain === 'stone') {
      for (let x = -1; x <= patch.width; x++) {
        for (let d = 1; d <= spread; d++) {
          paintFringe(patch.x + x, patch.y - d, x, -d, d);
          paintFringe(patch.x + x, patch.y + patch.height - 1 + d, x, patch.height - 1 + d, d);
        }
      }
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
