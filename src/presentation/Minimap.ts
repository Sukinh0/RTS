import type { MapGrid, Point, Terrain } from '../map/MapGrid';
import type { EntityStore } from '../core/entities/EntityStore';
import type { VisualFog, VisualPoint } from './VisualFog';

export interface MinimapEntity {
  id: string;
  team: 'blue' | 'red';
  category: 'unit' | 'building';
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MinimapCell {
  state: 'unknown' | 'explored' | 'visible';
  terrain: Terrain | null;
}

export interface CameraRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MinimapOptions {
  map: MapGrid;
  entities: EntityStore;
  fog: VisualFog;
  playerTeam?: 'blue' | 'red';
}

/** Precomputed 32-bit little-endian RGBA color table (0xAABBGGRR). */
const FOG_BASE = { r: 112, g: 148, b: 144 };

/** A deterministic low-frequency tint gives unexplored cells a soft fog look without exposing terrain. */
function unknownFogColor(x: number, y: number, terrain: Terrain | null): number {
  const base = terrain === 'mountain'
    ? { r: 104, g: 138, b: 130 }
    : terrain === 'water'
      ? { r: 108, g: 154, b: 159 }
      : FOG_BASE;
  const haze = Math.sin(x * 0.075 + Math.cos(y * 0.047) * 1.4) * 0.52
    + Math.cos(y * 0.068 - x * 0.039) * 0.34
    + Math.sin((x + y) * 0.031) * 0.14;
  const shade = Math.round(haze * 10);
  const r = base.r + shade;
  const g = base.g + shade;
  const b = base.b + shade;
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

const COLORS_VISIBLE: Record<Terrain, number> = {
  plain: 0xff539665, // #659653, same palette as the map
  water: 0xffa4a74a, // #4aa7a4
  mountain: 0xff6f7977, // #77796f
  forest: 0xff47794a, // #4a7947
  mine: 0xff4ea6d5, // #d5a64e
  stone: 0xff948b82, // #828b94
};

const COLORS_EXPLORED: Record<Terrain, number> = {
  plain: 0xff3f663f,
  water: 0xff737f3c,
  mountain: 0xff565e5c,
  forest: 0xff315330,
  mine: 0xff3b7291,
  stone: 0xff69645e,
};

/**
 * Minimap model and renderer for RTS V1.1.
 * Provides strategic overview, respects fog of war, stealth and tower vision,
 * and handles click/drag camera navigation.
 */
export class Minimap {
  readonly map: MapGrid;
  readonly entities: EntityStore;
  readonly fog: VisualFog;
  readonly playerTeam: 'blue' | 'red';

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private imgData: ImageData | null = null;
  private pixelBuffer: Uint32Array | null = null;
  private bgCanvas: HTMLCanvasElement | null = null;
  private bgCtx: CanvasRenderingContext2D | null = null;
  private bgDirty = true;
  private onNavigateCallback: ((cellX: number, cellY: number) => void) | null = null;
  private isDragging = false;

  private boundPointerDown: ((e: PointerEvent) => void) | null = null;
  private boundPointerMove: ((e: PointerEvent) => void) | null = null;
  private boundPointerUp: ((e: PointerEvent) => void) | null = null;
  private boundPointerCancel: ((e: PointerEvent) => void) | null = null;

  constructor(options: MinimapOptions) {
    this.map = options.map;
    this.entities = options.entities;
    this.fog = options.fog;
    this.playerTeam = options.playerTeam ?? 'blue';
  }

  /**
   * Returns cell state and terrain for minimap evaluation.
   */
  getCell(x: number, y: number): MinimapCell {
    if (!this.map.contains(x, y)) {
      return { state: 'unknown', terrain: null };
    }
    const cell = this.fog.cellAt(x, y);
    if (!cell) {
      return { state: 'unknown', terrain: null };
    }
    return {
      state: cell.state,
      terrain: cell.state === 'unknown' ? null : cell.terrain,
    };
  }

  /**
   * Filters entities that are observable on the minimap for the player.
   * - Allied units and buildings: always shown.
   * - Visible enemy units/buildings: shown.
   * - Hidden enemy units (in fog or scout stealth): excluded.
   * - Scouts inside tower vision or detected: shown.
   */
  getVisibleEntities(displayPositions?: ReadonlyMap<string, VisualPoint>): MinimapEntity[] {
    const list: MinimapEntity[] = [];

    for (const entity of this.entities.all()) {
      if (entity.team === this.playerTeam) {
        // Allied entity
        const pos = entity.category === 'unit' && displayPositions?.has(entity.id)
          ? displayPositions.get(entity.id)!
          : { x: entity.x, y: entity.y };

        list.push({
          id: entity.id,
          team: entity.team,
          category: entity.category,
          kind: entity.kind,
          x: pos.x,
          y: pos.y,
          width: entity.category === 'building' ? entity.width : 1,
          height: entity.category === 'building' ? entity.height : 1,
        });
      } else {
        // Enemy entity: only include if currently visible according to fog rules
        if (this.fog.isEntityVisible(entity)) {
          const pos = entity.category === 'unit' && displayPositions?.has(entity.id)
            ? displayPositions.get(entity.id)!
            : { x: entity.x, y: entity.y };

          list.push({
            id: entity.id,
            team: entity.team,
            category: entity.category,
            kind: entity.kind,
            x: pos.x,
            y: pos.y,
            width: entity.category === 'building' ? entity.width : 1,
            height: entity.category === 'building' ? entity.height : 1,
          });
        }
      }
    }

    return list;
  }

  /**
   * Converts pointer coordinates on canvas to discrete map cell coordinates [0..map.width-1, 0..map.height-1].
   */
  coordsToCell(canvasX: number, canvasY: number, width: number, height: number): Point {
    const normX = width > 0 ? canvasX / width : 0;
    const normY = height > 0 ? canvasY / height : 0;
    const cellX = Math.max(0, Math.min(this.map.width - 1, Math.floor(normX * this.map.width)));
    const cellY = Math.max(0, Math.min(this.map.height - 1, Math.floor(normY * this.map.height)));
    return [cellX, cellY];
  }

  /**
   * Converts map cell coordinate to normalized/canvas coordinate.
   */
  cellToCoords(cellX: number, cellY: number, width: number, height: number): Point {
    const x = (cellX / this.map.width) * width;
    const y = (cellY / this.map.height) * height;
    return [x, y];
  }

  /**
   * Calculates the camera viewport rectangle on the minimap.
   */
  cameraToMinimapRect(
    worldView: { x: number; y: number; width: number; height: number },
    cellSize: number,
    minimapWidth = this.map.width,
    minimapHeight = this.map.height,
  ): CameraRect {
    const totalWorldWidth = this.map.width * cellSize;
    const totalWorldHeight = this.map.height * cellSize;

    const x = (worldView.x / totalWorldWidth) * minimapWidth;
    const y = (worldView.y / totalWorldHeight) * minimapHeight;
    const width = (worldView.width / totalWorldWidth) * minimapWidth;
    const height = (worldView.height / totalWorldHeight) * minimapHeight;

    return { x, y, width, height };
  }

  /**
   * Attaches interactive controls to the minimap canvas element.
   */
  attach(canvas: HTMLCanvasElement, onNavigate: (cellX: number, cellY: number) => void): void {
    this.detach();
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: false });
    this.onNavigateCallback = onNavigate;

    const mapW = this.map.width;
    const mapH = this.map.height;

    if (this.ctx) {
      this.imgData = this.ctx.createImageData(mapW, mapH);
      this.pixelBuffer = new Uint32Array(this.imgData.data.buffer);
      if (typeof document !== 'undefined') {
        this.bgCanvas = document.createElement('canvas');
        this.bgCanvas.width = mapW;
        this.bgCanvas.height = mapH;
        this.bgCtx = this.bgCanvas.getContext('2d');
      }
      this.bgDirty = true;
    }

    const handlePointerAction = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const [cellX, cellY] = this.coordsToCell(clickX, clickY, rect.width, rect.height);
      this.onNavigateCallback?.(cellX, cellY);
    };

