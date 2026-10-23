import Phaser from 'phaser';
import { MAP_DEFINITION } from '../config/map';
import { BALANCE } from '../config/balance';
import { Simulation } from '../core/game/Simulation';
import { dispatchGroupMove, dispatchGroupAttackMove } from '../core/commands/dispatchGroupMove';
import { dispatchGroupAttack } from '../core/commands/dispatchGroupAttack';
import type { CommandResult } from '../core/commands/MoveCommand';
import type { BuildingEntity, BuildingKind, UnitEntity, UnitKind } from '../core/entities/EntityStore';
import type { MovementEvent } from '../core/systems/MovementSystem';
import { TICKS_PER_SECOND } from '../config/runtime';
import { SelectionModel } from '../input/SelectionModel';
import type { Point, Team, Terrain } from '../map/MapGrid';
import { VisualFog } from './VisualFog';
import { Minimap } from './Minimap';
import { SoundSystem } from './SoundSystem';
import { BarricadeTopology } from './BarricadeTopology';
import { registerBarricadeTextures } from './BarricadeVisuals';
import { TooltipManager } from './TooltipManager';
import {
  assignFormationSlots,
  getMarchDirection,
  isMilitaryKind,
  type FormationType,
  type FormationUnitInfo,
} from '../core/formations/FormationGeometry';
import { computeLineCells } from '../core/construction/LineGeometry';
import {
  availableUnitKey, BUILDING_VISUALS, buildingKey, FX_LIMITS, FX_VISUALS, frameCount,
  preloadTinySwords, RESOURCE_VISUALS, UNIT_VISUALS, WORLD_LAYER_DEPTHS,
  WORLD_VISUAL_METRICS, ySortedWorldDepth, barricadeTextureKey, builderUnitSheetKey, type UnitVisualState,
} from './VisualRegistry';

const CELL_SIZE = WORLD_VISUAL_METRICS.cellSize;
const PAN_SPEED = 500;
const MIN_ZOOM = 0.38;
const MAX_ZOOM = 2.5;
const UNIT_COLORS: Record<UnitKind, number> = {
  worker: 0xe8bb77, soldier: 0xf27769, archer: 0xa4d96c,
  shieldbearer: 0xb69ce3, scout: 0x69d7d5, builder: 0xdd8833,
};
const COLORS: Record<Terrain, number> = {
  plain: 0x659653,
  water: 0x4aa7a4,
  mountain: 0x77796f,
  forest: 0x4a7947,
  mine: 0xd5a64e,
  stone: 0x828b94,
};

function visualHash(x: number, y: number): number {
  return ((x * 73856093) ^ (y * 19349663) ^ 0x9e3779b9) >>> 0;
}

function hasDifferentTerrainNeighbor(getTerrain: (x: number, y: number) => Terrain | null, x: number, y: number, terrain: Terrain): boolean {
  return getTerrain(x - 1, y) !== terrain || getTerrain(x + 1, y) !== terrain
    || getTerrain(x, y - 1) !== terrain || getTerrain(x, y + 1) !== terrain;
}
const LABELS: Record<string, string> = {
  base: 'Base', worker: 'Operário', builder: 'Construtor', soldier: 'Soldado', shieldbearer: 'Escudeiro',
  scout: 'Batedor', archer: 'Arqueiro', house: 'Casa', barracks: 'Quartel', barricade: 'Barricada',
  tower: 'Torre de Vigilância',
};
const REJECTION_REASONS: Record<string, string> = {
  cooldown: 'aguarde a próxima ação',
  'no-path': 'não há caminho livre',
  'invalid-destination': 'destino bloqueado ou ocupado',
  'already-there': 'a unidade já está no destino',
  'insufficient-coins': 'moedas insuficientes',
  'insufficient-wood': 'madeira insuficiente',
  'insufficient-stone': 'pedra insuficiente',
  'target-not-visible': 'alvo fora da visão',
  'target-not-found': 'alvo não existe mais',
  'out-of-range': 'alvo fora do alcance',
  'out-of-build-range': 'construção a mais de 80 casas da base',
  'cannot-attack': 'esta unidade não ataca',
  'unit-cap': 'limite de população atingido',
  'unit-cap-reached': 'limite global de 60 unidades atingido',
  'civilian-capacity-reached': 'capacidade civil esgotada (construa Casas)',
  'military-capacity-reached': 'capacidade militar esgotada (construa Quartéis)',
  'not-builder': 'somente construtores podem construir barricadas, torres ou reparar',
  'building-limit-reached': 'limite de construções atingido',
  'building-at-max-hp': 'construção já com vida máxima',
};
function rejection(reason: string | undefined): string {
  return reason ? `${REJECTION_REASONS[reason] ?? reason} (${reason})` : 'motivo desconhecido';
}

function resourceCost(coins: number, wood: number, stone: number): string {
  return [coins > 0 ? `✦ ${coins}` : '', wood > 0 ? `▰ ${wood}` : '', stone > 0 ? `◆ ${stone}` : '']
    .filter(Boolean).join(' · ');
}

function formatMatchTime(ticks: number): string {
  const seconds = Math.floor(ticks / TICKS_PER_SECOND);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

interface MotionTrack {
  path: MovementEvent['path'];
  elapsedMs: number;
  durationMs: number;
}

interface AttackEffect {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  elapsedMs: number;
  totalMs: number;
  projectile?: Phaser.GameObjects.Image;
  impactKind: 'hit' | 'dust' | 'debris';
  targetId?: string;
  targetTeam: Team;
  targetCategory: 'unit' | 'building';
  targetKind: UnitKind | BuildingKind;
}

interface WorldEffect {
  kind: 'ring' | 'spark' | 'dust' | 'hit' | 'debris' | 'chips';
  x: number;
  y: number;
  team: Team;
  color: number;
  elapsedMs: number;
  totalMs: number;
  sprite?: Phaser.GameObjects.Image;
  priority: 0 | 1 | 2 | 3 | 4;
  sizeScale: number;
}

/** Map rendering and camera input; logical terrain remains in MapGrid. */
export class MapScene extends Phaser.Scene {
  // All DOM controls are scoped to this scene instance and removed on shutdown.
  private readonly domListeners = new AbortController();
  private readonly simulation = new Simulation(123, !new URLSearchParams(window.location.search).has('noai'));
  private readonly map = this.simulation.map;
  private readonly selection = new SelectionModel(this.simulation.entities, 'blue');
  private readonly visualFog = new VisualFog(this.map, this.simulation.entities, 'blue');
  private readonly minimap = new Minimap({ map: this.map, entities: this.simulation.entities, fog: this.visualFog, playerTeam: 'blue' });
  private dragStart: { x: number; y: number; worldX: number; worldY: number } | null = null;
  private lastPointer: { x: number; y: number } | null = null;
  private dragged = false;
  private dragMode: 'pan' | 'select' | 'barricade' | null = null;
  private mapGraphics!: Phaser.GameObjects.Graphics;
  private terrainTexture?: Phaser.GameObjects.RenderTexture;
  private terrainTiles?: Phaser.GameObjects.TileSprite;
  private readonly entitySprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly visibleSpriteIds = new Set<string>();
  private readonly spriteVisualCache = new Map<string, { key: string; frame: number; x: number; y: number; size: number; depth?: number }>();
  private readonly terrainDetails: Phaser.GameObjects.Image[] = [];
  private readonly mountainFoliage: Phaser.GameObjects.Image[] = [];
  private readonly mountainRidges: Phaser.GameObjects.Image[] = [];
  private readonly attackVisualUntil = new Map<string, number>();
  private readonly attackVisualStartedAt = new Map<string, number>();
  /** Presentation-only hit feedback; never affects simulation HP, targeting or fog. */
  private readonly damageFlashUntil = new Map<string, number>();
  private readonly lastMovementDustAt = new Map<string, number>();
  private movementDustSecond = -1;
  private movementDustCount = 0;
  private lastDetailBounds = '';
  private detailsDirty = true;
  private readonly lastEntityView = { x: NaN, y: NaN, width: NaN, height: NaN };
  private selectionGraphics!: Phaser.GameObjects.Graphics;
  private selectionBoxGraphics!: Phaser.GameObjects.Graphics;
  private entityGraphics!: Phaser.GameObjects.Graphics;
  private worldGraphics!: Phaser.GameObjects.Graphics;
  private fogGraphics!: Phaser.GameObjects.Graphics;
  private fogReliefGraphics!: Phaser.GameObjects.Graphics;
  private placementGhostGraphics!: Phaser.GameObjects.Graphics;
  private formationPreviewGraphics!: Phaser.GameObjects.Graphics;
  private placementMode: { kind: 'house' | 'barracks' | 'barricade' | 'tower'; width: number; height: number } | null = null;
  private barricadeDragStart: Point | null = null;
  private barricadeLineCells: Point[] = [];
  private barricadeLastEndCell: Point | null = null;
  private barricadeLineValidation: { valid: boolean; reason?: string } | null = null;
  private attackMoveMode = false;
  private rallyPlacementMode = false;
  private rallyBuildingId: string | null = null;
  private currentActionBarMode = 'none';
  private tooltipManager?: TooltipManager;
  private hoveredEntityId: string | null = null;
  private hoverTooltipTimer: number | null = null;
  private readonly displayPositions = new Map<string, { x: number; y: number }>();
  private readonly motionTracks = new Map<string, MotionTrack>();
  private readonly attackEffects: AttackEffect[] = [];
  private readonly worldEffects: WorldEffect[] = [];
  private readonly effectPool: Phaser.GameObjects.Image[] = [];
  private readonly projectilePool: Phaser.GameObjects.Image[] = [];
  private lastAmbientSecond = 0;
  private readonly soundSystem = new SoundSystem();
  private lastBlueWood = BALANCE.startingState.wood;
  private lastBlueCoins = BALANCE.startingState.coins;
  private lastBlueStone = BALANCE.startingState.stone ?? 0;
  private readonly lastVisibleEnemies = new Set<string>();
  private readonly underConstructionBuildingIds = new Set<string>();
  private readonly barricadeTopology = new BarricadeTopology();
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private readonly debug = new URLSearchParams(window.location.search).has('debug');
  private readonly fxDebug = new URLSearchParams(window.location.search).has('fxdebug');
  private resultShown = false;
  private lastVisibleCount = -1;
  private lastExploredCount = -1;
  private lastCamX = '';
  private lastCamY = '';
  private lastZoom = '';
  private lastPerformanceFrame = 0;

  constructor() {
    super('Map');
  }

  preload(): void {
    preloadTinySwords(this);
  }

  create(): void {
    this.events.once('shutdown', () => this.domListeners.abort());
    if (new URLSearchParams(window.location.search).has('perf')) this.events.once('create', () => this.installDiagnostics());
    const worldWidth = this.map.width * CELL_SIZE;
    const worldHeight = this.map.height * CELL_SIZE;
    this.cameras.main.setBackgroundColor('#47aaa7');
    registerBarricadeTextures(this);
    this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
    this.cameras.main.setZoom(this.getMapCoverZoom());
    this.cameras.main.centerOn((MAP_DEFINITION.teamStarts.blue.base[0] + 10) * CELL_SIZE, (MAP_DEFINITION.teamStarts.blue.base[1] + 2) * CELL_SIZE);
    const handleResize = () => {
      const camera = this.cameras.main;
      const minZoom = this.getMapCoverZoom();
      if (camera.zoom < minZoom) camera.setZoom(minZoom);
      camera.centerOn(camera.midPoint.x, camera.midPoint.y);
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, handleResize);
    this.events.once('shutdown', () => this.scale.off(Phaser.Scale.Events.RESIZE, handleResize));
    for (const entity of this.simulation.entities.all()) {
      if (entity.category === 'unit') this.displayPositions.set(entity.id, { x: entity.x, y: entity.y });
    }
    this.visualFog.update(this.displayPositions);
    const tiles = this.textures.get('tiny-terrain');
    const terrainHigh = this.textures.get('tiny-terrainHigh');
    for (const atlas of [tiles, terrainHigh]) {
      if (atlas?.key === '__MISSING') continue;
      if (!atlas.has('grass')) atlas.add('grass', 0, 64, 64, 64, 64);
      for (let row = 0; row < 6; row += 1) {
        for (let col = 0; col < 9; col += 1) {
          const frame = row * 9 + col;
          if (!atlas.has(String(frame))) atlas.add(String(frame), 0, col * 64, row * 64, 64, 64);
        }
      }
    }
    if (terrainHigh?.key !== '__MISSING') {
      if (!terrainHigh.has('cliff-left')) terrainHigh.add('cliff-left', 0, 320, 256, 64, 128);
      if (!terrainHigh.has('cliff-center')) terrainHigh.add('cliff-center', 0, 384, 256, 64, 128);
      if (!terrainHigh.has('cliff-right')) terrainHigh.add('cliff-right', 0, 448, 256, 64, 128);
      if (!terrainHigh.has('cliff-side')) terrainHigh.add('cliff-side', 0, 512, 256, 64, 128);
    }
    this.drawMap();
    this.fogGraphics = this.add.graphics();
    this.drawFog();
    this.fogReliefGraphics = this.add.graphics().setDepth(WORLD_LAYER_DEPTHS.fogRelief);
    this.entityGraphics = this.add.graphics();
    this.entityGraphics.setDepth(WORLD_LAYER_DEPTHS.entityOverlays);
    this.worldGraphics = this.add.graphics();
    this.worldGraphics.setDepth(WORLD_LAYER_DEPTHS.worldEffects);
    this.drawEntities();
    this.selectionGraphics = this.add.graphics();
    this.selectionGraphics.setDepth(WORLD_LAYER_DEPTHS.selection);
    this.selectionBoxGraphics = this.add.graphics();
    this.selectionBoxGraphics.setDepth(WORLD_LAYER_DEPTHS.interaction);
    this.placementGhostGraphics = this.add.graphics();
    this.placementGhostGraphics.setDepth(WORLD_LAYER_DEPTHS.interaction);
    this.formationPreviewGraphics = this.add.graphics();
    this.formationPreviewGraphics.setDepth(WORLD_LAYER_DEPTHS.interaction);
    this.refreshSelection();
    this.refreshTeamStatus();
    this.input.mouse?.disableContextMenu();
    (window as Window & { __simulation?: Simulation }).__simulation = this.simulation;
    if (this.fxDebug) this.installFxDebugPanel();

    const minimapCanvas = document.querySelector<HTMLCanvasElement>('#minimap');
    if (minimapCanvas) {
      this.minimap.attach(minimapCanvas, (cellX, cellY) => {
        this.centerCameraOn(cellX, cellY);
      });
    }
    this.events.on('shutdown', () => {
      this.minimap.detach();
    });

    const soundBtn = document.querySelector<HTMLButtonElement>('#btn-sound-toggle');
    const updateSoundBtn = () => {
      if (!soundBtn) return;
      const on = this.soundSystem.isEnabled();
      soundBtn.textContent = on ? '🔊' : '🔇';
      soundBtn.setAttribute('aria-label', on ? 'Desativar áudio' : 'Ativar áudio');
      soundBtn.dataset.tooltipDescription = on ? 'Os sons estão ativos. Clique para silenciar.' : 'O áudio está silenciado. Clique para ativar os sons.';
      soundBtn.classList.toggle('muted', !on);
    };
    updateSoundBtn();
    soundBtn?.addEventListener('click', () => {
      this.soundSystem.unlock();
      this.soundSystem.toggle();
      updateSoundBtn();
    }, { signal: this.domListeners.signal });

    const keyboard = this.input.keyboard;
    if (keyboard) {
      for (const name of ['W', 'A', 'S', 'D', 'UP', 'DOWN', 'LEFT', 'RIGHT']) {
        this.keys[name] = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes[name as keyof typeof Phaser.Input.Keyboard.KeyCodes]);
      }
    }

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.soundSystem.unlock();
      if (this.simulation.result) return;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.dragStart = { x: pointer.x, y: pointer.y, worldX: world.x, worldY: world.y };
      this.lastPointer = { x: pointer.x, y: pointer.y };
      this.dragged = false;

      if (this.placementMode?.kind === 'barricade' && pointer.button === 0) {
        const gx = Math.floor(world.x / CELL_SIZE);
        const gy = Math.floor(world.y / CELL_SIZE);
        this.barricadeDragStart = [gx, gy];
        this.barricadeLastEndCell = [gx, gy];
        this.barricadeLineCells = computeLineCells([gx, gy], [gx, gy], { width: this.map.width, height: this.map.height });
        const builder = this.selection.selectedEntities.find(
          (e): e is UnitEntity => e.category === 'unit' && e.kind === 'builder' && e.team === 'blue',
        );
        this.barricadeLineValidation = builder
          ? this.simulation.construction.validateBuildLine({
              type: 'build-line',
              team: 'blue',
              builderId: builder.id,
              buildingKind: 'barricade',
              cells: this.barricadeLineCells,
            }, this.simulation.clock.ticks)
          : { valid: false, reason: 'unknown-unit' };
        this.dragMode = 'barricade';
        return;
      }

      this.dragMode = pointer.button === 0 ? 'select' : 'pan';
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const pointerWorld = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      document.querySelector('#game')?.setAttribute('data-pointer-world', `${pointerWorld.x.toFixed(2)},${pointerWorld.y.toFixed(2)}`);
      if (this.simulation.result) return;
      if (!this.placementMode && !this.dragStart) this.updateWorldTooltip(pointer);
      if (this.placementMode) {
        if (this.placementMode.kind === 'barricade') {
          const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          const gx = Math.floor(world.x / CELL_SIZE);
          const gy = Math.floor(world.y / CELL_SIZE);
          const builder = this.selection.selectedEntities.find(
            (e): e is UnitEntity => e.category === 'unit' && e.kind === 'builder' && e.team === 'blue',
          );

          if (this.barricadeDragStart) {
            if (!this.barricadeLastEndCell || this.barricadeLastEndCell[0] !== gx || this.barricadeLastEndCell[1] !== gy) {
              this.barricadeLastEndCell = [gx, gy];
              this.barricadeLineCells = computeLineCells(this.barricadeDragStart, [gx, gy], { width: this.map.width, height: this.map.height });
              this.barricadeLineValidation = builder
                ? this.simulation.construction.validateBuildLine({
                    type: 'build-line',
                    team: 'blue',
                    builderId: builder.id,
                    buildingKind: 'barricade',
                    cells: this.barricadeLineCells,
                  }, this.simulation.clock.ticks)
                : { valid: false, reason: 'unknown-unit' };
            }
          } else {
            this.barricadeLineCells = [[gx, gy]];
            this.barricadeLineValidation = builder
              ? this.simulation.construction.validateBuildLine({
                  type: 'build-line',
                  team: 'blue',
                  builderId: builder.id,
                  buildingKind: 'barricade',
                  cells: this.barricadeLineCells,
                }, this.simulation.clock.ticks)
              : { valid: false, reason: 'unknown-unit' };
          }

          this.placementGhostGraphics.clear();
          const base = this.simulation.entities.get('blue-base');
          if (base && base.category === 'building') {
            const baseCenterPxX = (base.x + base.width / 2) * CELL_SIZE;
            const baseCenterPxY = (base.y + base.height / 2) * CELL_SIZE;
            this.placementGhostGraphics.lineStyle(1.5, 0x6da2b5, 0.35);
            this.placementGhostGraphics.strokeCircle(baseCenterPxX, baseCenterPxY, BALANCE.construction.maxDistanceFromBase * CELL_SIZE);
          }

          const isValid = this.barricadeLineValidation?.valid ?? false;
          const color = isValid ? 0x44dd88 : 0xdd4444;

          this.placementGhostGraphics.fillStyle(color, 0.35);
          this.placementGhostGraphics.lineStyle(2, color, 1);
          for (const [cx, cy] of this.barricadeLineCells) {
            this.placementGhostGraphics.fillRect(cx * CELL_SIZE, cy * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            this.placementGhostGraphics.strokeRect(cx * CELL_SIZE, cy * CELL_SIZE, CELL_SIZE, CELL_SIZE);
          }

          const count = this.barricadeLineCells.length;
          const woodCost = count * BALANCE.buildings.barricade.wood;
          const stoneCost = count * (BALANCE.buildings.barricade.stone ?? 0);
          const fb = document.querySelector('#command-feedback');
          if (fb) {
            if (this.barricadeDragStart) {
              fb.textContent = isValid
                ? `Linha de ${count} barricada(s) válida. Custo: ${woodCost} madeira, ${stoneCost} pedra.`
                : `Linha de ${count} barricada(s) inválida: ${rejection(this.barricadeLineValidation?.reason)} (Custo: ${woodCost}m, ${stoneCost}p).`;
            } else {
              fb.textContent = `Construir Barricada (${woodCost}m, ${stoneCost}p). Clique e arraste para traçar linha.`;
            }
          }
          return;
        }

        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const gx = Math.floor(world.x / CELL_SIZE);
        const gy = Math.floor(world.y / CELL_SIZE);
        const { kind, width, height } = this.placementMode;
        const config = BALANCE.buildings[kind];
        const stock = this.simulation.teams.blue;
        let valid = this.simulation.entities.isAreaFreeForBuilding(gx, gy, width, height)
          && stock.coins >= config.coins && stock.wood >= config.wood && stock.stone >= ((config as { stone?: number }).stone ?? 0);
        const base = this.simulation.entities.get('blue-base');
        let outOfBuildRange = false;
        if (base && base.category === 'building') {
          const baseCenterX = base.x + (base.width - 1) / 2;
          const baseCenterY = base.y + (base.height - 1) / 2;
          const buildCenterX = gx + (width - 1) / 2;
          const buildCenterY = gy + (height - 1) / 2;
          if (Math.hypot(buildCenterX - baseCenterX, buildCenterY - baseCenterY)
            > BALANCE.construction.maxDistanceFromBase) {
            valid = false;
            outOfBuildRange = true;
          }
        }
        for (let y = gy; y < gy + height; y += 1) {
          for (let x = gx; x < gx + width; x += 1) {
            if (this.simulation.fog.stateAt('blue', x, y) === 'unknown') valid = false;
          }
        }
        this.placementGhostGraphics.clear();
        if (base && base.category === 'building') {
          const baseCenterPxX = (base.x + base.width / 2) * CELL_SIZE;
          const baseCenterPxY = (base.y + base.height / 2) * CELL_SIZE;
          this.placementGhostGraphics.lineStyle(1.5, 0x6da2b5, 0.35);
          this.placementGhostGraphics.strokeCircle(baseCenterPxX, baseCenterPxY, BALANCE.construction.maxDistanceFromBase * CELL_SIZE);
        }
        const ghostCenterPxX = (gx + width / 2) * CELL_SIZE;
        const ghostCenterPxY = (gy + height / 2) * CELL_SIZE;
        this.placementGhostGraphics.lineStyle(1, valid ? 0x44dd88 : 0xdd4444, 0.35);
        if (this.placementMode.kind === 'tower') {
          const halfSpan = 9;
          this.placementGhostGraphics.strokeRect(
            (gx - halfSpan) * CELL_SIZE,
            (gy - halfSpan) * CELL_SIZE,
            20 * CELL_SIZE,
            20 * CELL_SIZE,
          );
        } else {
          this.placementGhostGraphics.strokeCircle(ghostCenterPxX, ghostCenterPxY, config.vision * CELL_SIZE);
        }
        this.placementGhostGraphics.fillStyle(valid ? 0x44dd88 : 0xdd4444, 0.35);
        this.placementGhostGraphics.fillRect(gx * CELL_SIZE, gy * CELL_SIZE, width * CELL_SIZE, height * CELL_SIZE);
        this.placementGhostGraphics.lineStyle(2, valid ? 0x44dd88 : 0xdd4444, 1);
        this.placementGhostGraphics.strokeRect(gx * CELL_SIZE, gy * CELL_SIZE, width * CELL_SIZE, height * CELL_SIZE);
        if (outOfBuildRange) {
          const fb = document.querySelector('#command-feedback');
          if (fb && fb.textContent !== 'Posição além do limite de 80 casas da Base.') {
            fb.textContent = 'Posição além do limite de 80 casas da Base.';
          }
        }
      }
      if (this.attackMoveMode) {
        this.placementGhostGraphics.clear();
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const gx = Math.floor(world.x / CELL_SIZE);
        const gy = Math.floor(world.y / CELL_SIZE);
        const cx = (gx + 0.5) * CELL_SIZE;
        const cy = (gy + 0.5) * CELL_SIZE;
        this.placementGhostGraphics.lineStyle(2, 0xff4444, 0.85);
        this.placementGhostGraphics.strokeCircle(cx, cy, CELL_SIZE * 0.6);
        this.placementGhostGraphics.lineStyle(1.5, 0xff4444, 0.9);
        this.placementGhostGraphics.lineBetween(cx - CELL_SIZE * 0.8, cy, cx + CELL_SIZE * 0.8, cy);
        this.placementGhostGraphics.lineBetween(cx, cy - CELL_SIZE * 0.8, cx, cy + CELL_SIZE * 0.8);
        this.placementGhostGraphics.fillStyle(0xff4444, 0.2);
        this.placementGhostGraphics.fillRect(gx * CELL_SIZE, gy * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
      if (this.rallyPlacementMode) {
        this.placementGhostGraphics.clear();
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const gx = Math.floor(world.x / CELL_SIZE);
        const gy = Math.floor(world.y / CELL_SIZE);
        const cx = (gx + 0.5) * CELL_SIZE;
        const cy = (gy + 0.5) * CELL_SIZE;
        this.placementGhostGraphics.lineStyle(2, 0xfacc15, 0.9);
        this.placementGhostGraphics.strokeCircle(cx, cy, CELL_SIZE * 0.5);
        this.placementGhostGraphics.fillStyle(0xfacc15, 0.25);
        this.placementGhostGraphics.fillRect(gx * CELL_SIZE, gy * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        this.placementGhostGraphics.lineStyle(2, 0xffffff, 0.9);
        this.placementGhostGraphics.lineBetween(cx, cy + 4, cx, cy - 10);
        this.placementGhostGraphics.fillStyle(0xfacc15, 0.95);
        this.placementGhostGraphics.fillTriangle(cx, cy - 10, cx + 8, cy - 7, cx, cy - 4);
      }

      // Render tactical formation preview when military units are selected
      const militaryUnits = this.selection.selectedEntities.filter(
        (e): e is UnitEntity => e.category === 'unit' && e.team === 'blue' && isMilitaryKind(e.kind) && e.hp > 0,
      );
      if (militaryUnits.length >= 2 && this.selection.formation !== null && !this.placementMode && !this.rallyPlacementMode && !this.dragged) {
        this.formationPreviewGraphics.clear();
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const gx = Math.floor(world.x / CELL_SIZE);
        const gy = Math.floor(world.y / CELL_SIZE);
        if (this.map.contains(gx, gy)) {
          let sumX = 0;
          let sumY = 0;
          for (const u of militaryUnits) {
            sumX += u.x;
            sumY += u.y;
          }
          const cx = Math.round(sumX / militaryUnits.length);
          const cy = Math.round(sumY / militaryUnits.length);
          const dir = getMarchDirection([cx, cy], [gx, gy]);
          const unitInfos: FormationUnitInfo[] = militaryUnits.map((u) => ({
            id: u.id,
            kind: u.kind,
            movement: u.movement,
            x: u.x,
            y: u.y,
          }));
          const slots = assignFormationSlots(unitInfos, this.selection.formation, [gx, gy], dir);
          for (const slot of slots) {
            const [sx, sy] = slot.destination;
            if (!this.map.contains(sx, sy)) continue;
            const px = sx * CELL_SIZE;
            const py = sy * CELL_SIZE;
            const isVanguard = slot.role === 'vanguard';
            const color = isVanguard ? 0x38bdf8 : 0x0284c7;
            this.formationPreviewGraphics.fillStyle(color, 0.28);
            this.formationPreviewGraphics.fillRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2);
            this.formationPreviewGraphics.lineStyle(1, color, 0.7);
            this.formationPreviewGraphics.strokeRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2);
          }
        }
      } else {
        this.formationPreviewGraphics.clear();
      }

      if (!pointer.isDown || !this.dragStart || !this.lastPointer) return;
      if (Math.hypot(pointer.x - this.dragStart.x, pointer.y - this.dragStart.y) > 4) this.dragged = true;
      if (this.dragged && this.dragMode === 'pan') {
        this.cameras.main.scrollX -= (pointer.x - this.lastPointer.x) / this.cameras.main.zoom;
        this.cameras.main.scrollY -= (pointer.y - this.lastPointer.y) / this.cameras.main.zoom;
      } else if (this.dragged && this.dragMode === 'select' && !this.placementMode && !this.attackMoveMode && !this.rallyPlacementMode) {
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.drawSelectionBox(this.dragStart.worldX, this.dragStart.worldY, world.x, world.y);
      }
      this.lastPointer = { x: pointer.x, y: pointer.y };
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (this.simulation.result) return;
      if (this.rallyPlacementMode) {
        if (pointer.button === 0 && !this.dragged) {
          const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          const destination: Point = [Math.floor(world.x / CELL_SIZE), Math.floor(world.y / CELL_SIZE)];
          if (this.rallyBuildingId) {
            const b = this.simulation.entities.get(this.rallyBuildingId);
            const bLabel = b && b.category === 'building' ? LABELS[b.kind] : 'Construção';
            const res = this.simulation.issueCommand({
              type: 'set-rally-point',
              team: 'blue',
              buildingId: this.rallyBuildingId,
              point: destination,
            });
            if (res.accepted) this.soundSystem.play('order');
            const feedback = document.querySelector('#command-feedback');
            if (feedback) {
              feedback.textContent = res.accepted
                ? `Ponto de reunião da ${bLabel} definido para (${destination.join(', ')}).`
                : `Ponto de reunião indisponível: ${rejection(res.reason)}.`;
            }
          }
        } else if (pointer.button === 2) {
          const feedback = document.querySelector('#command-feedback');
          if (feedback) feedback.textContent = 'Definição de ponto de reunião cancelada.';
        }
        this.rallyPlacementMode = false;
        this.rallyBuildingId = null;
        this.placementGhostGraphics.clear();
        this.dragStart = null;
        this.lastPointer = null;
        this.dragMode = null;
        this.selectionBoxGraphics.clear();
        this.refreshSelection();
        this.refreshTeamStatus();
        return;
      }
      if (this.attackMoveMode) {
        if (pointer.button === 0 && !this.dragged) {
          const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          const destination: [number, number] = [Math.floor(world.x / CELL_SIZE), Math.floor(world.y / CELL_SIZE)];
          const results = dispatchGroupAttackMove(this.simulation, 'blue', this.selection.selectedIds, destination, this.selection.formation);
          const accepted = results.filter((item) => item.result.accepted).length;
          if (accepted > 0) {
            this.soundSystem.play('order');
            this.addWorldEffect('ring', (destination[0] + 0.5) * CELL_SIZE, (destination[1] + 0.5) * CELL_SIZE, 'blue', 0xff4d4f, FX_VISUALS.orderDurationMs, 1);
          }
          const feedback = document.querySelector('#command-feedback');
          if (feedback) {
            feedback.textContent = results.length === 0
              ? 'Selecione uma unidade azul para Attack Move.'
              : accepted > 0
                ? `${accepted} ordem(ns) de Attack Move enviada(s) para (${destination.join(', ')}).`
                : `Attack Move indisponível: ${results[0].result.accepted ? '' : rejection(results[0].result.reason)}.`;
          }
        } else if (pointer.button === 2) {
          const feedback = document.querySelector('#command-feedback');
          if (feedback) feedback.textContent = 'Modo Attack Move cancelado.';
        }
        this.attackMoveMode = false;
        this.placementGhostGraphics.clear();
        this.formationPreviewGraphics.clear();
        this.dragStart = null;
        this.lastPointer = null;
        this.dragMode = null;
        this.selectionBoxGraphics.clear();
        this.refreshSelection();
        this.refreshTeamStatus();
        return;
      }
      if (this.placementMode) {
        if (this.placementMode.kind === 'barricade') {
          if (pointer.button === 0) {
            const builder = this.selection.selectedEntities.find(
              (e): e is UnitEntity => e.category === 'unit' && e.kind === 'builder' && e.team === 'blue',
            );
            if (builder && this.barricadeLineCells.length > 0) {
              if (this.barricadeLineValidation?.valid) {
                const result = this.simulation.issueCommand({
                  type: 'build-line',
                  team: 'blue',
                  builderId: builder.id,
                  buildingKind: 'barricade',
                  cells: this.barricadeLineCells,
                });
                if (result.accepted) this.soundSystem.play('order');
                const feedback = document.querySelector('#command-feedback');
                if (feedback) {
                  feedback.textContent = result.accepted
                    ? (this.barricadeLineCells.length === 1
                        ? 'Construção de Barricada iniciada.'
                        : `Construção de ${this.barricadeLineCells.length} barricadas iniciada!`)
                    : `Construção indisponível: ${rejection(result.reason)}.`;
                }
              } else {
                const feedback = document.querySelector('#command-feedback');
                if (feedback) {
                  feedback.textContent = `Linha de barricadas inválida: ${rejection(this.barricadeLineValidation?.reason)}. Ordem cancelada.`;
                }
              }
            }
          } else if (pointer.button === 2) {
            const feedback = document.querySelector('#command-feedback');
            if (feedback) feedback.textContent = 'Modo de construção de barricada cancelado.';
          }
          this.placementMode = null;
          this.barricadeDragStart = null;
          this.barricadeLineCells = [];
          this.barricadeLastEndCell = null;
          this.barricadeLineValidation = null;
          this.placementGhostGraphics.clear();
          this.dragStart = null;
          this.lastPointer = null;
          this.dragMode = null;
          this.selectionBoxGraphics.clear();
          this.refreshSelection();
          this.refreshTeamStatus();
          return;
        }

        if (pointer.button === 0 && !this.dragged) {
          const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          const gx = Math.floor(world.x / CELL_SIZE);
          const gy = Math.floor(world.y / CELL_SIZE);
          const builder = this.selection.selectedEntities.find(
            (e): e is UnitEntity => e.category === 'unit' && (e.kind === 'builder' || e.kind === 'worker') && e.team === 'blue',
          );
          if (builder) {
            const result = this.simulation.issueCommand({
              type: 'build',
              team: 'blue',
              builderId: builder.id,
              buildingKind: this.placementMode.kind,
              position: [gx, gy],
            });
            if (result.accepted) this.soundSystem.play('order');
            const feedback = document.querySelector('#command-feedback');
            if (feedback) feedback.textContent = result.accepted
              ? `Construção de ${LABELS[this.placementMode.kind]} iniciada em (${gx}, ${gy}).`
              : `Construção indisponível: ${rejection(result.reason)}.`;
          }
        } else if (pointer.button === 2) {
          const feedback = document.querySelector('#command-feedback');
          if (feedback) feedback.textContent = 'Modo de construção cancelado.';
        }
        this.placementMode = null;
        this.placementGhostGraphics.clear();
        this.dragStart = null;
        this.lastPointer = null;
        this.dragMode = null;
        this.selectionBoxGraphics.clear();
        this.refreshSelection();
        this.refreshTeamStatus();
        return;
      }

      if (this.dragMode === 'select' && this.dragStart) {
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const shift = pointer.event.shiftKey;
        if (this.dragged) {
          this.selection.selectRect(
            Math.floor(this.dragStart.worldX / CELL_SIZE), Math.floor(this.dragStart.worldY / CELL_SIZE),
            Math.floor(world.x / CELL_SIZE), Math.floor(world.y / CELL_SIZE), shift,
          );
        } else {
          this.selection.selectAt(Math.floor(world.x / CELL_SIZE), Math.floor(world.y / CELL_SIZE), shift);
          if (this.debug) this.inspect(pointer);
        }
        this.soundSystem.play('click');
        this.refreshSelection();
      } else if (this.dragMode === 'pan' && !this.dragged && pointer.button === 2) {
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const destination: [number, number] = [Math.floor(world.x / CELL_SIZE), Math.floor(world.y / CELL_SIZE)];
        const clickedEntity = this.simulation.entities.atCell(destination[0], destination[1]);
        const isEnemyVisible = clickedEntity && clickedEntity.team !== 'blue' && this.visualFog.isEntityVisible(clickedEntity);
        if (isEnemyVisible && clickedEntity) {
          const results = dispatchGroupAttack(this.simulation, 'blue', this.selection.selectedIds, clickedEntity.id);
          const accepted = results.filter((item) => item.result.accepted).length;
          if (accepted > 0) {
            this.soundSystem.play('order');
            const targetX = clickedEntity.category === 'unit' ? clickedEntity.x + 0.5 : clickedEntity.x + clickedEntity.width / 2;
            const targetY = clickedEntity.category === 'unit' ? clickedEntity.y + 0.5 : clickedEntity.y + clickedEntity.height / 2;
            this.addWorldEffect('ring', targetX * CELL_SIZE, targetY * CELL_SIZE,
              'blue', 0xe76d5e, FX_VISUALS.orderDurationMs, 1);
          }
          const feedback = document.querySelector('#command-feedback');
          if (feedback) feedback.textContent = results.length === 0
            ? 'Selecione uma unidade azul para atacar.'
            : accepted > 0 ? `${accepted} ordem(ns) de ataque contra ${LABELS[clickedEntity.kind]} enviada(s).`
              : `Ataque indisponível: ${results[0].result.accepted ? '' : rejection(results[0].result.reason)}.`;
          this.refreshSelection();
          this.refreshTeamStatus();
          this.dragStart = null;
          this.lastPointer = null;
          this.dragMode = null;
          this.selectionBoxGraphics.clear();
          return;
        }

        const selectedUnits = this.selection.selectedIds
          .map((id) => this.simulation.entities.get(id))
          .filter((e): e is UnitEntity => e?.category === 'unit' && e.team === 'blue');
        const builders = selectedUnits.filter((u) => u.kind === 'builder');
        if (clickedEntity && clickedEntity.team === 'blue' && clickedEntity.category === 'building' && builders.length > 0) {
          if (clickedEntity.hp < clickedEntity.maxHp && !clickedEntity.underConstruction) {
            let acceptedCount = 0;
            let lastFailure: CommandResult = { accepted: true };
            for (const b of builders) {
              const res = this.simulation.issueCommand({
                type: 'repair', team: 'blue', builderId: b.id, buildingId: clickedEntity.id,
              });
              if (res.accepted) {
                acceptedCount += 1;
              } else {
                lastFailure = res;
              }
            }
            if (acceptedCount > 0) this.soundSystem.play('order');
            const feedback = document.querySelector('#command-feedback');
            if (feedback) feedback.textContent = acceptedCount > 0
              ? `${acceptedCount > 1 ? `${acceptedCount} construtores iniciando reparo` : 'Reparo'} de ${LABELS[clickedEntity.kind]} iniciado.`
              : `Reparo indisponível: ${lastFailure.accepted ? '' : rejection(lastFailure.reason)}.`;
            this.refreshSelection();
            this.refreshTeamStatus();
            this.dragStart = null;
            this.lastPointer = null;
            this.dragMode = null;
            this.selectionBoxGraphics.clear();
            return;
          }
        }

        const selectedBuilding = this.selection.selectedEntities.find(
          (e): e is BuildingEntity => e.category === 'building' && e.team === 'blue' && (e.kind === 'house' || e.kind === 'barracks'),
        );
        if (selectedBuilding && selectedUnits.length === 0) {
          const res = this.simulation.issueCommand({
            type: 'set-rally-point',
            team: 'blue',
            buildingId: selectedBuilding.id,
            point: destination,
          });
          if (res.accepted) this.soundSystem.play('order');
          const feedback = document.querySelector('#command-feedback');
          if (feedback) {
            feedback.textContent = res.accepted
              ? `Ponto de reunião da ${LABELS[selectedBuilding.kind]} definido para (${destination.join(', ')}).`
              : `Ponto de reunião indisponível: ${rejection(res.reason)}.`;
          }
          this.refreshSelection();
          this.dragStart = null;
          this.lastPointer = null;
          this.dragMode = null;
          this.selectionBoxGraphics.clear();
          return;
        }

        const terrain = this.visualFog.cellAt(destination[0], destination[1])?.terrain;
        const known = this.visualFog.stateAt(destination[0], destination[1]) !== 'unknown';
        const hasWorker = selectedUnits.some((u) => u.kind === 'worker');
        const workType = hasWorker && known && terrain === 'mine' ? 'mine' : hasWorker && known && (terrain === 'forest' || terrain === 'stone') ? 'gather' : null;
        const results = workType
          ? this.selection.selectedIds.map((unitId) => ({ unitId, result: this.simulation.issueCommand({
            type: workType, team: 'blue', unitId, target: destination,
          }) }))
          : dispatchGroupMove(this.simulation, 'blue', this.selection.selectedIds, destination, false, this.selection.formation);
        const accepted = results.filter((item) => item.result.accepted).length;
        if (accepted > 0) {
          this.soundSystem.play('order');
          this.addWorldEffect('ring', (destination[0] + 0.5) * CELL_SIZE, (destination[1] + 0.5) * CELL_SIZE, 'blue', workType ? 0xfacc15 : 0x55ff55, FX_VISUALS.orderDurationMs, 1);
        }
        const feedback = document.querySelector('#command-feedback');
        const workLabel = workType === 'mine' ? 'mina' : workType === 'gather' ? (terrain === 'stone' ? 'coleta de pedra' : 'coleta') : 'movimento';
        if (feedback) feedback.textContent = results.length === 0
          ? 'Selecione uma unidade azul para mover.'
          : accepted > 0 ? `${accepted} ordem(ns) de ${workLabel} recebida(s) para (${destination.join(', ')}).`
            : `Ordem indisponível: ${results[0].result.accepted ? '' : rejection(results[0].result.reason)}.`;
        this.refreshSelection();
      }
      this.dragStart = null;
      this.lastPointer = null;
      this.dragMode = null;
      this.selectionBoxGraphics.clear();
      this.formationPreviewGraphics.clear();
    });
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      if (this.simulation.result) return;
      const camera = this.cameras.main;
      camera.setZoom(Phaser.Math.Clamp(camera.zoom * (dy < 0 ? 1.15 : 1 / 1.15), this.getMapCoverZoom(), MAX_ZOOM));
    });

    this.input.keyboard?.on('keydown-A', () => {
      if (this.simulation.result) return;
      const blueUnits = this.selection.selectedEntities.filter((e): e is UnitEntity => e.category === 'unit' && e.team === 'blue');
      if (blueUnits.length > 0) {
        this.toggleAttackMoveMode();
      }
    });

    const onEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector<HTMLDialogElement>('#help-dialog')?.open) {
        this.handleEscape();
      }
    };
    window.addEventListener('keydown', onEscapeKey, { signal: this.domListeners.signal });
    this.events.on('shutdown', () => {
      window.removeEventListener('keydown', onEscapeKey);
    });

    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if (this.simulation.result) return;
      const key = event.key;
      if (key >= '1' && key <= '9') {
        const digit = parseInt(key, 10);
        if (event.ctrlKey) {
          const recorded = this.selection.recordControlGroup(digit);
          const feedback = document.querySelector('#command-feedback');
          if (feedback) {
            feedback.textContent = recorded
              ? `Grupo de controle ${digit} gravado (${this.selection.getControlGroup(digit).length} tropas).`
              : `Grupo de controle ${digit} limpo.`;
          }
          if (recorded) this.soundSystem.play('click');
        } else {
          const selected = this.selection.selectControlGroup(digit, event.shiftKey);
          if (selected) {
            this.soundSystem.play('click');
            const feedback = document.querySelector('#command-feedback');
            if (feedback) {
              feedback.textContent = `Grupo ${digit} selecionado (${this.selection.selectedIds.length} tropas).`;
            }
            this.refreshSelection();
          }
        }
      }
    });

    document.querySelector('#game')?.setAttribute('data-ready', 'true');
    document.querySelector('#inspect')?.toggleAttribute('hidden', !this.debug);
    document.querySelector('#ai-debug')?.toggleAttribute('hidden', !this.debug);
    this.setupSandboxControls();
    this.tooltipManager = new TooltipManager();
    const commandFeedback = document.querySelector<HTMLElement>('#command-feedback');
    commandFeedback?.classList.remove('is-visible', 'is-warning');
    let feedbackTimer: number | null = null;
    const feedbackObserver = commandFeedback ? new MutationObserver(() => {
      const message = commandFeedback.textContent?.trim() ?? '';
      commandFeedback.classList.toggle('is-visible', message.length > 0);
      commandFeedback.classList.toggle('is-warning', /indisponível|inválid|bloquead|insuficient|erro/i.test(message));
      if (feedbackTimer !== null) window.clearTimeout(feedbackTimer);
      feedbackTimer = message ? window.setTimeout(() => {
        commandFeedback.classList.remove('is-visible');
        feedbackTimer = null;
      }, /indisponível|inválid|bloquead|insuficient|erro/i.test(message) ? 5200 : 3600) : null;
    }) : null;
    feedbackObserver?.observe(commandFeedback!, { childList: true, characterData: true, subtree: true });
    this.events.once('shutdown', () => {
      feedbackObserver?.disconnect();
      if (feedbackTimer !== null) window.clearTimeout(feedbackTimer);
    });
    const gameCanvas = document.querySelector<HTMLCanvasElement>('#game canvas');
    const hideWorldTooltip = () => {
      this.hoveredEntityId = null;
      if (this.hoverTooltipTimer !== null) window.clearTimeout(this.hoverTooltipTimer);
      this.hoverTooltipTimer = null;
      this.tooltipManager?.hideAt();
    };
    gameCanvas?.addEventListener('pointerleave', hideWorldTooltip, { signal: this.domListeners.signal });
    this.events.once('shutdown', () => {
      gameCanvas?.removeEventListener('pointerleave', hideWorldTooltip);
      this.tooltipManager?.destroy();
      if (this.hoverTooltipTimer !== null) window.clearTimeout(this.hoverTooltipTimer);
      this.tooltipManager = undefined;
    });
    this.setupHelpControls();
  }

  private setupHelpControls(): void {
    const button = document.querySelector<HTMLButtonElement>('#btn-help');
    const closeButton = document.querySelector<HTMLButtonElement>('#btn-close-help');
    const dialog = document.querySelector<HTMLDialogElement>('#help-dialog');
    button?.addEventListener('click', () => dialog?.showModal(), { signal: this.domListeners.signal });
    closeButton?.addEventListener('click', () => dialog?.close(), { signal: this.domListeners.signal });
    dialog?.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    }, { signal: this.domListeners.signal });
  }

  private setupSandboxControls(): void {
    const isSandboxQuery = new URLSearchParams(window.location.search).has('sandbox')
      || new URLSearchParams(window.location.search).has('test')
      || window.location.port === '5174';

    const panel = document.querySelector<HTMLElement>('#sandbox-section');
    const toggleBtn = document.querySelector<HTMLButtonElement>('#btn-toggle-sandbox');
    const feedback = document.querySelector<HTMLElement>('#command-feedback');

    const setMsg = (text: string) => {
      if (feedback) feedback.textContent = text;
    };

    const togglePanel = (show?: boolean) => {
      if (!panel || !toggleBtn) return;
      const willShow = show ?? panel.hasAttribute('hidden');
      if (willShow) {
        panel.removeAttribute('hidden');
        toggleBtn.classList.add('active');
      } else {
        panel.setAttribute('hidden', '');
        toggleBtn.classList.remove('active');
      }
    };

    toggleBtn?.addEventListener('click', () => togglePanel(), { signal: this.domListeners.signal });

    if (isSandboxQuery) {
      togglePanel(true);
      this.simulation.addResources('blue', 10000, 10000, 10000);
      this.refreshTeamStatus();
      setMsg('Ambiente de Testes / Sandbox carregado! Recursos extras liberados.');
    }

    // 1. Recursos
    document.querySelector('#sb-add-res')?.addEventListener('click', () => {
      this.simulation.addResources('blue', 5000, 5000, 5000);
      this.refreshTeamStatus();
      setMsg('Sandbox: +5.000 moedas, madeira e pedra adicionados!');
    }, { signal: this.domListeners.signal });

    document.querySelector('#sb-inf-res')?.addEventListener('click', () => {
      this.simulation.teams.blue.coins = 99999;
      this.simulation.teams.blue.wood = 99999;
      this.simulation.teams.blue.stone = 99999;
      this.refreshTeamStatus();
      setMsg('Sandbox: Recursos definidos para 99.999!');
    }, { signal: this.domListeners.signal });

    // 2. Produção e Obra Instantânea
    const fastProd = document.querySelector<HTMLInputElement>('#sb-fast-prod');
    fastProd?.addEventListener('change', () => {
      this.simulation.production.instantProduction = !!fastProd.checked;
      setMsg(`Sandbox: Treino instantâneo ${fastProd.checked ? 'ATIVADO' : 'desativado'}.`);
    }, { signal: this.domListeners.signal });

    const fastBuild = document.querySelector<HTMLInputElement>('#sb-fast-build');
    fastBuild?.addEventListener('change', () => {
      this.simulation.construction.instantBuild = !!fastBuild.checked;
      setMsg(`Sandbox: Obra instantânea ${fastBuild.checked ? 'ATIVADA' : 'desativada'}.`);
    }, { signal: this.domListeners.signal });

    // 3. Velocidade
    const speedButtons = [
      { id: '#sb-speed-1', speed: 1 },
      { id: '#sb-speed-2', speed: 2 },
      { id: '#sb-speed-4', speed: 4 },
    ];
    for (const { id, speed } of speedButtons) {
      document.querySelector(id)?.addEventListener('click', (e) => {
        this.simulation.gameSpeed = speed;
        document.querySelectorAll('.btn-speed').forEach((btn) => btn.classList.remove('active'));
        (e.currentTarget as HTMLElement)?.classList.add('active');
        setMsg(`Sandbox: Velocidade ajustada para ${speed}x.`);
      }, { signal: this.domListeners.signal });
    }

    // 4. Spawns Instantâneos (Azul)
    const unitSpawns: Array<{ id: string; kind: import('../core/entities/EntityStore').UnitKind }> = [
      { id: '#sb-spawn-soldier', kind: 'soldier' },
      { id: '#sb-spawn-archer', kind: 'archer' },
      { id: '#sb-spawn-shield', kind: 'shieldbearer' },
      { id: '#sb-spawn-scout', kind: 'scout' },
      { id: '#sb-spawn-builder', kind: 'builder' },
      { id: '#sb-spawn-worker', kind: 'worker' },
    ];
    for (const { id, kind } of unitSpawns) {
      document.querySelector(id)?.addEventListener('click', () => {
        const u = this.simulation.instantSpawn('blue', kind);
        if (u) {
          this.displayPositions.set(u.id, { x: u.x, y: u.y });
          this.drawEntities();
          this.refreshTeamStatus();
          setMsg(`Sandbox: ${LABELS[kind]} azul gerado em (${u.x}, ${u.y})!`);
        }
      }, { signal: this.domListeners.signal });
    }

    document.querySelector('#sb-spawn-squad')?.addEventListener('click', () => {
      for (let i = 0; i < 5; i++) {
        const u = this.simulation.instantSpawn('blue', 'soldier');
        if (u) this.displayPositions.set(u.id, { x: u.x, y: u.y });
      }
      this.drawEntities();
      this.refreshTeamStatus();
      setMsg('Sandbox: Esquadrão de 5 soldados azuis gerado na base!');
    }, { signal: this.domListeners.signal });

    document.querySelector('#sb-spawn-mixed-army')?.addEventListener('click', () => {
      const kinds: import('../core/entities/EntityStore').UnitKind[] = [
        'shieldbearer', 'shieldbearer',
        'soldier', 'soldier', 'soldier', 'soldier',
        'archer', 'archer',
        'scout', 'scout',
      ];
      for (const kind of kinds) {
        const u = this.simulation.instantSpawn('blue', kind);
        if (u) this.displayPositions.set(u.id, { x: u.x, y: u.y });
      }
      this.drawEntities();
      this.refreshTeamStatus();
      setMsg('Sandbox: Exército misto de 10 tropas (2 escudeiros, 4 soldados, 2 arqueiros, 2 batedores) gerado!');
    }, { signal: this.domListeners.signal });

    // 5. Inimigos & IA
    document.querySelector('#sb-spawn-enemy-squad')?.addEventListener('click', () => {
      for (let i = 0; i < 3; i++) {
        const u = this.simulation.instantSpawn('red', 'soldier', 90, 98 + i);
        if (u) this.displayPositions.set(u.id, { x: u.x, y: u.y });
      }
      this.drawEntities();
      setMsg('Sandbox: 3 soldados inimigos vermelhos gerados no centro do mapa!');
    }, { signal: this.domListeners.signal });

    const aiToggleBtn = document.querySelector<HTMLButtonElement>('#sb-toggle-ai');
    aiToggleBtn?.addEventListener('click', () => {
      this.simulation.aiPaused = !this.simulation.aiPaused;
      if (aiToggleBtn) {
        aiToggleBtn.textContent = this.simulation.aiPaused ? 'Retomar IA' : 'Pausar IA';
      }
      setMsg(`Sandbox: IA Vermelha ${this.simulation.aiPaused ? 'PAUSADA' : 'RETOMADA'}.`);
    }, { signal: this.domListeners.signal });

    // 6. Revelar Mapa
    const revealCheck = document.querySelector<HTMLInputElement>('#sb-reveal-map');
    revealCheck?.addEventListener('change', () => {
      this.visualFog.revealAll = !!revealCheck.checked;
      this.detailsDirty = true;
      this.lastDetailBounds = '';
      this.drawFog();
      this.drawEntities();
      this.minimap.render(this.cameras.main.worldView, CELL_SIZE, this.displayPositions, true);
      setMsg(`Sandbox: Visão de mapa inteiro ${revealCheck.checked ? 'ATIVADA' : 'desativada'}.`);
    }, { signal: this.domListeners.signal });
  }

  private toggleAttackMoveMode(): void {
    this.placementMode = null;
    this.rallyPlacementMode = false;
    this.rallyBuildingId = null;
    this.attackMoveMode = !this.attackMoveMode;
    this.placementGhostGraphics.clear();
    const fb = document.querySelector('#command-feedback');
    if (fb) {
      fb.textContent = this.attackMoveMode
        ? 'Modo Attack Move ativado: clique com botão esquerdo no mapa para definir o destino. Botão direito cancela.'
        : 'Modo Attack Move cancelado.';
    }
    this.refreshSelection();
  }

  private toggleRallyPlacementMode(buildingId: string): void {
    if (this.rallyPlacementMode && this.rallyBuildingId === buildingId) {
      this.rallyPlacementMode = false;
      this.rallyBuildingId = null;
      this.placementGhostGraphics.clear();
      const fb = document.querySelector('#command-feedback');
      if (fb) fb.textContent = 'Definição de ponto de reunião cancelada.';
    } else {
      this.rallyPlacementMode = true;
      this.rallyBuildingId = buildingId;
      this.attackMoveMode = false;
      this.placementMode = null;
      const building = this.simulation.entities.get(buildingId);
      const bLabel = building && building.category === 'building' ? LABELS[building.kind] : 'Construção';
      const fb = document.querySelector('#command-feedback');
      if (fb) fb.textContent = `Clique no mapa para definir o Ponto de Reunião da ${bLabel}. Botão direito cancela.`;
    }
    this.refreshSelection();
  }

  private drawDashedLine(
    graphics: Phaser.GameObjects.Graphics,
    x1: number, y1: number, x2: number, y2: number,
    dashLength = 6, gapLength = 4,
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    const dirX = dx / distance;
    const dirY = dy / distance;
    let current = 0;
    while (current < distance) {
      const startX = x1 + dirX * current;
      const startY = y1 + dirY * current;
      const endDist = Math.min(current + dashLength, distance);
      const endX = x1 + dirX * endDist;
      const endY = y1 + dirY * endDist;
      graphics.lineBetween(startX, startY, endX, endY);
      current += dashLength + gapLength;
    }
  }

  update(_time: number, delta: number): void {
    let barricadeCompleted = false;
    if (this.simulation.diagnostics.enabled) {
      const now = performance.now();
      if (this.lastPerformanceFrame) this.simulation.diagnostics.record('frameInterval', now - this.lastPerformanceFrame);
      this.lastPerformanceFrame = now;
    }
    const ticks = this.simulation.advance(delta, 5);
    if (ticks > 0) {
      const timer = document.querySelector('#match-timer');
      if (timer) timer.textContent = formatMatchTime(this.simulation.clock.ticks);
    }
    if (this.simulation.result && !this.resultShown) this.showResult();
    const movementEvents = this.simulation.movement.drainEvents();
    const movementFailures = this.simulation.movement.drainFailures().filter((event) => this.simulation.entities.get(event.unitId)?.team === 'blue');
    if (movementFailures.length > 0) {
      const feedback = document.querySelector('#command-feedback');
      const failure = movementFailures[0];
      if (feedback) feedback.textContent = `Marcha interrompida: ${failure.unitId} · ${rejection(failure.reason)}.`;
    }
    for (const event of movementEvents) {
      const unit = this.simulation.entities.get(event.unitId);
      if (unit?.category !== 'unit') continue;
      this.motionTracks.set(event.unitId, {
        path: event.path, elapsedMs: 0,
        durationMs: unit.movementCooldownSeconds * 1000,
      });
      const start = event.path[0];
      const second = Math.floor(this.simulation.clock.ticks / TICKS_PER_SECOND);
      if (second !== this.movementDustSecond) {
        this.movementDustSecond = second;
        this.movementDustCount = 0;
      }
      const lastDustAt = this.lastMovementDustAt.get(unit.id) ?? Number.NEGATIVE_INFINITY;
      if (start && this.movementDustCount < 12 && this.time.now - lastDustAt >= 700) {
        this.addWorldEffect('dust', (start[0] + 0.5) * CELL_SIZE,
          (start[1] + 0.5) * CELL_SIZE, unit.team, 0xa6bdc4, 300, 0);
        this.lastMovementDustAt.set(unit.id, this.time.now);
        this.movementDustCount += 1;
      }
    }
    this.updateMotion(delta);

    const combatEvents = this.simulation.combat.drainEvents();
    for (const event of combatEvents) {
      const target = this.simulation.entities.get(event.targetId);
      const attacker = this.simulation.entities.get(event.attackerId);
      if (event.targetId === 'blue-base') {
        this.soundSystem.play('baseUnderAttack');
      } else if (target?.category === 'building') {
        this.soundSystem.play('buildingAttack');
      } else if (attacker?.category === 'unit' && attacker.kind === 'archer') {
        this.soundSystem.play('rangedAttack');
      } else {
        this.soundSystem.play('meleeAttack');
      }

      const attackerX = (event.attackerX + 0.5) * CELL_SIZE;
      const attackerY = (event.attackerY + 0.5) * CELL_SIZE;
      const targetX = (event.targetX + 0.5) * CELL_SIZE;
      const targetY = (event.targetY + 0.5) * CELL_SIZE;
      if (!this.isWorldPointVisible(event.attackerTeam, attackerX, attackerY)
        || !this.isWorldPointVisible(event.targetTeam, targetX, targetY)) continue;

      this.attackVisualUntil.set(event.attackerId, this.time.now + 420);
      this.attackVisualStartedAt.set(event.attackerId, this.time.now);
      // Melee flashes on contact; arrows flash only when their projectile reaches its target.
      if (!event.targetDied && event.attackerKind !== 'archer') {
        this.damageFlashUntil.set(event.targetId, this.time.now + 115);
      }
      if (event.reflectedDamage > 0 && !event.attackerDied) {
        this.damageFlashUntil.set(event.attackerId, this.time.now + 115);
      }
      const arrowKey = event.attackerTeam === 'blue' ? 'tiny-arrowYellow' : 'tiny-arrowRed';
      const isArrow = event.attackerKind === 'archer';
      const projectile = isArrow
        ? this.acquireProjectile(this.textures.exists(arrowKey) ? arrowKey : this.fallbackArrowKey()) : undefined;
      let projectileQueued = false;
      if (isArrow && projectile && this.attackEffects.length < FX_LIMITS.activeAttackTrails) {
        const fromX = attackerX + Math.sign(event.targetX - event.attackerX) * 2;
        const fromY = attackerY - CELL_SIZE * 0.18;
        const distance = Math.hypot(targetX - fromX, targetY - fromY);
        this.attackEffects.push({
          fromX, fromY, toX: targetX, toY: targetY,
          elapsedMs: 0,
          totalMs: Phaser.Math.Clamp(distance / FX_VISUALS.arrowTravelPixelsPerMs,
            FX_VISUALS.arrowMinDurationMs, FX_VISUALS.arrowMaxDurationMs),
          projectile,
          impactKind: event.targetDied ? 'dust' : event.targetCategory === 'building' ? 'debris' : 'hit',
          targetId: event.targetDied ? undefined : event.targetId,
          targetTeam: event.targetTeam,
          targetCategory: event.targetCategory,
          targetKind: event.targetKind,
        });
        projectileQueued = true;
      } else if (projectile) {
        projectile.setVisible(false);
        this.projectilePool.push(projectile);
      }

      if (!projectileQueued) {
        // When the projectile pool is exhausted, fall back to an immediate hit cue.
        if (isArrow && !event.targetDied) this.damageFlashUntil.set(event.targetId, this.time.now + 115);
        if (event.targetDied) {
          const deathScale = event.targetKind === 'barricade' ? 0.75 : event.targetCategory === 'building' ? 1.45 : 1.15;
          this.addWorldEffect('dust', targetX, targetY, event.targetTeam, 0xd9c69a,
            FX_VISUALS.deathDurationMs, 3, deathScale);
          if (event.targetCategory === 'building') this.addStructureDestructionEffect(
            targetX, targetY, event.targetTeam, event.targetKind);
        } else if (event.targetCategory === 'unit') {
          this.addWorldEffect('hit', targetX, targetY, event.targetTeam, 0xfff1cc,
            FX_VISUALS.hitDurationMs, 4, 0.8);
        } else {
          this.addWorldEffect('debris', targetX, targetY, event.targetTeam, 0xb9a98a,
            FX_VISUALS.structureImpactDurationMs, 2, 1);
        }
      }
      if (event.reflectedDamage > 0) {
        if (event.attackerDied) this.addWorldEffect('dust', attackerX, attackerY, event.attackerTeam,
          0xd9c69a, FX_VISUALS.deathDurationMs, 3, 1.1);
        else this.addWorldEffect('hit', attackerX, attackerY, event.attackerTeam, 0xeccf74,
          FX_VISUALS.hitDurationMs, 4, 0.8);
      }
    }
    for (const unitId of this.displayPositions.keys()) {
      if (!this.simulation.entities.get(unitId)) {
        this.displayPositions.delete(unitId);
        this.soundSystem.play('unitDeath');
      }
    }
    for (const unitId of this.motionTracks.keys()) {
      if (!this.simulation.entities.get(unitId)) this.motionTracks.delete(unitId);
    }
    for (const entity of this.simulation.entities.all()) {
      if (entity.category === 'unit' && !this.displayPositions.has(entity.id)) {
        this.displayPositions.set(entity.id, { x: entity.x, y: entity.y });
        this.addWorldEffect('ring', (entity.x + 0.5) * CELL_SIZE,
          (entity.y + 0.5) * CELL_SIZE, entity.team, UNIT_COLORS[entity.kind], 450);
        if (entity.team === 'blue') {
          this.soundSystem.play('unitProduced');
        }
      }
      if (entity.category === 'building') {
        if (entity.underConstruction) {
          this.underConstructionBuildingIds.add(entity.id);
        } else if (this.underConstructionBuildingIds.has(entity.id)) {
          this.underConstructionBuildingIds.delete(entity.id);
          if (entity.kind === 'barricade') barricadeCompleted = true;
          this.addWorldEffect('dust', (entity.x + entity.width / 2) * CELL_SIZE,
            (entity.y + entity.height / 2) * CELL_SIZE, entity.team, 0xcdbb91,
            FX_VISUALS.completionDurationMs, 3, entity.kind === 'barricade' ? 0.75 : 1.1);
          if (entity.team === 'blue') {
            this.soundSystem.play('buildingComplete');
          }
        }
      }
    }

    const dirtyMapCells = this.map.drainDirtyCells();
    const visionChanged = this.visualFog.update(this.displayPositions, dirtyMapCells.length > 0);
    if (visionChanged || barricadeCompleted) this.barricadeTopology.invalidate();
    const dirtyCells = this.visualFog.drainDirtyTerrain();
    if (dirtyCells.length > 0) {
      this.detailsDirty = true;
      for (const [x, y] of dirtyCells) {
        const terrain = this.visualFog.cellAt(x, y)?.terrain;
        if (terrain) this.renderTerrainCell(x, y, terrain);
      }
      this.flushTerrain();
    }
    if (visionChanged) this.drawFog();
    this.updateAttackEffects(delta);
    this.addAmbientEffects();

    const blueStock = this.simulation.teams.blue;
    if (blueStock.wood > this.lastBlueWood || blueStock.coins > this.lastBlueCoins || blueStock.stone > this.lastBlueStone) {
      this.soundSystem.play('resourceDeposited');
      const base = this.simulation.entities.get('blue-base');
      if (base?.category === 'building') {
        const fxColor = blueStock.stone > this.lastBlueStone ? 0xb5bcc4 : blueStock.coins > this.lastBlueCoins ? 0xefce87 : 0xa4d96c;
        this.addWorldEffect('ring',
          (base.x + base.width / 2) * CELL_SIZE, (base.y + base.height / 2) * CELL_SIZE,
          'blue', fxColor, 550);
      }
    }
    this.lastBlueWood = blueStock.wood;
    this.lastBlueCoins = blueStock.coins;
    this.lastBlueStone = blueStock.stone;

    const visibleEnemies = this.visualFog.visibleEntities().filter((e) => e.team === 'red');
    let newEnemySpotted = false;
    for (const enemy of visibleEnemies) {
      if (!this.lastVisibleEnemies.has(enemy.id)) {
        this.lastVisibleEnemies.add(enemy.id);
        newEnemySpotted = true;
      }
    }
    for (const id of Array.from(this.lastVisibleEnemies)) {
      if (!visibleEnemies.some((e) => e.id === id)) {
        this.lastVisibleEnemies.delete(id);
      }
    }
    if (newEnemySpotted) {
      this.soundSystem.play('enemySpotted');
    }
    this.updateWorldEffects(delta);
    if (this.fxDebug) {
      const root = document.querySelector('#game');
      root?.setAttribute('data-active-world-fx', String(this.worldEffects.length));
      root?.setAttribute('data-active-projectiles', String(this.attackEffects.filter((effect) => effect.projectile).length));
    }
    const motionActive = this.motionTracks.size > 0;
    const view = this.cameras.main.worldView;
    const cameraChanged = view.x !== this.lastEntityView.x || view.y !== this.lastEntityView.y || view.width !== this.lastEntityView.width || view.height !== this.lastEntityView.height;
    if (ticks > 0 || motionActive || movementEvents.length > 0 || dirtyCells.length > 0 || combatEvents.length > 0 || cameraChanged) {
      this.drawEntities();
      this.drawSelectionVisuals();
    }
    if (ticks > 0 || combatEvents.length > 0) {
      this.refreshSelectionDOM();
      this.refreshTeamStatus();
    }
    this.minimap.render(this.cameras.main.worldView, CELL_SIZE, this.displayPositions, visionChanged);
    if (this.simulation.result) return;
    const camera = this.cameras.main;
    const movement = PAN_SPEED * delta / 1000 / camera.zoom;
    if (this.keys.A?.isDown || this.keys.LEFT?.isDown) camera.scrollX -= movement;
    if (this.keys.D?.isDown || this.keys.RIGHT?.isDown) camera.scrollX += movement;
    if (this.keys.W?.isDown || this.keys.UP?.isDown) camera.scrollY -= movement;
    if (this.keys.S?.isDown || this.keys.DOWN?.isDown) camera.scrollY += movement;

    const root = document.querySelector('#game');
    if (ticks > 0) {
      root?.setAttribute('data-ticks', String(this.simulation.clock.ticks));
      if (this.debug) {
        const redAI = this.simulation.redAI;
        if (redAI) {
          const dbg = redAI.getDebugState();
          root?.setAttribute('data-ai-red-decision', dbg.decision);
          root?.setAttribute('data-ai-red-priority', String(dbg.priority));
          root?.setAttribute('data-ai-red-goal', dbg.goal);
          root?.setAttribute('data-ai-red-action', dbg.chosenAction);
          root?.setAttribute('data-ai-red-desired', `${dbg.desiredResources.coins},${dbg.desiredResources.wood},${dbg.desiredResources.stone}`);

          const aiDebugEl = document.querySelector('#ai-debug');
          if (aiDebugEl) {
            aiDebugEl.textContent = `IA Vermelha: ${dbg.decision} (P:${dbg.priority}) · ${dbg.goal} · Desejado: C:${dbg.desiredResources.coins} M:${dbg.desiredResources.wood} P:${dbg.desiredResources.stone} · Ação: ${dbg.chosenAction}`;
          }
        }
      }
    }

    const curZoom = camera.zoom.toFixed(2);
    const curCamX = camera.scrollX.toFixed(1);
    const curCamY = camera.scrollY.toFixed(1);
    if (curCamX !== this.lastCamX || curCamY !== this.lastCamY || curZoom !== this.lastZoom) {
      this.lastCamX = curCamX;
      this.lastCamY = curCamY;
      this.lastZoom = curZoom;
      root?.setAttribute('data-zoom', curZoom);
      root?.setAttribute('data-camera-x', curCamX);
      root?.setAttribute('data-camera-y', curCamY);
      const zoomLabel = document.querySelector('#zoom-value');
      if (zoomLabel) zoomLabel.textContent = `${Math.round(camera.zoom * 100)}%`;
    }
  }

  private installDiagnostics(): void {
    const api = {
      setEnabled: (enabled: boolean) => {
        this.simulation.setDiagnostics(enabled);
        this.lastPerformanceFrame = 0;
        if (!enabled) return;
        const monitor = this.simulation.diagnostics;
        const scene = this as unknown as Record<string, unknown>;
        monitor.watch(this.sys as unknown as Record<string, unknown>, 'sceneUpdate', 'sceneUpdate');
        for (const name of ['drawEntities', 'drawFog', 'drawSelectionVisuals', 'refreshSelectionDOM', 'refreshTeamStatus']) {
          monitor.watch(scene, name, name);
        }
        monitor.watch(this.visualFog, 'update', 'visualFog');
        monitor.watch(this.minimap, 'render', 'minimap');
        let renderStart = 0;
        const before = () => { renderStart = performance.now(); };
        const after = () => { monitor.record('rendererCPU', performance.now() - renderStart); };
        this.game.events.on('prerender', before);
        this.game.events.on('postrender', after);
        monitor.onDisable(() => {
          this.game.events.off('prerender', before);
          this.game.events.off('postrender', after);
        });
      },
      reset: () => this.simulation.diagnostics.reset(),
      snapshot: () => ({ ...this.simulation.diagnostics.snapshot(),
        entities: this.simulation.entities.all().length,
        units: this.simulation.entities.all().filter(e => e.category === 'unit').length,
        formations: this.simulation.formations.getAllGroups().length,
        droppedSimulationMs: this.simulation.clock.droppedMs }),
    };
    const host = window as unknown as { rtsPerformance?: typeof api };
    host.rtsPerformance = api;
    api.setEnabled(true);
    this.events.once('shutdown', () => {
      api.setEnabled(false);
      if (host.rtsPerformance === api) delete host.rtsPerformance;
    });
  }

  private showResult(): void {
    const result = this.simulation.result;
    if (!result) return;
    this.resultShown = true;
    this.placementMode = null;
    this.placementGhostGraphics.clear();
    const victory = result.winner === 'blue';
    if (victory) {
      this.soundSystem.play('victory');
    } else {
      this.soundSystem.play('defeat');
    }
    const title = document.querySelector('#result-title');
    const summary = document.querySelector('#result-summary');
    const duration = document.querySelector('#result-duration');
    const stats = document.querySelector('#result-stats tbody');
    const panel = document.querySelector('#game-result');
    if (title) title.textContent = victory ? 'Vitória!' : 'Derrota';
    if (summary) summary.textContent = victory ? 'Você destruiu a base inimiga.' : 'Sua base foi destruída.';
    if (duration) duration.textContent = `Duração: ${Math.floor(result.elapsedTicks / TICKS_PER_SECOND / 60)}m ${String(Math.floor(result.elapsedTicks / TICKS_PER_SECOND) % 60).padStart(2, '0')}s`;
    if (stats) {
      stats.replaceChildren();
      const entries = [
        ['Tropas produzidas', result.stats.blue.troopsProduced, result.stats.red.troopsProduced],
        ['Tropas abatidas', result.stats.blue.troopsKilled, result.stats.red.troopsKilled],
        ['Operários produzidos', result.stats.blue.workersProduced, result.stats.red.workersProduced],
        ['Operários abatidos', result.stats.blue.workersKilled, result.stats.red.workersKilled],
        ['Ouro coletado', Math.floor(result.stats.blue.coinsCollected), Math.floor(result.stats.red.coinsCollected)],
        ['Ouro gasto', Math.floor(result.stats.blue.coinsSpent), Math.floor(result.stats.red.coinsSpent)],
        ['Madeira coletada', Math.floor(result.stats.blue.woodCollected), Math.floor(result.stats.red.woodCollected)],
        ['Madeira gasta', Math.floor(result.stats.blue.woodSpent), Math.floor(result.stats.red.woodSpent)],
        ['Unidades restantes', result.blueUnits, result.redUnits],
        ['Ouro restante', Math.floor(result.blueCoins), Math.floor(result.redCoins)],
        ['Madeira restante', Math.floor(result.blueWood), Math.floor(result.redWood)],
      ];
      for (const [label, blue, red] of entries) {
        const row = document.createElement('tr');
        const heading = document.createElement('th');
        heading.scope = 'row';
        heading.textContent = String(label);
        const blueCell = document.createElement('td');
        blueCell.textContent = String(blue);
        const redCell = document.createElement('td');
        redCell.textContent = String(red);
        row.append(heading, blueCell, redCell);
        stats.append(row);
      }
    }
    panel?.removeAttribute('hidden');
    document.querySelector('#restart-game')?.addEventListener('click', () => window.location.reload(), { once: true , signal: this.domListeners.signal });
    (document.querySelector('#restart-game') as HTMLButtonElement | null)?.focus();
  }

  private drawMap(): void {
    const width = this.map.width * CELL_SIZE, height = this.map.height * CELL_SIZE;
    if (this.textures.exists('tiny-terrain')) {
      this.terrainTiles = this.add.tileSprite(0, 0, width, height, 'tiny-terrain', 'grass').setOrigin(0);
      this.terrainTiles.setTileScale(CELL_SIZE / 64);
      if (this.terrainTexture) {
        this.terrainTexture.draw(this.terrainTiles);
        this.terrainTiles.setVisible(false);
      }
    }
    const renderer = this.game.renderer;
    const supported = !(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)
      || renderer.gl.getParameter(renderer.gl.MAX_TEXTURE_SIZE) >= Math.max(width, height);
    if (supported) this.terrainTexture = this.add.renderTexture(0, 0, width, height).setOrigin(0);
    this.mapGraphics = this.add.graphics();
    if (this.terrainTexture) this.mapGraphics.setVisible(false);
    // Playable public demo should still show a natural landscape when the
    // separately licensed art is not installed in this browser.
    if (!this.terrainTiles) this.mapGraphics.fillStyle(COLORS.plain).fillRect(0, 0, width, height);
    const dirty = this.visualFog.drainDirtyTerrain();
    for (const [x, y] of dirty) {
      const terrain = this.visualFog.cellAt(x, y)?.terrain;
      if (terrain) this.renderTerrainCell(x, y, terrain);
    }

    this.flushTerrain();
  }

  private flushTerrain(): void {
    if (!this.terrainTexture) return;
    this.terrainTexture.draw([this.mapGraphics]);
    this.mapGraphics.clear();
  }

  private renderTerrainCell(x: number, y: number, terrain: Terrain): void {
    const px = x * CELL_SIZE;
    const py = y * CELL_SIZE;
    // Tiny Swords already has the full vegetation and rock visual layer.
    if (this.terrainTiles && terrain !== 'water') return;
    const hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    const green = [0x659653, 0x629152, 0x699a55][hash % 3];
    this.mapGraphics.fillStyle(terrain === 'plain' ? green : COLORS[terrain])
      .fillRect(px, py, CELL_SIZE, CELL_SIZE);
    if (this.terrainTiles) return;
    if (terrain === 'forest' && hash % 5 === 0) {
      this.mapGraphics.fillStyle(0x24553a, 0.9).fillCircle(px + 7, py + 7, 4);
      this.mapGraphics.fillStyle(0x408551, 0.95).fillCircle(px + 5, py + 4, 3);
    } else if (terrain === 'mountain' && hash % 6 === 0) {
      this.mapGraphics.fillStyle(0xa0a490, 0.85)
        .fillTriangle(px + 1, py + 10, px + 6, py + 2, px + 11, py + 10);
    } else if (terrain === 'water' && hash % 6 === 0) {
      this.mapGraphics.fillStyle(0x8ac6c4, 0.75).fillRect(px + 2, py + 5, 7, 1);
    } else if (terrain === 'stone' && hash % 4 === 0) {
      this.mapGraphics.fillStyle(0xb8baa6, 0.8)
        .fillTriangle(px + 2, py + 10, px + 6, py + 3, px + 10, py + 10);
    } else if (terrain === 'mine') {
      this.mapGraphics.fillStyle(0xe5c06a, 0.9).fillCircle(px + 6, py + 6, 3);
    } else if (terrain === 'plain' && hash % 11 === 0) {
      this.mapGraphics.fillStyle(0x85b56a, 0.6).fillRect(px + 3, py + 5, 1, 3);
    }
  }

  private drawEntities(): void {
    const graphics = this.entityGraphics;
    graphics.clear();
    this.drawTerrainDetails();
    // Keep sprites that stay on-screen visible; avoid a needless hide/show of
    // every displayed object on each render pass.
    this.visibleSpriteIds.clear();
    Object.assign(this.lastEntityView, this.cameras.main.worldView);
    const visibleEntities = this.visualFog.visibleEntities();
    this.barricadeTopology.sync(this.simulation.entities.revision, visibleEntities
      .filter((entity): entity is BuildingEntity => entity.category === 'building'
        && entity.kind === 'barricade' && !entity.underConstruction));
    for (const entity of visibleEntities) {
      const position = entity.category === 'unit' ? this.displayPositions.get(entity.id) ?? entity : entity;
      if (!this.intersectsViewport(position.x, position.y, entity.category === 'building' ? entity.width : 1, entity.category === 'building' ? entity.height : 1)) continue;
      const color = entity.team === 'blue' ? 0x9bdbff : 0xffada9;
      if (entity.category === 'unit') {
        const position = this.displayPositions.get(entity.id) ?? entity;
        const sprite = this.updateUnitSprite(entity, position.x, position.y);
        if (sprite) {
          this.visibleSpriteIds.add(entity.id);
          graphics.lineStyle(1, entity.team === 'blue' ? 0x3a9f67 : 0xa84b4c, 0.9);
          graphics.strokeEllipse((position.x + 0.5) * CELL_SIZE, (position.y + 0.96) * CELL_SIZE,
            UNIT_VISUALS[entity.kind].visibleWidth + 2, WORLD_VISUAL_METRICS.unitSelectionEllipseHeight);
        }
        if (!sprite) {
          graphics.fillStyle(color).fillRect(position.x * CELL_SIZE + 1, position.y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
          graphics.fillStyle(UNIT_COLORS[entity.kind]).fillRect(position.x * CELL_SIZE + 3, position.y * CELL_SIZE + 3, CELL_SIZE - 6, CELL_SIZE - 6);
        }
        if (!sprite && entity.kind === 'builder') {
          graphics.fillStyle(0xffe600, 1).fillRect(position.x * CELL_SIZE + 3, position.y * CELL_SIZE + 1, CELL_SIZE - 6, 2.5);
          graphics.fillStyle(0xffffff, 0.9).fillRect(position.x * CELL_SIZE + 5, position.y * CELL_SIZE + 4, 2, 3);
        }
        const hpPct = Math.max(0, Math.min(1, entity.hp / entity.maxHp));
        const visual = UNIT_VISUALS[entity.kind];
        const barW = Math.max(9, visual.visibleWidth * 0.75);
        const barX = (position.x + 0.5) * CELL_SIZE - barW / 2;
        const barY = (position.y + 1) * CELL_SIZE - visual.visibleHeight - WORLD_VISUAL_METRICS.unitHpBarGap;
        graphics.fillStyle(0x160f12, 0.9).fillRect(barX, barY, barW, WORLD_VISUAL_METRICS.unitHpBarHeight);
        graphics.fillStyle(entity.team === 'blue' ? 0x55ff55 : 0xff5555, 0.95)
          .fillRect(barX, barY, Math.max(1, barW * hpPct), WORLD_VISUAL_METRICS.unitHpBarHeight);
      } else {
        const sprite = this.updateBuildingSprite(entity);
        if (sprite) this.visibleSpriteIds.add(entity.id);
        if (sprite && !entity.underConstruction) {
          graphics.lineStyle(1, entity.team === 'blue' ? 0x3a9f67 : 0xa84b4c, 0.8);
          graphics.strokeRect(entity.x * CELL_SIZE, entity.y * CELL_SIZE,
            entity.width * CELL_SIZE, entity.height * CELL_SIZE);
        }
        if (entity.underConstruction) {
          graphics.lineStyle(2, 0xeccf74, 0.85).strokeRect(
            entity.x * CELL_SIZE + 2, entity.y * CELL_SIZE + 2,
            entity.width * CELL_SIZE - 4, entity.height * CELL_SIZE - 4,
          );
          graphics.fillStyle(color, 0.35).fillRect(
            entity.x * CELL_SIZE + 2, entity.y * CELL_SIZE + 2,
            entity.width * CELL_SIZE - 4, entity.height * CELL_SIZE - 4,
          );
          const pct = Math.min(1, entity.buildProgressTicks / Math.max(1, entity.buildTotalTicks));
          graphics.fillStyle(0x38505a, 0.95).fillRect(
            entity.x * CELL_SIZE + 3, entity.y * CELL_SIZE + 3,
            entity.width * CELL_SIZE - 6, 3,
          );
          graphics.fillStyle(0xeccf74, 1).fillRect(
            entity.x * CELL_SIZE + 3, entity.y * CELL_SIZE + 3,
            (entity.width * CELL_SIZE - 6) * pct, 3,
          );
        } else {
          if (!sprite) graphics.lineStyle(2, color, 1).strokeRect(
            entity.x * CELL_SIZE + 2, entity.y * CELL_SIZE + 2,
            entity.width * CELL_SIZE - 4, entity.height * CELL_SIZE - 4,
          );
          if (!sprite && entity.kind === 'barricade') {
            graphics.fillStyle(0x7a634e, 0.9).fillRect(
              entity.x * CELL_SIZE + 2, entity.y * CELL_SIZE + 2,
              entity.width * CELL_SIZE - 4, entity.height * CELL_SIZE - 4,
            );
            graphics.lineStyle(1.5, 0x3d2c1e, 1);
            graphics.lineBetween(
              entity.x * CELL_SIZE + 2, entity.y * CELL_SIZE + 2,
              (entity.x + 1) * CELL_SIZE - 2, (entity.y + 1) * CELL_SIZE - 2,
            );
            graphics.lineBetween(
              (entity.x + 1) * CELL_SIZE - 2, entity.y * CELL_SIZE + 2,
              entity.x * CELL_SIZE + 2, (entity.y + 1) * CELL_SIZE - 2,
            );
            graphics.fillStyle(0x231810, 1).fillRect(entity.x * CELL_SIZE + 3, entity.y * CELL_SIZE + 3, 2, 2);
            graphics.fillStyle(0x231810, 1).fillRect((entity.x + 1) * CELL_SIZE - 5, entity.y * CELL_SIZE + 3, 2, 2);
            graphics.fillStyle(0x231810, 1).fillRect(entity.x * CELL_SIZE + 3, (entity.y + 1) * CELL_SIZE - 5, 2, 2);
            graphics.fillStyle(0x231810, 1).fillRect((entity.x + 1) * CELL_SIZE - 5, (entity.y + 1) * CELL_SIZE - 5, 2, 2);
          } else if (!sprite && entity.kind === 'tower') {
            graphics.fillStyle(0x4a5568, 0.95).fillRect(
              entity.x * CELL_SIZE + 2, entity.y * CELL_SIZE + 2,
              entity.width * CELL_SIZE - 4, entity.height * CELL_SIZE - 4,
            );
            graphics.lineStyle(1.5, 0x2d3748, 1).strokeRect(
              entity.x * CELL_SIZE + 4, entity.y * CELL_SIZE + 4,
              entity.width * CELL_SIZE - 8, entity.height * CELL_SIZE - 8,
            );
            graphics.fillStyle(0x38bdf8, 1).fillCircle(
              (entity.x + entity.width / 2) * CELL_SIZE,
              (entity.y + entity.height / 2) * CELL_SIZE, 3.5,
            );
            graphics.fillStyle(0xfffbeb, 0.9).fillCircle(
              (entity.x + entity.width / 2) * CELL_SIZE,
              (entity.y + entity.height / 2) * CELL_SIZE, 1.5,
            );
          } else if (!sprite) {
            graphics.fillStyle(color).fillRect(
              (entity.x + entity.width / 2) * CELL_SIZE - 3,
              (entity.y + entity.height / 2) * CELL_SIZE - 3, 6, 6,
            );
          }
          if (entity.hp < entity.maxHp) {
            const hpPct = Math.max(0, entity.hp / entity.maxHp);
            const visual = BUILDING_VISUALS[entity.kind];
            const barW = visual.visibleWidth * 0.78;
            const barX = (entity.x + entity.width / 2) * CELL_SIZE - barW / 2;
            const barY = (entity.y + entity.height) * CELL_SIZE - visual.visibleHeight - WORLD_VISUAL_METRICS.buildingHpBarGap;
            graphics.fillStyle(0x3a0000, 0.9).fillRect(barX, barY, barW, WORLD_VISUAL_METRICS.buildingHpBarHeight);
            graphics.fillStyle(entity.team === 'blue' ? 0x55ff55 : 0xff5555, 0.95)
              .fillRect(barX, barY, Math.max(1, barW * hpPct), WORLD_VISUAL_METRICS.buildingHpBarHeight);
          }
          if (this.simulation.construction.isBeingRepaired(entity.id)) {
            graphics.lineStyle(2, 0x52c41a, 0.95).strokeRect(
              entity.x * CELL_SIZE + 1, entity.y * CELL_SIZE + 1,
              entity.width * CELL_SIZE - 2, entity.height * CELL_SIZE - 2,
            );
            graphics.fillStyle(0x52c41a, 1).fillCircle(entity.x * CELL_SIZE + entity.width * CELL_SIZE - 1, entity.y * CELL_SIZE - 1.5, 3);
            graphics.fillStyle(0xffffff, 1).fillCircle(entity.x * CELL_SIZE + entity.width * CELL_SIZE - 1, entity.y * CELL_SIZE - 1.5, 1.2);
          }
        }
      }
    }
    for (const building of this.visualFog.knownBuildings()) {
      if (this.visualFog.stateAt(building.x, building.y) === 'visible') continue;
      if (!this.intersectsViewport(building.x, building.y, building.width, building.height)) continue;
      const color = building.team === 'blue' ? 0x9bdbff : 0xffada9;
      graphics.lineStyle(1, color, 0.4).strokeRect(
        building.x * CELL_SIZE + 2, building.y * CELL_SIZE + 2,
        building.width * CELL_SIZE - 4, building.height * CELL_SIZE - 4,
      );
    }
    const root = document.querySelector('#game');
    const visibleEnemies = this.visualFog.visibleEntities().filter((entity) => entity.team === 'red');
    root?.setAttribute('data-visible-enemy-ids', visibleEnemies.map((entity) => entity.id).join(','));
    root?.setAttribute('data-visible-enemy-positions', visibleEnemies.filter((entity) => entity.category === 'unit').map((entity) => {
      const position = this.displayPositions.get(entity.id) ?? entity;
      return `${entity.id}:${position.x.toFixed(2)},${position.y.toFixed(2)}`;
    }).join(';'));
    for (const [id, sprite] of this.entitySprites) {
      if (!this.simulation.entities.get(id)) {
        sprite.destroy();
        this.entitySprites.delete(id);
        this.spriteVisualCache.delete(id);
        this.attackVisualUntil.delete(id);
        this.attackVisualStartedAt.delete(id);
        this.damageFlashUntil.delete(id);
      } else if (!this.visibleSpriteIds.has(id) && sprite.visible) {
        sprite.setVisible(false);
      }
    }
  }

  private updateUnitSprite(unit: UnitEntity, x: number, y: number): Phaser.GameObjects.Image | null {
    let state: UnitVisualState = unit.kind === 'shieldbearer' ? 'guard' : 'idle';
    const motion = this.motionTracks.get(unit.id);
    if (motion) state = unit.carriedWood > 0 ? 'carryWood' : unit.carriedStone > 0 ? 'carryStone' : 'move';
    else if (unit.kind === 'worker') {
      const task = this.simulation.economy.taskFor(unit.id);
      if (task?.kind === 'mine' && task.phase === 'working') state = 'mine';
      else if (task?.kind === 'gather' && task.phase === 'gathering') state = task.resourceKind === 'stone' ? 'gatherStone' : 'gatherWood';
    } else if (unit.kind === 'builder') {
      const task = this.simulation.construction.taskFor(unit.id);
      if (task?.phase === 'building' || task?.phase === 'repairing') state = 'build';
    }
    const attackActive = (this.attackVisualUntil.get(unit.id) ?? 0) > this.time.now;
    if (attackActive) state = 'attack';
    else if (this.attackVisualStartedAt.has(unit.id)) {
      this.attackVisualStartedAt.delete(unit.id);
      this.attackVisualUntil.delete(unit.id);
    }
    const builderKey = unit.kind === 'builder' ? builderUnitSheetKey(unit.team, state) : null;
    const key = builderKey && this.textures.exists(builderKey)
      ? builderKey : availableUnitKey(this, unit.team, unit.kind, state);
    if (!key) return null;
    const visual = UNIT_VISUALS[unit.kind];
    let sprite = this.entitySprites.get(unit.id);
    if (!sprite) {
      sprite = this.add.image(0, 0, key).setOrigin(0.5, visual.originY);
      this.entitySprites.set(unit.id, sprite);
    } else if (sprite.texture.key !== key) sprite.setTexture(key);
    // An attack always begins at frame zero, rather than at an arbitrary global-clock frame.
    // This makes attack cues consistent while damage timing stays wholly in the simulation.
    const frames = frameCount(unit.kind, state);
    const frame = state === 'attack' && attackActive
      ? Math.min(frames - 1, Math.floor((this.time.now - (this.attackVisualStartedAt.get(unit.id) ?? this.time.now)) / 85))
      : Math.floor(this.time.now / 130) % frames;
    const size = visual.frameDisplaySize;
    const px = (x + 0.5) * CELL_SIZE;
    const py = (y + 1) * CELL_SIZE;
    const depth = ySortedWorldDepth(y + 1, 1);
    const cached = this.spriteVisualCache.get(unit.id);
    if (!cached || cached.key !== key || cached.frame !== frame) sprite.setFrame(frame);
    if (!cached || cached.size !== size) sprite.setDisplaySize(size, size);
    if (!cached || cached.depth !== depth) sprite.setDepth(depth);
    if (!cached || cached.x !== px || cached.y !== py) sprite.setPosition(px, py);
    if (motion && motion.path.length > 1) {
      sprite.setFlipX(motion.path[motion.path.length - 1][0] < motion.path[0][0]);
    }
    if (!sprite.visible) sprite.setVisible(true);
    if (sprite.alpha !== 1) sprite.setAlpha(1);
    this.applyDamageFlash(sprite, unit.id);
    this.spriteVisualCache.set(unit.id, { key, frame, x: px, y: py, size, depth });
    return sprite;
  }

  /** Tint is visual-only and is cleared immediately when the short flash expires. */
  private applyDamageFlash(sprite: Phaser.GameObjects.Image, entityId: string): void {
    const until = this.damageFlashUntil.get(entityId);
    if (until !== undefined && until > this.time.now) {
      if (!sprite.isTinted) sprite.setTintFill(0xffffff);
    } else {
      if (until !== undefined) this.damageFlashUntil.delete(entityId);
      if (sprite.isTinted) sprite.clearTint();
    }
  }

  private updateBuildingSprite(building: BuildingEntity): Phaser.GameObjects.Image | null {
    const key = building.kind === 'barricade'
      ? barricadeTextureKey(building.underConstruction ? 0 : this.barricadeTopology.maskFor(building.id))
      : buildingKey(building.team, building.kind);
    const resolvedKey = this.textures.exists(key) ? key : buildingKey(building.team, building.kind);
    if (!this.textures.exists(resolvedKey)) return null;
    const visual = BUILDING_VISUALS[building.kind];
    let sprite = this.entitySprites.get(building.id);
    if (!sprite) {
      sprite = this.add.image(0, 0, resolvedKey).setOrigin(visual.originX, visual.originY);
      this.entitySprites.set(building.id, sprite);
    } else if (sprite.texture.key !== resolvedKey) sprite.setTexture(resolvedKey);
    const width = visual.width;
    const height = visual.height;
    const px = (building.x + building.width / 2) * CELL_SIZE;
    const py = (building.y + building.height) * CELL_SIZE;
    const depth = ySortedWorldDepth(building.y + building.height, 1);
    const cached = this.spriteVisualCache.get(building.id);
    if (!cached || cached.size !== width) sprite.setDisplaySize(width, height);
    if (!cached || cached.depth !== depth) sprite.setDepth(depth);
    if (!cached || cached.x !== px || cached.y !== py) sprite.setPosition(px, py);
    this.spriteVisualCache.set(building.id, { key: resolvedKey, frame: 0, x: px, y: py, size: width, depth });
    if (!sprite.visible) sprite.setVisible(true);
    const opacity = building.underConstruction ? 0.52 : 1;
    if (sprite.alpha !== opacity) sprite.setAlpha(opacity);
    this.applyDamageFlash(sprite, building.id);
    return sprite;
  }

  private drawTerrainDetails(): void {
    const view = this.cameras.main.worldView;
    const detailMargin = WORLD_VISUAL_METRICS.terrainViewportMarginCells;
    const minX = Math.max(0, Math.floor(view.x / CELL_SIZE) - detailMargin);
    const minY = Math.max(0, Math.floor(view.y / CELL_SIZE) - detailMargin);
    const maxX = Math.min(this.map.width - 1, Math.ceil(view.right / CELL_SIZE) + detailMargin);
    const maxY = Math.min(this.map.height - 1, Math.ceil(view.bottom / CELL_SIZE) + detailMargin);
    const bounds = `${minX},${minY},${maxX},${maxY}`;
    if (!this.detailsDirty && bounds === this.lastDetailBounds) return;
    this.detailsDirty = false;
    this.lastDetailBounds = bounds;
    this.fogReliefGraphics.clear();
    const terrainAt = (x: number, y: number): Terrain | null => this.map.cellAt(x, y)?.terrain ?? null;
    let used = 0;
    let foliageUsed = 0;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const hidden = this.visualFog.rawState(x, y) === 0;
        const terrain = this.visualFog.rawTerrain(x, y) ?? (hidden ? terrainAt(x, y) : null);
        if (!terrain) continue;
        // Fogged resources and forests stay concealed; only broad elevation and water shapes show faintly.
        if (hidden && terrain !== 'mountain' && terrain !== 'water') continue;
        if (hidden && terrain === 'water') {
          this.fogReliefGraphics.fillStyle(COLORS.water, WORLD_VISUAL_METRICS.hiddenWaterAlpha)
            .fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
          continue;
        }
        const hash = visualHash(x, y);
        let key = '';
        let frame: number | string = 0;
        let width = 0;
        let height = 0;
        let originX = 0.5;
        let originY = 1;
        let flipMountainY = false;
        if (terrain === 'forest') {
          const variant = hash % 8;
          if (hash % RESOURCE_VISUALS.forestTreeSpacingModulo !== 0) {
            if (hash % 13 !== 0) continue;
            key = `tiny-bush${1 + hash % 4}`;
            ({ width, height, originX, originY } = RESOURCE_VISUALS.bush);
            frame = hash % 8;
          } else if (variant < 2) {
            key = `tiny-bush${1 + hash % 4}`;
            ({ width, height, originX, originY } = RESOURCE_VISUALS.bush);
            frame = hash % 8;
          } else if (variant < 5) {
            key = hash % 2 ? 'tiny-tree3' : 'tiny-tree4';
            ({ width, height, originX, originY } = RESOURCE_VISUALS.forestTreeB);
            frame = hash % 8;
          } else {
            key = hash % 2 ? 'tiny-tree1' : 'tiny-tree2';
            ({ width, height, originX, originY } = RESOURCE_VISUALS.forestTreeA);
            frame = hash % 8;
          }
        } else if (terrain === 'mine') {
          key = ['tiny-gold', 'tiny-gold4', 'tiny-gold5', 'tiny-gold6'][hash % 4];
          ({ width, height, originX, originY } = RESOURCE_VISUALS.gold);
        } else if (terrain === 'stone') {
          key = ['tiny-stone', 'tiny-stone1', 'tiny-stone3', 'tiny-stone4'][hash % 4];
          ({ width, height, originX, originY } = RESOURCE_VISUALS.stoneDeposit);
        } else if (terrain === 'mountain') {
          const north = terrainAt(x, y - 1);
          const south = terrainAt(x, y + 1);
          const west = terrainAt(x - 1, y);
          const east = terrainAt(x + 1, y);
          key = 'tiny-terrainHigh'; width = CELL_SIZE;
          const southEdge = (south !== null && south !== 'mountain') || y === this.map.height - 1;
          const westEdge = west !== 'mountain';
          const eastEdge = east !== 'mountain';
          const northEdge = (north !== null && north !== 'mountain') || y === 0;
          if (southEdge) {
            // Join the broad front wall pieces along the lower rim of the raised plateau.
            frame = westEdge ? 'cliff-left' : eastEdge ? 'cliff-right' : 'cliff-center';
            height = CELL_SIZE * WORLD_VISUAL_METRICS.mountainCliffHeightCells;
          } else if (northEdge) {
            // Mirror the rock face on the upper rim so the plateau reads as a raised tier.
            frame = westEdge ? 'cliff-left' : eastEdge ? 'cliff-right' : 'cliff-center';
            height = CELL_SIZE * WORLD_VISUAL_METRICS.mountainCliffHeightCells;
            flipMountainY = true;
          } else if (westEdge || eastEdge) {
            // The narrow atlas column gives the plateau's exposed sides a matching rock face.
            frame = 'cliff-side'; height = CELL_SIZE * WORLD_VISUAL_METRICS.mountainCliffHeightCells;
          } else {
            height = CELL_SIZE;
            const northEdge = north !== 'mountain', southEdge = south !== 'mountain';
            const westEdge = west !== 'mountain', eastEdge = east !== 'mountain';
            frame = northEdge && westEdge ? 0 : northEdge && eastEdge ? 2
              : southEdge && westEdge ? 18 : southEdge && eastEdge ? 20
              : northEdge ? 1 : southEdge ? 19 : westEdge ? 9 : eastEdge ? 11 : 10;
          }
        } else if (terrain === 'water') {
          const waterEdge = hasDifferentTerrainNeighbor(terrainAt, x, y, 'water');
          if (waterEdge && hash % 2 === 0) {
            key = 'tiny-waterFoam'; ({ width, height, originX, originY } = RESOURCE_VISUALS.waterFoam); frame = hash % 16;
          } else if (!waterEdge && hash % 53 === 0) {
            key = hash % 2 ? 'tiny-waterRock' : 'tiny-waterRock2';
            ({ width, height, originX, originY } = RESOURCE_VISUALS.waterRock); frame = hash % 16;
          }
        } else if (terrain === 'plain' && hash % RESOURCE_VISUALS.plainDecorationModulo === 0) {
          if (hash % 11 === 0) {
            key = hash % 2 ? 'tiny-tree1' : 'tiny-tree2'; ({ width, height, originX, originY } = RESOURCE_VISUALS.smallTree); frame = hash % 8;
          } else if (hash % 5 === 0) {
            key = ['tiny-stone1', 'tiny-stone4'][hash % 2]; ({ width, height, originX, originY } = RESOURCE_VISUALS.decorationStone);
          } else {
            key = `tiny-bush${1 + hash % 4}`; ({ width, height, originX, originY } = RESOURCE_VISUALS.bush); frame = hash % 8;
          }
        }
        else continue;
        if (!this.textures.exists(key)) continue;
        let sprite = this.terrainDetails[used];
        if (!sprite) {
          sprite = this.add.image(0, 0, key).setOrigin(0.5, 1);
          this.terrainDetails.push(sprite);
        }
        if (sprite.texture.key !== key) sprite.setTexture(key);
        if (sprite.frame.name !== String(frame)) sprite.setFrame(frame);
        sprite.setOrigin(originX, originY);
        sprite.setDisplaySize(width, height);
        const mountainCell = terrain === 'mountain';
        const offsetX = mountainCell ? 0 : ((hash >>> 8) % 7) - 3;
        const offsetY = 0;
        const mountainWall = mountainCell && typeof frame === 'string' && frame.startsWith('cliff-');
        const wallOverhang = mountainWall ? (flipMountainY ? -CELL_SIZE : CELL_SIZE) : 0;
        sprite.setFlipX(mountainCell && frame === 'cliff-side' && terrainAt(x - 1, y) !== 'mountain');
        sprite.setFlipY(flipMountainY);
        sprite.setAlpha(hidden ? WORLD_VISUAL_METRICS.hiddenMountainAlpha : 1);
        sprite.setPosition((x + 0.5) * CELL_SIZE + offsetX, (y + 1) * CELL_SIZE + offsetY + wallOverhang);
        sprite.setDepth(ySortedWorldDepth((y + 1) + wallOverhang / CELL_SIZE));
        sprite.setVisible(true);
        used += 1;
        if (!hidden && terrain === 'mountain' && typeof frame === 'number' && hash % 19 === 0 && this.textures.exists('tiny-bush3')) {
          let bush = this.mountainFoliage[foliageUsed];
          if (!bush) {
            bush = this.add.image(0, 0, 'tiny-bush3');
            this.mountainFoliage.push(bush);
          }
          if (bush.frame.name !== String(hash % 8)) bush.setFrame(hash % 8);
          bush.setDisplaySize(RESOURCE_VISUALS.mountainBush.width, RESOURCE_VISUALS.mountainBush.height)
            .setOrigin(RESOURCE_VISUALS.mountainBush.originX, RESOURCE_VISUALS.mountainBush.originY)
            .setFlipX(hash % 2 === 0);
          bush.setPosition((x + 0.5) * CELL_SIZE + 1, (y + 1) * CELL_SIZE);
          bush.setDepth(ySortedWorldDepth(y + 1));
          bush.setVisible(true);
          foliageUsed += 1;
        }
      }
    }
    for (let i = used; i < this.terrainDetails.length; i += 1) this.terrainDetails[i].setVisible(false);
    for (let i = foliageUsed; i < this.mountainFoliage.length; i += 1) this.mountainFoliage[i].setVisible(false);

    let ridgeUsed = 0;
    for (let y = minY; y <= maxY; y += 1) {
      if (y % WORLD_VISUAL_METRICS.mountainRidgeStrideCells !== 0) continue;
      for (let x = minX; x <= maxX; x += 1) {
        if (this.visualFog.rawTerrain(x, y) !== 'mountain') continue;
        const north = this.visualFog.rawTerrain(x, y - 1);
        const south = this.visualFog.rawTerrain(x, y + 1);
        if (north !== 'mountain' || south !== 'mountain') continue;
        const west = this.visualFog.rawTerrain(x - 1, y);
        const east = this.visualFog.rawTerrain(x + 1, y);
        const ridgeFrame = west !== 'mountain' ? 'cliff-left' : east !== 'mountain' ? 'cliff-right' : 'cliff-center';
        let ridge = this.mountainRidges[ridgeUsed];
        if (!ridge) {
          ridge = this.add.image(0, 0, 'tiny-terrainHigh').setOrigin(0.5, 1);
          this.mountainRidges.push(ridge);
        }
        if (ridge.frame.name !== ridgeFrame) ridge.setFrame(ridgeFrame);
        ridge.setDisplaySize(CELL_SIZE, CELL_SIZE * WORLD_VISUAL_METRICS.mountainRidgeHeightCells).setFlipX(false).setFlipY(false);
        ridge.setPosition((x + 0.5) * CELL_SIZE, (y + 2) * CELL_SIZE);
        ridge.setDepth(ySortedWorldDepth(y + WORLD_VISUAL_METRICS.mountainRidgeHeightCells));
        ridge.setVisible(true);
        ridgeUsed += 1;
      }
    }
    for (let i = ridgeUsed; i < this.mountainRidges.length; i += 1) this.mountainRidges[i].setVisible(false);
  }

  private intersectsViewport(x: number, y: number, width: number, height: number): boolean {
    const view = this.cameras.main.worldView;
    // Tall anchored sprites extend beyond their logical footprint when close to the viewport edge.
    const margin = WORLD_VISUAL_METRICS.entityViewportMarginCells;
    return (x + width + margin) * CELL_SIZE >= view.x && (x - margin) * CELL_SIZE <= view.right
      && (y + height + margin) * CELL_SIZE >= view.y && (y - margin) * CELL_SIZE <= view.bottom;
  }

  private updateAttackEffects(delta: number): void {
    for (let i = this.attackEffects.length - 1; i >= 0; i -= 1) {
      const fx = this.attackEffects[i];
      const fromVisible = this.visualFog.stateAt(Math.floor(fx.fromX / CELL_SIZE), Math.floor(fx.fromY / CELL_SIZE)) === 'visible';
      const toVisible = this.visualFog.stateAt(Math.floor(fx.toX / CELL_SIZE), Math.floor(fx.toY / CELL_SIZE)) === 'visible';
      if (!fromVisible || !toVisible) {
        if (fx.projectile) {
          fx.projectile.setVisible(false);
          this.projectilePool.push(fx.projectile);
        }
        this.attackEffects.splice(i, 1);
        continue;
      }
      fx.elapsedMs += delta;
      if (fx.elapsedMs >= fx.totalMs) {
        // Delay ranged hit feedback until the visible arrow actually lands.
        if (fx.targetId && this.simulation.entities.get(fx.targetId)) {
          this.damageFlashUntil.set(fx.targetId, this.time.now + 115);
        }
        if (fx.projectile) {
          fx.projectile.setVisible(false);
          this.projectilePool.push(fx.projectile);
        }
        this.addWorldEffect(fx.impactKind, fx.toX, fx.toY, fx.targetTeam,
          fx.impactKind === 'hit' ? 0xfff1cc : fx.targetTeam === 'blue' ? 0xb4c1c4 : 0xc89a67,
          fx.impactKind === 'dust' ? FX_VISUALS.deathDurationMs : FX_VISUALS.impactDurationMs,
          fx.impactKind === 'hit' ? 4 : fx.impactKind === 'dust' ? 3 : 2,
          fx.impactKind === 'dust' ? 1.2 : 0.8);
        if (fx.impactKind === 'dust' && fx.targetCategory === 'building') {
          this.addStructureDestructionEffect(fx.toX, fx.toY, fx.targetTeam, fx.targetKind);
        }
        this.attackEffects.splice(i, 1);
        continue;
      }
      if (fx.projectile) {
        const progress = fx.elapsedMs / fx.totalMs;
        const x = Phaser.Math.Linear(fx.fromX, fx.toX, progress);
        const y = Phaser.Math.Linear(fx.fromY, fx.toY, progress);
        if (this.visualFog.stateAt(Math.floor(x / CELL_SIZE), Math.floor(y / CELL_SIZE)) !== 'visible') {
          fx.projectile.setVisible(false);
          this.projectilePool.push(fx.projectile);
          this.attackEffects.splice(i, 1);
          continue;
        }
        fx.projectile.setPosition(x, y);
        fx.projectile.setRotation(Math.atan2(fx.toY - fx.fromY, fx.toX - fx.fromX));
        fx.projectile.setVisible(true);
      }
    }
  }

  /** One restrained destruction accent for buildings, distinct from unit death dust.
   * Respects existing world-FX priority limits and fog checks. */
  private addStructureDestructionEffect(x: number, y: number, team: Team, kind: UnitKind | BuildingKind): void {
    const isBarricade = kind === 'barricade';
    this.addWorldEffect('debris', x, y, team, 0x9b8569,
      FX_VISUALS.structureImpactDurationMs, 2, isBarricade ? 0.7 : 1.4);
    if (!isBarricade) {
      this.addWorldEffect('ring', x, y, team, 0xd7b789,
        FX_VISUALS.structureImpactDurationMs, 2, 1.3);
    }
  }

  private addWorldEffect(kind: WorldEffect['kind'], x: number, y: number,
    team: Team, color: number, totalMs: number, priority: 0 | 1 | 2 | 3 | 4 = 0, sizeScale = 1): void {
    if (team === 'red' && this.visualFog.stateAt(Math.floor(x / CELL_SIZE), Math.floor(y / CELL_SIZE)) !== 'visible') return;
    if (this.worldEffects.length >= FX_LIMITS.activeWorldEffects) {
      let replaceAt = this.worldEffects.findIndex((effect) => effect.priority < priority);
      if (replaceAt < 0 && priority > 0) replaceAt = this.worldEffects.findIndex((effect) => effect.priority === priority);
      if (replaceAt < 0) return;
      const [removed] = this.worldEffects.splice(replaceAt, 1);
      if (removed?.sprite) this.releaseEffect(removed.sprite);
    }
    const key = kind === 'dust' ? 'tiny-dust' : '';
    const sprite = key && this.textures.exists(key) ? this.acquireEffect(key) : undefined;
    if (sprite) {
      sprite.setPosition(x, y).setDisplaySize(FX_VISUALS.dust.width * sizeScale, FX_VISUALS.dust.height * sizeScale);
    }
    this.worldEffects.push({ kind, x, y, team, color, elapsedMs: 0, totalMs, sprite, priority, sizeScale });
  }

  private installFxDebugPanel(): void {
    const panel = document.createElement('section');
    panel.setAttribute('aria-label', 'Teste de efeitos visuais');
    panel.dataset.fxDebug = 'true';
    Object.assign(panel.style, {
      position: 'fixed', right: '14px', top: '88px', zIndex: '1000', width: '226px',
      padding: '10px', border: '2px solid #c59a5b', borderRadius: '8px',
      background: 'rgba(18, 51, 57, .94)', color: '#fff1ce',
      font: 'bold 12px Arial, sans-serif', boxShadow: '0 4px 14px rgba(0,0,0,.35)',
    });
    const title = document.createElement('div');
    title.textContent = 'TESTE DE FEEDBACK VISUAL';
    title.style.marginBottom = '8px';
    panel.append(title);

    const grid = document.createElement('div');
    Object.assign(grid.style, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' });
    const anchor = this.simulation.entities.all().find((entity): entity is UnitEntity =>
      entity.category === 'unit' && entity.team === 'blue') ?? this.simulation.entities.get('blue-base');
    const x = ((anchor?.x ?? 24) + (anchor?.category === 'building' ? anchor.width / 2 : 0.5)) * CELL_SIZE;
    const y = ((anchor?.y ?? 100) + (anchor?.category === 'building' ? anchor.height / 2 : 0.5)) * CELL_SIZE;
    this.cameras.main.setZoom(Math.max(this.cameras.main.zoom, 1.35)).centerOn(x, y);
    const previewX = x + CELL_SIZE * 0.65;
    const previewY = y - CELL_SIZE * 0.35;
    const buttons: Array<{ label: string; color: string; run: () => void }> = [
      { label: 'Impacto', color: '#a94c43', run: () => this.addWorldEffect('hit', previewX, previewY, 'blue', 0xfff1cc, FX_VISUALS.hitDurationMs, 4, 1) },
      { label: 'Morte', color: '#6d6659', run: () => this.addWorldEffect('dust', previewX, previewY, 'blue', 0xd9c69a, FX_VISUALS.deathDurationMs, 3, 1.15) },
      { label: 'Destruição', color: '#806953', run: () => {
        this.addWorldEffect('dust', previewX, previewY, 'blue', 0xd9c69a, FX_VISUALS.deathDurationMs, 3, 1.45);
        this.addStructureDestructionEffect(previewX, previewY, 'blue', 'barracks');
      } },
      { label: 'Flecha', color: '#426f7d', run: () => {
        const fromX = previewX - CELL_SIZE * 2;
        const fromY = previewY;
        const toX = previewX + CELL_SIZE * 2;
        const projectile = this.acquireProjectile(
          this.textures.exists('tiny-arrowYellow') ? 'tiny-arrowYellow' : this.fallbackArrowKey());
        if (!projectile || this.attackEffects.length >= FX_LIMITS.activeAttackTrails) {
          if (projectile) this.projectilePool.push(projectile.setVisible(false));
          return;
        }
        this.attackEffects.push({ fromX, fromY, toX, toY: y, elapsedMs: 0,
          totalMs: FX_VISUALS.arrowMaxDurationMs, projectile, targetTeam: 'blue', targetCategory: 'unit', targetKind: 'soldier', impactKind: 'hit' });
      } },
      { label: 'Construção', color: '#786140', run: () => this.addWorldEffect('dust', previewX, previewY, 'blue', 0xcdbb91, FX_VISUALS.completionDurationMs, 3, 1) },
      { label: 'Madeira', color: '#786140', run: () => this.addWorldEffect('chips', previewX, previewY, 'blue', 0xc89a67, FX_VISUALS.gatherIntervalMs, 1, 1) },
      { label: 'Ouro', color: '#786140', run: () => this.addWorldEffect('chips', previewX, previewY, 'blue', 0xefce87, FX_VISUALS.gatherIntervalMs, 1, 1) },
      { label: 'Pedra', color: '#786140', run: () => this.addWorldEffect('chips', previewX, previewY, 'blue', 0xb5bcc4, FX_VISUALS.gatherIntervalMs, 1, 1) },
      { label: 'Ordem', color: '#426f7d', run: () => this.addWorldEffect('ring', previewX, previewY, 'blue', 0x55ff55, FX_VISUALS.orderDurationMs, 1) },
      { label: 'Limpar', color: '#554653', run: () => {
        for (const effect of this.worldEffects) if (effect.sprite) this.releaseEffect(effect.sprite);
        this.worldEffects.length = 0;
        for (const effect of this.attackEffects) if (effect.projectile) this.projectilePool.push(effect.projectile.setVisible(false));
        this.attackEffects.length = 0;
      } },
    ];
    for (const item of buttons) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;
      Object.assign(button.style, {
        minHeight: '28px', border: '1px solid #d4b06a', borderRadius: '4px',
        background: item.color, color: '#fff4d4', font: 'bold 12px Arial, sans-serif', cursor: 'pointer',
      });
      button.addEventListener('click', item.run, { signal: this.domListeners.signal });
      grid.append(button);
    }
    panel.append(grid);
    document.body.append(panel);
    this.events.once('shutdown', () => panel.remove());
  }

  private isWorldPointVisible(team: Team, x: number, y: number): boolean {
    return team === 'blue' || this.visualFog.stateAt(Math.floor(x / CELL_SIZE), Math.floor(y / CELL_SIZE)) === 'visible';
  }

  private acquireEffect(key: string): Phaser.GameObjects.Image | undefined {
    const activeSprites = this.worldEffects.reduce((count, effect) => count + (effect.sprite ? 1 : 0), 0);
    if (this.effectPool.length === 0 && activeSprites >= FX_LIMITS.activeWorldEffects) return undefined;
    const sprite = this.effectPool.pop() ?? this.add.image(0, 0, key).setDepth(WORLD_LAYER_DEPTHS.worldEffects);
    if (sprite.texture.key !== key) sprite.setTexture(key);
    return sprite.setAlpha(1).setRotation(0).setVisible(true);
  }

  private releaseEffect(sprite: Phaser.GameObjects.Image): void {
    sprite.setVisible(false);
    this.effectPool.push(sprite);
  }

  /** Procedural arrow keeps archer FX readable without redistributing Tiny Swords. */
  private fallbackArrowKey(): string {
    const key = 'rts-fallback-arrow';
    if (!this.textures.exists(key)) {
      const graphic = this.add.graphics();
      graphic.fillStyle(0xe9d6a1, 1).fillRect(1, 3, 10, 2);
      graphic.fillTriangle(9, 0, 15, 4, 9, 7);
      graphic.generateTexture(key, 16, 8);
      graphic.destroy();
    }
    return key;
  }

  private acquireProjectile(key: string): Phaser.GameObjects.Image | null {
    const activeProjectiles = this.attackEffects.reduce((count, effect) => count + (effect.projectile ? 1 : 0), 0);
    if (activeProjectiles >= FX_LIMITS.activeProjectiles) return null;
    const sprite = this.projectilePool.pop() ?? this.add.image(0, 0, key).setDepth(WORLD_LAYER_DEPTHS.worldEffects);
    if (sprite.texture.key !== key) sprite.setTexture(key);
    return sprite.setAlpha(1).setRotation(0)
      .setDisplaySize(FX_VISUALS.projectile.width, FX_VISUALS.projectile.height).setVisible(true);
  }

  private addAmbientEffects(): void {
    const second = Math.floor(this.simulation.clock.ticks / TICKS_PER_SECOND);
    if (second <= this.lastAmbientSecond) return;
    this.lastAmbientSecond = second;
    let emitted = 0;
    for (const entity of this.simulation.entities.all()) {
      if (entity.category === 'unit' && entity.kind === 'worker') {
        const task = this.simulation.economy.taskFor(entity.id);
        if (task?.phase === 'working' || task?.phase === 'gathering') {
          if (emitted >= FX_LIMITS.ambientEffectsPerSecond) break;
          const position = task.source;
          const offset = ((second + entity.id.length) % 3 - 1) * 3;
          const color = task.kind === 'mine' ? 0xefce87 : task.resourceKind === 'stone' ? 0xb5bcc4 : 0xc89a67;
          this.addWorldEffect('chips', (position[0] + 0.5) * CELL_SIZE + offset,
            (position[1] + 0.5) * CELL_SIZE - 3, entity.team, color,
            FX_VISUALS.gatherIntervalMs, 1, 0.8);
          emitted += 1;
        }
      } else if (entity.category === 'building' && entity.underConstruction) {
        if (emitted >= FX_LIMITS.ambientEffectsPerSecond) break;
        this.addWorldEffect('dust', (entity.x + entity.width - 0.3) * CELL_SIZE,
          (entity.y + entity.height - 0.25) * CELL_SIZE, entity.team, 0xcdbb91,
          FX_VISUALS.constructionIntervalMs, 1, entity.kind === 'barricade' ? 0.6 : 0.85);
        emitted += 1;
      } else if (entity.category === 'building' && this.simulation.construction.isBeingRepaired(entity.id)) {
        if (emitted >= FX_LIMITS.ambientEffectsPerSecond) break;
        this.addWorldEffect('spark', (entity.x + entity.width / 2) * CELL_SIZE,
          (entity.y + entity.height / 2) * CELL_SIZE, entity.team, 0x52c41a, 400);
        emitted += 1;
      }
    }
  }

  private updateWorldEffects(delta: number): void {
    this.worldGraphics.clear();
    for (let index = this.worldEffects.length - 1; index >= 0; index -= 1) {
      const effect = this.worldEffects[index];
      effect.elapsedMs += delta;
      if (effect.elapsedMs >= effect.totalMs) {
        if (effect.sprite) this.releaseEffect(effect.sprite);
        this.worldEffects.splice(index, 1);
        continue;
      }
      if (effect.team === 'red' && !this.isWorldPointVisible(effect.team, effect.x, effect.y)) {
        if (effect.sprite) this.releaseEffect(effect.sprite);
        this.worldEffects.splice(index, 1);
        continue;
      }
      const progress = effect.elapsedMs / effect.totalMs;
      const alpha = 1 - progress;
      if (effect.sprite) {
        effect.sprite.setFrame(Math.min(7, Math.floor(progress * 8)));
        effect.sprite.setAlpha(alpha).setVisible(true);
      } else if (effect.kind === 'ring') {
        this.worldGraphics.lineStyle(FX_VISUALS.worldRingLineWidth, effect.color, alpha);
        this.worldGraphics.strokeCircle(effect.x, effect.y,
          FX_VISUALS.worldRingStartRadius + progress * FX_VISUALS.worldRingGrowth);
      } else if (effect.kind === 'spark') {
        this.worldGraphics.lineStyle(FX_VISUALS.sparkLineWidth, effect.color, alpha);
        this.worldGraphics.lineBetween(effect.x - FX_VISUALS.sparkHalfLength, effect.y,
          effect.x + FX_VISUALS.sparkHalfLength, effect.y);
        this.worldGraphics.lineBetween(effect.x, effect.y - FX_VISUALS.sparkHalfLength,
          effect.x, effect.y + FX_VISUALS.sparkHalfLength);
      } else if (effect.kind === 'hit') {
        const radius = FX_VISUALS.hitMarkerRadius * effect.sizeScale;
        this.worldGraphics.fillStyle(effect.color, alpha);
        this.worldGraphics.fillRect(effect.x - radius, effect.y - 1.25, radius * 2, 2.5);
        this.worldGraphics.fillRect(effect.x - 1.25, effect.y - radius, 2.5, radius * 2);
        this.worldGraphics.lineStyle(1.25, effect.color, alpha * 0.75);
        this.worldGraphics.strokeCircle(effect.x, effect.y,
          radius * 0.8 + progress * FX_VISUALS.hitMarkerRingGrowth);
        this.worldGraphics.fillStyle(0xfff9e5, alpha * 0.9).fillCircle(effect.x, effect.y, 1.25 * effect.sizeScale);
      } else if (effect.kind === 'debris' || effect.kind === 'chips') {
        const half = (effect.kind === 'debris' ? 4 : 2.5) * effect.sizeScale;
        this.worldGraphics.lineStyle(1.5, effect.color, alpha);
        this.worldGraphics.lineBetween(effect.x - half, effect.y + half * 0.35, effect.x - half * 0.25, effect.y - half * 0.5);
        this.worldGraphics.lineBetween(effect.x + half * 0.2, effect.y + half * 0.4, effect.x + half, effect.y - half * 0.2);
        if (effect.kind === 'debris') this.worldGraphics.lineBetween(effect.x - half * 0.1, effect.y - half, effect.x + half * 0.25, effect.y - half * 0.35);
      } else {
        this.worldGraphics.fillStyle(effect.color, alpha * 0.45);
        this.worldGraphics.fillCircle(effect.x, effect.y,
          FX_VISUALS.sparkRadius + progress * FX_VISUALS.sparkGrowth);
      }
    }
  }

  private updateMotion(delta: number): void {
    for (const [unitId, track] of this.motionTracks) {
      track.elapsedMs += delta;
      const segments = track.path.length - 1;
      const progress = Math.min(segments, track.elapsedMs / track.durationMs * segments);
      const segment = Math.min(segments - 1, Math.floor(progress));
      const fraction = Math.min(1, progress - segment);
      const from = track.path[segment];
      const to = track.path[segment + 1];
      this.displayPositions.set(unitId, {
        x: Phaser.Math.Linear(from[0], to[0], fraction),
        y: Phaser.Math.Linear(from[1], to[1], fraction),
      });
      if (progress >= segments) this.motionTracks.delete(unitId);
    }
  }

  private drawFog(): void {
    const graphics = this.fogGraphics;
    graphics.clear();
    let visibleCount = 0;
    let exploredCount = 0;
    for (let y = 0; y < this.map.height; y += 1) {
      let runState = this.visualFog.rawState(0, y);
      let runStart = 0;
      for (let x = 0; x <= this.map.width; x += 1) {
        const state = x < this.map.width ? this.visualFog.rawState(x, y) : -1;
        if (state === 2) visibleCount += 1;
        if (state === 1) exploredCount += 1;
        if (state === runState) continue;
        if (runState === 0) {
          // Desaturada e translúcida: a névoa cobre o terreno sem virar um bloco preto.
          graphics.fillStyle(0x88b8b2, 0.58)
            .fillRect(runStart * CELL_SIZE, y * CELL_SIZE, (x - runStart) * CELL_SIZE, CELL_SIZE);
        }
        runStart = x;
        runState = state;
      }
    }
    if (visibleCount !== this.lastVisibleCount || exploredCount !== this.lastExploredCount) {
      this.lastVisibleCount = visibleCount;
      this.lastExploredCount = exploredCount;
      const root = document.querySelector('#game');
      root?.setAttribute('data-visible-cells', String(visibleCount));
      root?.setAttribute('data-explored-cells', String(exploredCount));
      const fogStatus = document.querySelector('#fog-status');
      if (fogStatus) fogStatus.textContent = `Visíveis: ${visibleCount} · exploradas: ${exploredCount}`;
    }
  }

  private drawSelectionBox(x1: number, y1: number, x2: number, y2: number): void {
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    this.selectionBoxGraphics.clear();
    this.selectionBoxGraphics.fillStyle(0xeccf74, 0.12).fillRect(x, y, width, height);
    this.selectionBoxGraphics.lineStyle(1, 0xeccf74, 1).strokeRect(x, y, width, height);
  }

  private drawSelectionVisuals(): void {
    this.selectionGraphics.clear();
    const selected = this.selection.selectedEntities;
    for (const entity of selected) {
      const position = entity.category === 'unit' ? this.displayPositions.get(entity.id) ?? entity : entity;
      const width = entity.category === 'unit' ? UNIT_VISUALS[entity.kind].visibleWidth : BUILDING_VISUALS[entity.kind].visibleWidth;
      const height = entity.category === 'unit' ? UNIT_VISUALS[entity.kind].visibleHeight : BUILDING_VISUALS[entity.kind].visibleHeight;
      const footX = entity.category === 'unit'
        ? (position.x + 0.5) * CELL_SIZE
        : (entity.x + entity.width / 2) * CELL_SIZE;
      const footY = entity.category === 'unit'
        ? (position.y + 1) * CELL_SIZE
        : (entity.y + entity.height) * CELL_SIZE;
      this.selectionGraphics.lineStyle(2, 0xffdf70, 1).strokeRect(
        footX - width / 2 - WORLD_VISUAL_METRICS.unitSelectionPadding,
        footY - height - WORLD_VISUAL_METRICS.unitSelectionPadding,
        width + WORLD_VISUAL_METRICS.unitSelectionPadding * 2,
        height + WORLD_VISUAL_METRICS.unitSelectionPadding * 2,
      );
      if (entity.category === 'building') {
        const centerX = (entity.x + entity.width / 2) * CELL_SIZE;
        const centerY = (entity.y + entity.height / 2) * CELL_SIZE;
        if (entity.kind === 'tower') {
          const halfSpan = 9;
          const minX = entity.x - halfSpan;
          const minY = entity.y - halfSpan;
          this.selectionGraphics.lineStyle(1.5, 0x38bdf8, 0.6);
          this.selectionGraphics.strokeRect(
            minX * CELL_SIZE, minY * CELL_SIZE,
            20 * CELL_SIZE, 20 * CELL_SIZE,
          );
          this.selectionGraphics.fillStyle(0x38bdf8, 0.05);
          this.selectionGraphics.fillRect(
            minX * CELL_SIZE, minY * CELL_SIZE,
            20 * CELL_SIZE, 20 * CELL_SIZE,
          );
        } else {
          const radius = BALANCE.buildings[entity.kind].vision;
          this.selectionGraphics.lineStyle(1.5, 0x9bdbff, 0.35);
          this.selectionGraphics.strokeCircle(centerX, centerY, radius * CELL_SIZE);
        }
        if (entity.kind === 'base') {
          this.selectionGraphics.lineStyle(1.5, 0x6da2b5, 0.3);
          this.selectionGraphics.strokeCircle(centerX, centerY, BALANCE.construction.maxDistanceFromBase * CELL_SIZE);
        }
        if (entity.rallyPoint) {
          const [rx, ry] = entity.rallyPoint;
          const targetPxX = (rx + 0.5) * CELL_SIZE;
          const targetPxY = (ry + 0.5) * CELL_SIZE;
          this.selectionGraphics.lineStyle(1.5, 0xfacc15, 0.85);
          this.drawDashedLine(this.selectionGraphics, centerX, centerY, targetPxX, targetPxY, 6, 4);

          this.selectionGraphics.fillStyle(0xfacc15, 0.9);
          this.selectionGraphics.fillCircle(targetPxX, targetPxY, 4);
          this.selectionGraphics.lineStyle(2, 0xeab308, 1);
          this.selectionGraphics.strokeCircle(targetPxX, targetPxY, 7);

          this.selectionGraphics.lineStyle(2, 0xffffff, 0.95);
          this.selectionGraphics.lineBetween(targetPxX, targetPxY, targetPxX, targetPxY - 14);
          this.selectionGraphics.fillStyle(0xfacc15, 0.95);
          this.selectionGraphics.fillTriangle(
            targetPxX, targetPxY - 14,
            targetPxX + 10, targetPxY - 10,
            targetPxX, targetPxY - 6,
          );
        }
      } else if (entity.category === 'unit') {
        const radius = entity.vision;
        const centerX = (position.x + 0.5) * CELL_SIZE;
        const centerY = (position.y + 0.5) * CELL_SIZE;
        this.selectionGraphics.lineStyle(1.5, 0x9bdbff, 0.35);
        this.selectionGraphics.strokeCircle(centerX, centerY, radius * CELL_SIZE);
      }
    }
    const root = document.querySelector('#game');
    root?.setAttribute('data-selected-ids', this.selection.selectedIds.join(','));
    const first = selected[0];
    const visual = first?.category === 'unit' ? this.displayPositions.get(first.id) ?? first : null;
    if (visual) root?.setAttribute('data-selected-visual-x', visual.x.toFixed(2));
    else root?.removeAttribute('data-selected-visual-x');
  }

  private refreshSelectionDOM(): void {
    const selected = this.selection.selectedEntities;
    const root = document.querySelector('#game');
    root?.setAttribute('data-selected-ids', this.selection.selectedIds.join(','));
    const first = selected[0];
    const hud = document.querySelector<HTMLElement>('#bottom-command-hud');
    const selectionPanel = document.querySelector<HTMLElement>('#selection-panel');
    const count = document.querySelector<HTMLElement>('#selection-count');
    const details = document.querySelector('#selection-details');
    const actionPanel = document.querySelector<HTMLElement>('#action-panel');
    const actionPlaceholder = document.querySelector<HTMLElement>('#action-placeholder');
    const grouped = new Map<string, number>();
    for (const entity of selected) grouped.set(entity.kind, (grouped.get(entity.kind) ?? 0) + 1);
    hud?.setAttribute('data-state', selected.length > 0 ? 'selected' : 'empty');
    selectionPanel?.removeAttribute('hidden');
    const groupSummary = [...grouped].map(([kind, amount]) => `${LABELS[kind]} ×${amount}`).join(' · ');
    if (count) {
      count.textContent = selected.length === 0 ? 'Nenhuma seleção'
        : selected.length === 1 ? LABELS[first.kind]
          : grouped.size === 1 ? groupSummary : `${selected.length} unidades`;
      count.removeAttribute('data-tooltip-title');
      count.removeAttribute('data-tooltip-description');
      if (selected.length === 1) {
        count.dataset.tooltipTitle = LABELS[first.kind];
        count.dataset.tooltipDescription = first.category === 'unit'
          ? (() => {
            const stats = BALANCE.units[first.kind];
            return `Vida ${Math.round(first.hp)}/${first.maxHp}; dano ${stats.damage}; alcance ${stats.range}; movimento ${stats.movement}; visão ${stats.vision}.`;
          })()
          : (() => {
            const stats = BALANCE.buildings[first.kind];
            const rally = first.rallyPoint ? ` Ponto de reunião: ${first.rallyPoint[0]}, ${first.rallyPoint[1]}.` : '';
            const queue = this.simulation.production.queueFor(first.id);
            const queueStatus = queue.length > 0 ? ` Fila: ${queue.map((item) => LABELS[item.unitKind]).join(', ')}.` : '';
            const vision = first.kind === 'tower' ? `${BALANCE.buildings.tower.vision} casas e detecção de batedores` : `${stats.vision} casas`;
            return `Vida ${Math.round(first.hp)}/${first.maxHp}; visão ${vision}.${rally}${queueStatus}`;
          })();
      }
    }
    if (details) {
      if (selected.length > 1) details.textContent = grouped.size > 1 ? groupSummary : '';
      else if (first) {
        const health = `HP ${Math.round(first.hp)}/${first.maxHp}`;
        if (first.category === 'unit') {
          const task = this.simulation.economy.taskFor(first.id);
          const buildTask = this.simulation.construction.taskFor(first.id);
          const target = this.simulation.combat.manualTargetFor(first.id);
          const engagement = this.simulation.engagements.statusFor(first.id);
          const state = engagement || target ? 'Em combate'
            : buildTask ? 'Construindo'
              : task ? task.kind === 'mine' ? 'Minerando ouro' : `Coletando ${task.resourceKind === 'stone' ? 'pedra' : 'madeira'}`
                : first.moveTarget ? 'Movendo' : 'Parado';
          details.textContent = `${health} · ${state}`;
        } else {
          const build = first.underConstruction
            ? ` · ${Math.round(first.buildProgressTicks / Math.max(1, first.buildTotalTicks) * 100)}% concluída`
            : '';
          details.textContent = `${health}${build}`;
        }
      } else details.textContent = 'Selecione uma unidade ou estrutura para ver seus detalhes.';
    }

    const status = document.querySelector('#selection-status');
    if (status) {
      status.replaceChildren();
      const add = (label: string, value: string) => {
        const dt = document.createElement('dt');
        const dd = document.createElement('dd');
        dt.textContent = label;
        dd.textContent = value;
        status.append(dt, dd);
      };
      if (first && selected.length > 0) {
        const military = selected.filter((entity): entity is UnitEntity => entity.category === 'unit' && entity.team === 'blue' && isMilitaryKind(entity.kind));
        const formation = military.length >= 2
          ? this.selection.formation
          : selected.length === 1 && first.category === 'unit' && isMilitaryKind(first.kind)
            ? this.simulation.formations.getFormationForUnit(first.id)?.type
            : undefined;
        if (formation) {
          const names: Record<FormationType, string> = { line: 'Linha', wedge: 'Cunha', block: 'Bloco', 'double-rank': 'Duas fileiras' };
          add('Formação', names[formation]);
        }
      }
    }

    const actionBar = document.querySelector('#action-bar');
    if (actionBar) {
      let targetMode = 'none';
      const blueBuildings = selected.filter((ent): ent is BuildingEntity => ent.category === 'building' && ent.team === 'blue');
      const blueBuilders = selected.filter((ent): ent is UnitEntity => ent.category === 'unit' && ent.kind === 'builder' && ent.team === 'blue');
      const blueWorkers = selected.filter((ent): ent is UnitEntity => ent.category === 'unit' && ent.kind === 'worker' && ent.team === 'blue');
      const blueUnits = selected.filter((ent): ent is UnitEntity => ent.category === 'unit' && ent.team === 'blue');

      if (blueBuildings.length > 0) {
        const building = blueBuildings[0];
        const rallyKey = building.rallyPoint ? `${building.rallyPoint[0]},${building.rallyPoint[1]}` : 'none';
        const rallyModeKey = this.rallyPlacementMode && this.rallyBuildingId === building.id ? 'active' : 'idle';
        targetMode = `${building.kind}:${building.id}:${building.underConstruction ? 'building' : 'ready'}:${rallyKey}:${rallyModeKey}`;
      } else if (blueUnits.some((u) => isMilitaryKind(u.kind))) {
        const militaryCount = blueUnits.filter((u) => isMilitaryKind(u.kind)).length;
        targetMode = `units:${blueUnits.length}:${militaryCount}:${this.attackMoveMode ? 'on' : 'off'}:${this.selection.formation ?? 'none'}`;
      } else if (blueBuilders.length > 0) {
        targetMode = `builder:${blueBuilders[0].id}:${this.attackMoveMode ? 'on' : 'off'}`;
      } else if (blueWorkers.length > 0) {
        targetMode = `worker:${blueWorkers[0].id}:${this.attackMoveMode ? 'on' : 'off'}`;
      } else if (blueUnits.length > 0) {
        const militaryCount = blueUnits.filter((u) => isMilitaryKind(u.kind)).length;
        targetMode = `units:${blueUnits.length}:${militaryCount}:${this.attackMoveMode ? 'on' : 'off'}:${this.selection.formation ?? 'none'}`;
      }

      if (actionPanel) actionPanel.hidden = false;
      if (actionPlaceholder) {
        actionPlaceholder.hidden = targetMode !== 'none';
        actionPlaceholder.textContent = selected.length === 0
          ? 'Selecione uma unidade ou estrutura para ver os comandos disponíveis.'
          : 'Esta seleção não possui comandos disponíveis.';
      }

      if (this.currentActionBarMode !== targetMode) {
        this.currentActionBarMode = targetMode;
        if (targetMode === 'none') {
          actionBar.setAttribute('hidden', '');
          actionBar.innerHTML = '';
        } else if (targetMode.startsWith('builder:') || targetMode.startsWith('worker:')) {
          const isBuilder = targetMode.startsWith('builder:');
          if (actionPanel) actionPanel.hidden = false;
          actionBar.removeAttribute('hidden');
          actionBar.innerHTML = `
            <div class="action-bar-header">Construir</div>
            <button id="btn-build-house" type="button">⌂ Casa</button>
            <button id="btn-build-barracks" type="button">⚔ Quartel</button>
            ${isBuilder ? '<button id="btn-build-barricade" type="button">▰ Barricada</button>' : ''}
            ${isBuilder ? '<button id="btn-build-tower" type="button">♜ Torre</button>' : ''}
            <button id="btn-attack-move" type="button" class="btn-attack-move ${this.attackMoveMode ? 'active' : ''}">⚔ Atacar e mover</button>
          `;
          document.querySelector('#btn-attack-move')?.addEventListener('click', () => {
            this.soundSystem.play('click');
            this.toggleAttackMoveMode();
          }, { signal: this.domListeners.signal });
          document.querySelector('#btn-build-house')?.addEventListener('click', () => {
            this.soundSystem.play('click');
            this.placementMode = { kind: 'house', width: 2, height: 2 };
            const fb = document.querySelector('#command-feedback');
            if (fb) fb.textContent = 'Clique no mapa para posicionar a Casa (2×2). Botão direito cancela.';
          }, { signal: this.domListeners.signal });
          document.querySelector('#btn-build-barracks')?.addEventListener('click', () => {
            this.soundSystem.play('click');
            this.placementMode = { kind: 'barracks', width: 3, height: 3 };
            const fb = document.querySelector('#command-feedback');
            if (fb) fb.textContent = 'Clique no mapa para posicionar o Quartel (3×3). Botão direito cancela.';
          }, { signal: this.domListeners.signal });
          if (isBuilder) {
            document.querySelector('#btn-build-barricade')?.addEventListener('click', () => {
              this.soundSystem.play('click');
              this.placementMode = { kind: 'barricade', width: 1, height: 1 };
              const fb = document.querySelector('#command-feedback');
              if (fb) fb.textContent = 'Clique no mapa para posicionar a Barricada (1×1). Botão direito cancela.';
            }, { signal: this.domListeners.signal });
            document.querySelector('#btn-build-tower')?.addEventListener('click', () => {
              this.soundSystem.play('click');
              this.placementMode = { kind: 'tower', width: 2, height: 2 };
              const fb = document.querySelector('#command-feedback');
              if (fb) fb.textContent = 'Clique no mapa para posicionar a Torre de Vigilância (2×2). Botão direito cancela.';
            }, { signal: this.domListeners.signal });
          }
        } else if (targetMode.startsWith('units:')) {
          const militaryCount = blueUnits.filter((u) => isMilitaryKind(u.kind)).length;
          const currentFmt = this.selection.formation;
          if (actionPanel) actionPanel.hidden = false;
          actionBar.removeAttribute('hidden');
          actionBar.innerHTML = `
            <button id="btn-attack-move" type="button" class="btn-attack-move ${this.attackMoveMode ? 'active' : ''}">⚔ Atacar e mover</button>
            ${militaryCount >= 2 ? `
              <div class="action-bar-header">Formação</div>
              <div class="formation-buttons">
                <button id="btn-formation-none" type="button" class="btn-formation btn-formation-none ${currentFmt === null ? 'active' : ''}">Livre</button>
                <button id="btn-formation-line" type="button" class="btn-formation ${currentFmt === 'line' ? 'active' : ''}">Linha</button>
                <button id="btn-formation-wedge" type="button" class="btn-formation ${currentFmt === 'wedge' ? 'active' : ''}">Cunha</button>
                <button id="btn-formation-block" type="button" class="btn-formation ${currentFmt === 'block' ? 'active' : ''}">Bloco</button>
                <button id="btn-formation-double-rank" type="button" class="btn-formation ${currentFmt === 'double-rank' ? 'active' : ''}">2 fileiras</button>
              </div>
            ` : ''}
          `;
          document.querySelector('#btn-attack-move')?.addEventListener('click', () => {
            this.soundSystem.play('click');
            this.toggleAttackMoveMode();
          }, { signal: this.domListeners.signal });
          if (militaryCount >= 2) {
            document.querySelector('#btn-formation-none')?.addEventListener('click', () => {
              this.soundSystem.play('click');
              this.selection.setFormation(null);
              for (const id of this.selection.selectedIds) {
                this.simulation.formations.removeUnit(id);
              }
              this.formationPreviewGraphics.clear();
              const fb = document.querySelector('#command-feedback');
              if (fb) fb.textContent = 'Modo Livre selecionado (sem formação). Movimentação e ataque livres.';
              this.refreshSelection();
            }, { signal: this.domListeners.signal });
            const bindFormation = (id: string, fmt: FormationType, label: string) => {
              document.querySelector(id)?.addEventListener('click', () => {
                this.soundSystem.play('click');
                this.selection.setFormation(fmt);
                const fb = document.querySelector('#command-feedback');
                if (fb) fb.textContent = `Formação ${label} selecionada. Clique com o botão direito para movimentar.`;
                this.refreshSelection();
              }, { signal: this.domListeners.signal });
            };
            bindFormation('#btn-formation-line', 'line', 'Linha');
            bindFormation('#btn-formation-wedge', 'wedge', 'Cunha');
            bindFormation('#btn-formation-block', 'block', 'Bloco');
            bindFormation('#btn-formation-double-rank', 'double-rank', 'Duas Fileiras');
          }
        } else if (targetMode.startsWith('base:')) {
          actionBar.setAttribute('hidden', '');
          actionBar.innerHTML = '';
        } else if (targetMode.startsWith('house:')) {
          const house = (selected.find((e): e is BuildingEntity => e.category === 'building' && e.kind === 'house' && e.team === 'blue') ?? selected[0]) as BuildingEntity;
          actionBar.removeAttribute('hidden');
          if (house.underConstruction) {
            actionBar.setAttribute('hidden', '');
            actionBar.innerHTML = '';
          } else {
            actionBar.innerHTML = `
              <div class="action-bar-header">Treinar</div>
              <button id="btn-produce-worker" type="button">⛏ Operário</button>
              <button id="btn-produce-builder" type="button">⚒ Construtor</button>
              <div class="secondary-actions">
                <button id="btn-set-rally" type="button" aria-label="Definir ponto de reunião" class="btn-set-rally ${this.rallyPlacementMode && this.rallyBuildingId === house.id ? 'active' : ''}">⚑</button>
                ${house.rallyPoint ? '<button id="btn-clear-rally" type="button" aria-label="Remover ponto de reunião" class="btn-clear-rally">×</button>' : ''}
              </div>
              <div id="queue-info-label" class="queue-info"></div>
            `;
            document.querySelector('#btn-produce-worker')?.addEventListener('click', () => {
              const res = this.simulation.issueCommand({ type: 'produce', team: 'blue', buildingId: house.id, unitKind: 'worker' });
              if (res.accepted) this.soundSystem.play('order');
              const fb = document.querySelector('#command-feedback');
              if (fb) fb.textContent = res.accepted ? 'Operário adicionado à fila de produção.' : `Produção indisponível: ${rejection(res.reason)}.`;
              this.refreshSelection();
              this.refreshTeamStatus();
            }, { signal: this.domListeners.signal });
            document.querySelector('#btn-produce-builder')?.addEventListener('click', () => {
              const res = this.simulation.issueCommand({ type: 'produce', team: 'blue', buildingId: house.id, unitKind: 'builder' });
              if (res.accepted) this.soundSystem.play('order');
              const fb = document.querySelector('#command-feedback');
              if (fb) fb.textContent = res.accepted ? 'Construtor adicionado à fila de produção.' : `Produção indisponível: ${rejection(res.reason)}.`;
              this.refreshSelection();
              this.refreshTeamStatus();
            }, { signal: this.domListeners.signal });
            document.querySelector('#btn-set-rally')?.addEventListener('click', () => {
              this.soundSystem.play('click');
              this.toggleRallyPlacementMode(house.id);
            }, { signal: this.domListeners.signal });
            document.querySelector('#btn-clear-rally')?.addEventListener('click', () => {
              this.soundSystem.play('click');
              const res = this.simulation.issueCommand({ type: 'set-rally-point', team: 'blue', buildingId: house.id, point: null });
              const fb = document.querySelector('#command-feedback');
              if (fb) fb.textContent = res.accepted ? 'Ponto de reunião removido.' : 'Erro ao remover ponto de reunião.';
              this.refreshSelection();
            }, { signal: this.domListeners.signal });
          }
        } else if (targetMode.startsWith('barracks:')) {
          const barracks = (selected.find((e): e is BuildingEntity => e.category === 'building' && e.team === 'blue') ?? selected[0]) as BuildingEntity;
          actionBar.removeAttribute('hidden');
          if (barracks.underConstruction) {
            actionBar.setAttribute('hidden', '');
            actionBar.innerHTML = '';
          } else {
            actionBar.innerHTML = `
              <div class="action-bar-header">Treinar</div>
              <button id="btn-produce-soldier" type="button">⚔ Soldado</button>
              <button id="btn-produce-archer" type="button">➶ Arqueiro</button>
              <button id="btn-produce-shieldbearer" type="button">🛡 Escudeiro</button>
              <button id="btn-produce-scout" type="button">◉ Batedor</button>
              <div class="secondary-actions">
                <button id="btn-set-rally" type="button" aria-label="Definir ponto de reunião" class="btn-set-rally ${this.rallyPlacementMode && this.rallyBuildingId === barracks.id ? 'active' : ''}">⚑</button>
                ${barracks.rallyPoint ? '<button id="btn-clear-rally" type="button" aria-label="Remover ponto de reunião" class="btn-clear-rally">×</button>' : ''}
              </div>
              <div id="queue-info-label" class="queue-info"></div>
            `;
            const bindProduce = (id: string, kind: UnitKind) => {
              document.querySelector(id)?.addEventListener('click', () => {
                const res = this.simulation.issueCommand({ type: 'produce', team: 'blue', buildingId: barracks.id, unitKind: kind });
                if (res.accepted) this.soundSystem.play('order');
                const fb = document.querySelector('#command-feedback');
                if (fb) fb.textContent = res.accepted ? `${LABELS[kind]} adicionado à fila de produção.` : `Produção indisponível: ${rejection(res.reason)}.`;
                this.refreshSelection();
                this.refreshTeamStatus();
              }, { signal: this.domListeners.signal });
            };
            bindProduce('#btn-produce-soldier', 'soldier');
            bindProduce('#btn-produce-archer', 'archer');
            bindProduce('#btn-produce-shieldbearer', 'shieldbearer');
            bindProduce('#btn-produce-scout', 'scout');
            document.querySelector('#btn-set-rally')?.addEventListener('click', () => {
              this.soundSystem.play('click');
              this.toggleRallyPlacementMode(barracks.id);
            }, { signal: this.domListeners.signal });
            document.querySelector('#btn-clear-rally')?.addEventListener('click', () => {
              this.soundSystem.play('click');
              const res = this.simulation.issueCommand({ type: 'set-rally-point', team: 'blue', buildingId: barracks.id, point: null });
              const fb = document.querySelector('#command-feedback');
              if (fb) fb.textContent = res.accepted ? 'Ponto de reunião removido.' : 'Erro ao remover ponto de reunião.';
              this.refreshSelection();
            }, { signal: this.domListeners.signal });
          }
        } else if (targetMode.startsWith('tower:')) {
          const tower = (selected.find((e): e is BuildingEntity => e.category === 'building' && e.kind === 'tower' && e.team === 'blue') ?? selected[0]) as BuildingEntity;
          if (tower.underConstruction) {
            actionBar.setAttribute('hidden', '');
            actionBar.innerHTML = '';
          } else {
            actionBar.setAttribute('hidden', '');
            actionBar.innerHTML = '';
          }
        }
        this.decorateActionBar(actionBar);
      }

      if (actionPanel) actionPanel.hidden = false;
      if (actionPlaceholder) {
        const hasActions = !actionBar.hasAttribute('hidden');
        actionPlaceholder.hidden = hasActions;
        if (!hasActions) {
          actionPlaceholder.textContent = selected.length === 0
            ? 'Selecione uma unidade ou estrutura para ver os comandos disponíveis.'
            : first?.category === 'building' && first.underConstruction
              ? 'Os comandos ficam disponíveis quando a construção terminar.'
              : 'Esta seleção não possui comandos disponíveis.';
        }
      }

      if (targetMode.endsWith(':building')) {
        const building = (selected.find((e): e is BuildingEntity => e.category === 'building' && e.team === 'blue') ?? selected[0]) as BuildingEntity;
        if (building) {
          const rem = Math.ceil((building.buildTotalTicks - building.buildProgressTicks) / TICKS_PER_SECOND);
          const label = document.querySelector('#build-progress-label');
          if (label) label.textContent = `${LABELS[building.kind]} em construção... (${rem}s restantes)`;
        }
      } else if (targetMode.endsWith(':ready') && !targetMode.startsWith('base:')) {
        const building = (selected.find((e): e is BuildingEntity => e.category === 'building' && e.team === 'blue') ?? selected[0]) as BuildingEntity;
        if (building) {
          const queue = this.simulation.production.queueFor(building.id);
          const queueStr = queue.length > 0
            ? `Fila: ${queue.map((item, i) => `${LABELS[item.unitKind]} (${i === 0 ? Math.ceil((item.totalTicks - item.progressTicks) / TICKS_PER_SECOND) + 's' : 'na fila'})`).join(', ')}`
            : '';
          const label = document.querySelector('#queue-info-label');
          if (label) label.textContent = queueStr;
        }
      }
    }
  }

  private refreshSelection(): void {
    this.drawSelectionVisuals();
    this.refreshSelectionDOM();
  }

  private decorateActionBar(actionBar: Element): void {
    const unitDetails: Record<string, { kind: UnitKind; description: string }> = {
      'btn-produce-worker': { kind: 'worker', description: `Coleta madeira e pedra, minera ouro (${BALANCE.economy.mine.coinsPerCycle} moedas a cada ${BALANCE.economy.mine.cycleSeconds}s) e gera ${BALANCE.economy.passiveCoinsPerFreeWorkerPerSecond} moeda/s enquanto livre.` },
      'btn-produce-builder': { kind: 'builder', description: 'Constrói casas e quartéis; também ergue barricadas e torres.' },
      'btn-produce-soldier': { kind: 'soldier', description: 'Infantaria de combate corpo a corpo.' },
      'btn-produce-archer': { kind: 'archer', description: 'Ataca à distância com alcance superior.' },
      'btn-produce-shieldbearer': { kind: 'shieldbearer', description: `Unidade resistente; reflete ${BALANCE.units.shieldbearer.reflectionPercent}% do dano de atacantes adjacentes.` },
      'btn-produce-scout': { kind: 'scout', description: `Unidade rápida com visão ${BALANCE.units.scout.vision}; detecta batedores furtivos a ${BALANCE.units.scout.stealthDetectionDistance} casas.` },
    };
    const buildingDetails: Record<string, { kind: keyof typeof BALANCE.buildings; description: string }> = {
      'btn-build-house': { kind: 'house', description: `Treina operários e construtores; adiciona ${BALANCE.buildings.house.civilianCapacity} vagas civis.` },
      'btn-build-barracks': { kind: 'barracks', description: `Treina tropas; adiciona ${BALANCE.buildings.barracks.militaryCapacity} vagas militares.` },
      'btn-build-barricade': { kind: 'barricade', description: 'Defesa fixa que bloqueia passagem.' },
      'btn-build-tower': { kind: 'tower', description: `Revela ${BALANCE.buildings.tower.vision} casas de visão e detecta batedores; não ataca.` },
    };
    for (const [id, item] of Object.entries(unitDetails)) {
      const button = actionBar.querySelector<HTMLButtonElement>(`#${id}`);
      if (!button) continue;
      const stats = BALANCE.units[item.kind];
      button.dataset.tooltipTitle = LABELS[item.kind];
      button.dataset.tooltipDescription = `${item.description} Vida ${stats.hp}; dano ${stats.damage}; alcance ${stats.range}; movimento ${stats.movement}; visão ${stats.vision}. Custa ${stats.coins} ouro; treino ${stats.productionSeconds}s.`;
      const cost = document.createElement('small');
      cost.className = 'button-cost';
      cost.textContent = `${resourceCost(stats.coins, stats.wood, 0)} · ${stats.productionSeconds}s`;
      button.append(cost);
    }
    for (const [id, item] of Object.entries(buildingDetails)) {
      const button = actionBar.querySelector<HTMLButtonElement>(`#${id}`);
      if (!button) continue;
      const stats = BALANCE.buildings[item.kind];
      button.dataset.tooltipTitle = LABELS[item.kind];
      button.dataset.tooltipDescription = `${item.description} Custa ${resourceCost(stats.coins, stats.wood, stats.stone)}; construção ${stats.buildSeconds}s.`;
      const cost = document.createElement('small');
      cost.className = 'button-cost';
      cost.textContent = `${resourceCost(stats.coins, stats.wood, stats.stone)} · ${stats.buildSeconds}s`;
      button.append(cost);
    }
    const tips: Record<string, [string, string]> = {
      'btn-attack-move': ['Avançar e atacar', 'Move até o destino e engaja inimigos encontrados pelo caminho.'],
      'btn-formation-none': ['Modo livre', 'Remove a formação e deixa cada unidade mover e atacar livremente.'],
      'btn-formation-line': ['Linha', 'Organiza as unidades em uma linha ao receber uma ordem de movimento.'],
      'btn-formation-wedge': ['Cunha', 'Organiza as unidades em formação de cunha.'],
      'btn-formation-block': ['Bloco', 'Organiza as unidades em formação compacta.'],
      'btn-formation-double-rank': ['Duas fileiras', 'Organiza as unidades em duas fileiras.'],
      'btn-set-rally': ['Ponto de reunião', 'Escolha uma célula no mapa para enviar as unidades recém-produzidas.'],
      'btn-clear-rally': ['Remover ponto', 'Remove o ponto de reunião desta estrutura.'],
    };
    for (const [id, [title, description]] of Object.entries(tips)) {
      const button = actionBar.querySelector<HTMLButtonElement>(`#${id}`);
      if (!button) continue;
      button.dataset.tooltipTitle = title;
      button.dataset.tooltipDescription = description;
    }
  }

  private updateWorldTooltip(pointer: Phaser.Input.Pointer): void {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const entity = this.simulation.entities.atCell(Math.floor(world.x / CELL_SIZE), Math.floor(world.y / CELL_SIZE));
    const visible = entity && this.visualFog.isEntityVisible(entity);
    if (!visible || !entity) {
      this.hoveredEntityId = null;
      if (this.hoverTooltipTimer !== null) window.clearTimeout(this.hoverTooltipTimer);
      this.hoverTooltipTimer = null;
      this.tooltipManager?.hideAt();
      return;
    }
    if (entity.id === this.hoveredEntityId) return;
    this.hoveredEntityId = entity.id;
    if (this.hoverTooltipTimer !== null) window.clearTimeout(this.hoverTooltipTimer);
    this.tooltipManager?.hideAt();
    const title = LABELS[entity.kind];
    const description = entity.category === 'unit'
      ? `${entity.hp}/${entity.maxHp} vida · ${entity.damage ? `${entity.damage} dano · alcance ${entity.range}` : 'sem ataque'} · movimento ${entity.movement} · visão ${entity.vision}${entity.kind === 'worker' ? ' · coleta madeira/pedra e minera ouro' : entity.kind === 'builder' ? ' · constrói estruturas defensivas' : ''}`
      : `${entity.hp}/${entity.maxHp} vida${entity.underConstruction ? ' · em construção' : entity.kind === 'tower' ? ' · visão 20×20 · detecta batedores' : ''}`;
    this.hoverTooltipTimer = window.setTimeout(() => {
      if (this.hoveredEntityId === entity.id) this.tooltipManager?.showAt(title, description, pointer.x, pointer.y);
      this.hoverTooltipTimer = null;
    }, 260);
  }

  private refreshTeamStatus(): void {
    const team = this.simulation.teams.blue;
    const cap = this.simulation.production.getCapacity('blue');
    const units = this.simulation.entities.all().filter((entity) => entity.team === 'blue' && entity.category === 'unit').length;
    const setValue = (selector: string, value: string) => {
      const element = document.querySelector(selector);
      if (element && element.textContent !== value) element.textContent = value;
    };
    setValue('#gold-value', Math.floor(team.coins).toLocaleString('pt-BR'));
    setValue('#wood-value', Math.floor(team.wood).toLocaleString('pt-BR'));
    setValue('#stone-value', Math.floor(team.stone).toLocaleString('pt-BR'));
    setValue('#population-value', `${cap.totalUnits} / ${cap.maxTotalUnits}`);
    for (const [selector, label, value] of [
      ['#gold-value', 'Ouro', Math.floor(team.coins).toLocaleString('pt-BR')],
      ['#wood-value', 'Madeira', Math.floor(team.wood).toLocaleString('pt-BR')],
      ['#stone-value', 'Pedra', Math.floor(team.stone).toLocaleString('pt-BR')],
      ['#population-value', 'População', `${cap.totalUnits} de ${cap.maxTotalUnits}`],
    ] as const) {
      document.querySelector(selector)?.parentElement?.setAttribute('aria-label', `${label}: ${value}`);
    }
    document.querySelector<HTMLElement>('.population-pill')?.setAttribute('data-tooltip-description',
      `População: ${cap.totalUnits}/${cap.maxTotalUnits}. Civil: ${cap.civilianUnits}/${cap.civilianCapacity}. Militar: ${cap.militaryUnits}/${cap.militaryCapacity}. Casas ampliam vagas civis; quartéis ampliam vagas militares.`);
    setValue('#team-status', `Azul · ${Math.floor(team.coins)} moedas · ${Math.floor(team.wood)} madeira · ${Math.floor(team.stone)} pedra · ${units}/${BALANCE.map.unitCapPerTeam} unidades`);
    const capStatus = document.querySelector('#capacity-status');
    if (capStatus) {
      const fullCapacity = `Civil: ${cap.civilianUnits}/${cap.civilianCapacity} · Militar: ${cap.militaryUnits}/${cap.militaryCapacity} · Total: ${cap.totalUnits}/${cap.maxTotalUnits}`;
      capStatus.textContent = `Civil ${cap.civilianUnits}/${cap.civilianCapacity} · Mil ${cap.militaryUnits}/${cap.militaryCapacity}`;
      capStatus.setAttribute('title', fullCapacity);
      const isCivilianCapped = cap.civilianCapacity > 0 && cap.civilianUnits >= cap.civilianCapacity;
      const isMilitaryCapped = cap.militaryCapacity > 0 && cap.militaryUnits >= cap.militaryCapacity;
      const isTotalCapped = cap.totalUnits >= cap.maxTotalUnits;
      const isCapped = isCivilianCapped || isMilitaryCapped || isTotalCapped;
      capStatus.classList.toggle('capacity-warning', isCapped);
    }
  }

  private inspect(pointer: Phaser.Input.Pointer): void {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const x = Math.floor(world.x / CELL_SIZE);
    const y = Math.floor(world.y / CELL_SIZE);
    const cell = this.map.cellAt(x, y);
    if (!cell) return;
    const panel = document.querySelector('#inspect');
    const occupant = this.simulation.entities.atCell(x, y);
    const fogState = this.simulation.fog.stateAt('blue', x, y);
    if (panel) panel.textContent = `Célula ${x}, ${y} · ${cell.terrain} · fog ${fogState} · ${cell.blocked || occupant ? 'ocupada/bloqueada' : 'livre'}${occupant ? ` · ${occupant.id}` : ''}`;
    document.querySelector('#game')?.setAttribute('data-cell', `${x},${y}`);
  }

  private lastEscapeTime = 0;

  handleEscape(): void {
    if (this.simulation.result) return;
    const now = performance.now();
    if (now - this.lastEscapeTime < 150) return;
    this.lastEscapeTime = now;

    let cancelled = false;
    if (this.placementMode) {
      this.placementMode = null;
      this.barricadeDragStart = null;
      this.barricadeLineCells = [];
      this.barricadeLastEndCell = null;
      this.barricadeLineValidation = null;
      this.placementGhostGraphics.clear();
      cancelled = true;
    }
    if (this.attackMoveMode) {
      this.attackMoveMode = false;
      this.placementGhostGraphics.clear();
      this.formationPreviewGraphics.clear();
      cancelled = true;
    }
    if (this.rallyPlacementMode) {
      this.rallyPlacementMode = false;
      this.rallyBuildingId = null;
      this.placementGhostGraphics.clear();
      cancelled = true;
    }

    // If tactical formation is active, cancel it (switch to Free Mode)
    // and detach selected units from formation constraints so they can move/attack freely
    if (this.selection.formation !== null) {
      this.selection.setFormation(null);
      for (const id of this.selection.selectedIds) {
        this.simulation.formations.removeUnit(id);
      }
      this.formationPreviewGraphics.clear();
      this.soundSystem.play('click');
      const fb = document.querySelector('#command-feedback');
      if (fb) fb.textContent = 'Formação desativada (Modo Livre). Movimentação e ataque livres.';
      this.refreshSelection();
      return;
    }

    if (cancelled) {
      this.soundSystem.play('click');
      const fb = document.querySelector('#command-feedback');
      if (fb) fb.textContent = 'Comando cancelado.';
      this.refreshSelection();
      return;
    }

    // If already in Free Mode and units are selected, clear selection
    if (this.selection.selectedIds.length > 0) {
      this.selection.clear();
      this.soundSystem.play('click');
      this.refreshSelection();
    }
  }

  centerCameraOn(cellX: number, cellY: number): void {
    const clampedX = Math.max(0, Math.min(this.map.width - 1, cellX));
    const clampedY = Math.max(0, Math.min(this.map.height - 1, cellY));
    this.cameras.main.centerOn((clampedX + 0.5) * CELL_SIZE, (clampedY + 0.5) * CELL_SIZE);
  }

  private getMapCoverZoom(): number {
    const worldWidth = this.map.width * CELL_SIZE;
    const worldHeight = this.map.height * CELL_SIZE;
    const coverZoom = Math.max(this.scale.width / worldWidth, this.scale.height / worldHeight);
    return Math.max(MIN_ZOOM, coverZoom * 1.015);
  }
}