    this.boundPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return; // Left mouse click only
      this.isDragging = true;
      canvas.setPointerCapture?.(e.pointerId);
      handlePointerAction(e);
      e.preventDefault();
    };

    this.boundPointerMove = (e: PointerEvent) => {
      if (!this.isDragging) return;
      handlePointerAction(e);
      e.preventDefault();
    };

    this.boundPointerUp = (e: PointerEvent) => {
      if (this.isDragging) {
        this.isDragging = false;
        canvas.releasePointerCapture?.(e.pointerId);
        e.preventDefault();
      }
    };

    this.boundPointerCancel = () => {
      this.isDragging = false;
    };

    canvas.addEventListener('pointerdown', this.boundPointerDown);
    canvas.addEventListener('pointermove', this.boundPointerMove);
    canvas.addEventListener('pointerup', this.boundPointerUp);
    canvas.addEventListener('pointercancel', this.boundPointerCancel);
  }

  /**
   * Removes event listeners from the attached canvas.
   */
  detach(): void {
    if (this.canvas) {
      if (this.boundPointerDown) this.canvas.removeEventListener('pointerdown', this.boundPointerDown);
      if (this.boundPointerMove) this.canvas.removeEventListener('pointermove', this.boundPointerMove);
      if (this.boundPointerUp) this.canvas.removeEventListener('pointerup', this.boundPointerUp);
      if (this.boundPointerCancel) this.canvas.removeEventListener('pointercancel', this.boundPointerCancel);
    }
    this.canvas = null;
    this.ctx = null;
    this.imgData = null;
    this.pixelBuffer = null;
    this.bgCanvas = null;
    this.bgCtx = null;
    this.bgDirty = true;
    this.onNavigateCallback = null;
    this.isDragging = false;
  }

  /**
   * Renders the minimap frame.
   */
  render(
    worldView: { x: number; y: number; width: number; height: number },
    cellSize: number,
    displayPositions?: ReadonlyMap<string, VisualPoint>,
    visionChanged = true,
  ): void {
    if (!this.ctx || !this.imgData || !this.pixelBuffer || !this.canvas) return;

    const width = this.map.width;
    const height = this.map.height;
    const pixels = this.pixelBuffer;

    // 1. Write terrain and fog into 32-bit pixel buffer only when dirty or vision changed
    if (visionChanged || this.bgDirty || !this.bgCanvas) {
      let ptr = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const st = this.fog.rawState(x, y);
          if (st === 0) {
            pixels[ptr] = unknownFogColor(x, y, this.map.cellAt(x, y)?.terrain ?? null);
          } else if (st === 2) {
            const terr = this.fog.rawTerrain(x, y);
            pixels[ptr] = terr ? COLORS_VISIBLE[terr] : COLORS_VISIBLE.plain;
          } else {
            const terr = this.fog.rawTerrain(x, y);
            pixels[ptr] = terr ? COLORS_EXPLORED[terr] : COLORS_EXPLORED.plain;
          }
          ptr += 1;
        }
      }

      if (this.bgCtx) {
        this.bgCtx.putImageData(this.imgData, 0, 0);
      } else {
        this.ctx.putImageData(this.imgData, 0, 0);
      }
      this.bgDirty = false;
    }

    if (this.bgCanvas) {
      this.ctx.drawImage(this.bgCanvas, 0, 0);
    }

    // 2. Render entities
    const visibleEntities = this.getVisibleEntities(displayPositions);
    let allyCount = 0;
    let enemyCount = 0;

    for (const entity of visibleEntities) {
      if (entity.team === 'blue') allyCount += 1;
      else enemyCount += 1;

      if (entity.category === 'building') {
        this.ctx.fillStyle = entity.team === 'blue' ? '#3b82f6' : '#ef4444';
        this.ctx.fillRect(entity.x, entity.y, entity.width, entity.height);
      } else {
        // Unit dot
        this.ctx.fillStyle = entity.team === 'blue' ? '#93c5fd' : '#fca5a5';
        // Render 2x2 dot centered on position
        this.ctx.fillRect(Math.floor(entity.x), Math.floor(entity.y), 2, 2);
      }
    }

    // 3. Render camera viewport rectangle
    const camRect = this.cameraToMinimapRect(worldView, cellSize, width, height);
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(
      Math.max(0, camRect.x),
      Math.max(0, camRect.y),
      Math.min(width - camRect.x, camRect.width),
      Math.min(height - camRect.y, camRect.height),
    );

    // 4. Update data attributes for debugging and automated E2E tests
    const centerCellX = Math.round((worldView.x + worldView.width / 2) / cellSize);
    const centerCellY = Math.round((worldView.y + worldView.height / 2) / cellSize);
    this.canvas.setAttribute('data-camera-center', `${centerCellX},${centerCellY}`);
    this.canvas.setAttribute('data-visible-allies', String(allyCount));
    this.canvas.setAttribute('data-visible-enemies', String(enemyCount));
  }
}
