import Phaser from 'phaser';
declare const __TINY_SWORDS_INSTALLED__: boolean;
const missingAssetWarnings = new Set<string>();
function warnMissingAsset(message: string): void {
  if (!import.meta.env.DEV || !__TINY_SWORDS_INSTALLED__ || missingAssetWarnings.has(message)) return;
  missingAssetWarnings.add(message);
  console.warn(message);
}
import type { BuildingKind, UnitKind } from '../core/entities/EntityStore';
import type { Team } from '../map/MapGrid';

// Tiny Swords is a presentation set. Neither its frame count nor its size affects the simulation.
export type UnitVisualState = 'idle' | 'move' | 'attack' | 'guard' | 'gatherWood'
  | 'gatherStone' | 'mine' | 'carryWood' | 'carryStone' | 'build';

interface Sheet { file: string; frames: number; frameSize?: number }
export interface UnitVisualDefinition {
  family: 'Pawn' | 'Warrior' | 'Archer' | 'Lancer' | 'Monk';
  states: Partial<Record<UnitVisualState, Sheet>>;
  /** Display size of the square animation frame in world pixels, not source pixels. */
  frameDisplaySize: number;
  /** Audited opaque character bounds in world pixels, used for ground anchoring and UI. */
  visibleWidth: number;
  visibleHeight: number;
  originY: number;
}

export const WORLD_VISUAL_METRICS = {
  cellSize: 12,
  referenceUnitHeight: 17.2,
  ySortBase: 1,
  ySortPerCell: 0.005,
  ySortTieBreak: 0.001,
  entityViewportMarginCells: 3,
  unitHpBarGap: 2,
  unitHpBarHeight: 1.5,
  buildingHpBarGap: 2,
  buildingHpBarHeight: 2,
  unitSelectionPadding: 2,
  unitSelectionEllipseHeight: 7,
  terrainViewportMarginCells: 4,
  mountainCliffHeightCells: 2,
  mountainRidgeHeightCells: 2,
  mountainRidgeStrideCells: 5,
  hiddenMountainAlpha: 0.34,
  hiddenWaterAlpha: 0.25,
} as const;

export const WORLD_LAYER_DEPTHS = {
  fogRelief: 0.4,
  entityOverlays: 3,
  combat: 4,
  worldEffects: 5,
  selection: 6,
  interaction: 7,
} as const;

/**
 * Audited against alpha bounds of the pack's 192 px animation frames.
 * The soldier's ~89 px opaque idle silhouette is the 1.0 visual reference.
 */
export const UNIT_VISUALS: Record<UnitKind, UnitVisualDefinition> = {
  worker: { family: 'Pawn', frameDisplaySize: 43, visibleWidth: 12, visibleHeight: 16.6, originY: 0.703, states: {
    idle: { file: 'Pawn_Idle', frames: 8 }, move: { file: 'Pawn_Run', frames: 6 },
    gatherWood: { file: 'Pawn_Interact Axe', frames: 6 },
    gatherStone: { file: 'Pawn_Interact Pickaxe', frames: 6 },
    mine: { file: 'Pawn_Interact Pickaxe', frames: 6 },
    carryWood: { file: 'Pawn_Run Wood', frames: 6 },
    carryStone: { file: 'Pawn_Run Pickaxe', frames: 6 },
    build: { file: 'Pawn_Interact Hammer', frames: 3 },
    attack: { file: 'Pawn_Interact Axe', frames: 6 },
  } },
  builder: { family: 'Pawn', frameDisplaySize: 43, visibleWidth: 12, visibleHeight: 16.6, originY: 0.703, states: {
    idle: { file: 'Pawn_Idle', frames: 8 }, move: { file: 'Pawn_Run', frames: 6 },
    gatherWood: { file: 'Pawn_Interact Axe', frames: 6 },
    gatherStone: { file: 'Pawn_Interact Pickaxe', frames: 6 },
    mine: { file: 'Pawn_Interact Pickaxe', frames: 6 },
    carryWood: { file: 'Pawn_Run Wood', frames: 6 },
    carryStone: { file: 'Pawn_Run Pickaxe', frames: 6 },
    build: { file: 'Pawn_Interact Hammer', frames: 3 },
    attack: { file: 'Pawn_Interact Axe', frames: 6 },
  } },
  soldier: { family: 'Warrior', frameDisplaySize: 37, visibleWidth: 15, visibleHeight: 17.2, originY: 0.714, states: {
    idle: { file: 'Warrior_Idle', frames: 8 }, move: { file: 'Warrior_Run', frames: 6 },
    attack: { file: 'Warrior_Attack1', frames: 4 }, guard: { file: 'Warrior_Guard', frames: 6 },
  } },
  archer: { family: 'Archer', frameDisplaySize: 37, visibleWidth: 14, visibleHeight: 17, originY: 0.708, states: {
    idle: { file: 'Archer_Idle', frames: 6 }, move: { file: 'Archer_Run', frames: 4 },
    attack: { file: 'Archer_Shoot', frames: 8 },
  } },
  shieldbearer: { family: 'Warrior', frameDisplaySize: 42, visibleWidth: 17, visibleHeight: 19.5, originY: 0.714, states: {
    idle: { file: 'Warrior_Idle', frames: 8 },
    move: { file: 'Warrior_Run', frames: 6 },
    guard: { file: 'Warrior_Guard', frames: 6 },
    attack: { file: 'Warrior_Attack2', frames: 4 },
  } },
  // Foot scout: the Lancer's spear creates a distinct exploration silhouette without implying magic or a mount.
  scout: { family: 'Lancer', frameDisplaySize: 46, visibleWidth: 16.5, visibleHeight: 34.5, originY: 1, states: {
    idle: { file: 'Lancer_Idle', frames: 20 },
    move: { file: 'Lancer_Run', frames: 10 },
    attack: { file: 'Lancer_Down_Attack', frames: 5 },
    guard: { file: 'Lancer_Down_Defence', frames: 10 },
  } },
};

export interface DisplayMetrics {
  width: number; height: number; visibleWidth: number; visibleHeight: number; originX: number; originY: number;
}

/** Presentation metrics are independent from EntityStore/MapGrid footprints. */
export const BUILDING_VISUALS: Record<BuildingKind, DisplayMetrics> = {
  base: { width: 54, height: 44, visibleWidth: 52.6, visibleHeight: 35.8, originX: 0.5, originY: 0.973 },
  house: { width: 22, height: 33, visibleWidth: 19.3, visibleHeight: 27, originX: 0.5, originY: 0.901 },
  barracks: { width: 36, height: 48, visibleWidth: 34.5, visibleHeight: 35.1, originX: 0.5, originY: 0.957 },
  tower: { width: 24, height: 48, visibleWidth: 22.5, visibleHeight: 34.5, originX: 0.5, originY: 0.898 },
  barricade: { width: 16, height: 16, visibleWidth: 15.5, visibleHeight: 10.5, originX: 0.5, originY: 0.8125 },
};

export const BARRICADE_VISUALS = {
  texturePrefix: 'tiny-barricade-wood-mask-',
  sourceKey: 'tiny-woodResource',
} as const;

export type BarricadeVariant = 'isolated' | 'horizontal-end' | 'vertical-end'
  | 'horizontal' | 'vertical' | 'corner' | 't-junction' | 'cross';

export function barricadeNeighborMask(north: boolean, east: boolean, south: boolean, west: boolean): number {
  return (north ? 1 : 0) | (east ? 2 : 0) | (south ? 4 : 0) | (west ? 8 : 0);
}

export function barricadeVariantForMask(mask: number): BarricadeVariant {
  const links = mask & 15;
  const count = (links & 1) + ((links >> 1) & 1) + ((links >> 2) & 1) + ((links >> 3) & 1);
  if (count === 0) return 'isolated';
  if (count === 1) return (links & 10) ? 'horizontal-end' : 'vertical-end';
  if (count === 2 && (links === 10 || links === 5)) return links === 10 ? 'horizontal' : 'vertical';
  if (count === 2) return 'corner';
  if (count === 3) return 't-junction';
  return 'cross';
}

export function barricadeTextureKey(mask: number): string {
  return `${BARRICADE_VISUALS.texturePrefix}${mask & 15}`;
}

export const RESOURCE_VISUALS = {
  // Gold Stone 5/6 have broader visible clusters; bottom alpha edge anchors at ~0.78.
  gold: { width: 36, height: 36, originX: 0.5, originY: 0.78 },
  stoneDeposit: { width: 15, height: 15, originX: 0.5, originY: 0.828 },
  decorationStone: { width: 9, height: 8, originX: 0.5, originY: 0.82 },
  waterRock: { width: 11, height: 11, originX: 0.5, originY: 0.82 },
  bush: { width: 14, height: 14, originX: 0.5, originY: 0.617 },
  smallTree: { width: 22, height: 30, originX: 0.5, originY: 0.941 },
  forestTreeA: { width: 30, height: 40, originX: 0.5, originY: 0.941 },
  forestTreeB: { width: 36, height: 36, originX: 0.5, originY: 0.885 },
  forestTreeSpacingModulo: 5,
  plainDecorationModulo: 17,
  mountainBush: { width: 18, height: 18, originX: 0.5, originY: 0.617 },
  waterFoam: { width: 13, height: 6, originX: 0.5, originY: 1 },
} as const;

export const FX_LIMITS = {
  activeWorldEffects: 96,
  activeProjectiles: 36,
  activeAttackTrails: 96,
  ambientEffectsPerSecond: 8,
} as const;

export const FX_VISUALS = {
  dust: { width: 13, height: 13 },
  explosion: { width: 20, height: 20 },
  projectile: { width: 10, height: 10 },
  hitDurationMs: 90,
  hitMarkerRadius: 5.5,
  hitMarkerRingGrowth: 3.5,
  arrowMinDurationMs: 100,
  arrowMaxDurationMs: 320,
  arrowTravelPixelsPerMs: 0.42,
  impactDurationMs: 150,
  structureImpactDurationMs: 220,
  completionDurationMs: 360,
  deathDurationMs: 420,
  constructionIntervalMs: 1000,
  gatherIntervalMs: 1000,
  orderDurationMs: 400,
  attackLineWidth: 2,
  impactDotRadius: 2.5,
  impactRingRadius: 2,
  impactRingGrowth: 8,
  impactRingLineWidth: 1.5,
  worldRingStartRadius: 2,
  worldRingGrowth: 10,
  worldRingLineWidth: 1.5,
  sparkHalfLength: 2,
  sparkLineWidth: 1.5,
  sparkRadius: 1,
  sparkGrowth: 3,
} as const;

/** Backwards-compatible name for the pre-existing calibration board. */
export const EFFECT_VISUALS = FX_VISUALS;

export function ySortedWorldDepth(footCellY: number, tieBreak = 0): number {
  return WORLD_VISUAL_METRICS.ySortBase + footCellY * WORLD_VISUAL_METRICS.ySortPerCell
    + tieBreak * WORLD_VISUAL_METRICS.ySortTieBreak;
}

const root = `${import.meta.env.BASE_URL}assets/tiny-swords/`;
const teamColor: Record<Team, string> = { blue: 'Yellow', red: 'Red' };
const staticAssets = {
  terrain: 'Terrain/Tileset/Tilemap_color3.png',
  terrainHigh: 'Terrain/Tileset/Tilemap_color1.png',
  water: 'Terrain/Tileset/Water Background color.png',
  waterFoam: 'Terrain/Tileset/Water Foam.png',
  woodResource: 'Terrain/Resources/Wood/Wood Resource/Wood Resource.png',
  tree1: 'Terrain/Resources/Wood/Trees/Tree1.png',
  tree2: 'Terrain/Resources/Wood/Trees/Tree2.png',
  tree3: 'Terrain/Resources/Wood/Trees/Tree3.png',
  tree4: 'Terrain/Resources/Wood/Trees/Tree4.png',
  gold: 'Terrain/Resources/Gold/Gold Stones/Gold Stone 3.png',
  gold1: 'Terrain/Resources/Gold/Gold Stones/Gold Stone 1.png',
  gold2: 'Terrain/Resources/Gold/Gold Stones/Gold Stone 2.png',
  gold4: 'Terrain/Resources/Gold/Gold Stones/Gold Stone 4.png',
  gold5: 'Terrain/Resources/Gold/Gold Stones/Gold Stone 5.png',
  gold6: 'Terrain/Resources/Gold/Gold Stones/Gold Stone 6.png',
  stone: 'Terrain/Decorations/Rocks/Rock2.png',
  stone1: 'Terrain/Decorations/Rocks/Rock1.png',
  stone3: 'Terrain/Decorations/Rocks/Rock3.png',
  stone4: 'Terrain/Decorations/Rocks/Rock4.png',
  waterRock: 'Terrain/Decorations/Rocks in the Water/Water Rocks_01.png',
  waterRock2: 'Terrain/Decorations/Rocks in the Water/Water Rocks_02.png',
  waterRock3: 'Terrain/Decorations/Rocks in the Water/Water Rocks_03.png',
  bush: 'Terrain/Decorations/Bushes/Bushe1.png',
  bush2: 'Terrain/Decorations/Bushes/Bushe2.png',
  bush3: 'Terrain/Decorations/Bushes/Bushe3.png',
  bush4: 'Terrain/Decorations/Bushes/Bushe4.png',
  dust: 'Particle FX/Dust_01.png',
  explosion: 'Particle FX/Explosion_01.png',
  arrowYellow: 'Units/Yellow Units/Archer/Arrow.png',
  arrowRed: 'Units/Red Units/Archer/Arrow.png',
} as const;

const buildingFiles: Record<BuildingKind, string> = {
  base: 'Castle', house: 'House1', barracks: 'Barracks', tower: 'Tower',
  // No wall/fence/palisade exists in this free pack. A rock keeps the 1x1 footprint legible.
  barricade: '',
};

export function unitSheetKey(team: Team, kind: UnitKind, state: UnitVisualState): string {
  const definition = UNIT_VISUALS[kind];
  const file = definition.states[state]?.file ?? definition.states.idle?.file ?? 'Idle';
  return `tiny-unit-${team}-${definition.family}-${file.replace(/[^a-zA-Z0-9]/g, '')}`;
}

export function builderUnitSheetKey(team: Team, state: UnitVisualState): string {
  const definition = UNIT_VISUALS.builder;
  const file = definition.states[state]?.file ?? definition.states.idle?.file ?? 'Idle';
  return `tiny-builder-${team}-${definition.family}-${file.replace(/[^a-zA-Z0-9]/g, '')}`;
}

export function buildingKey(team: Team, kind: BuildingKind): string {
  return kind === 'barricade' ? 'tiny-stone' : `tiny-building-${team}-${kind}`;
}


export interface TinySwordsLocalAsset {
  key: string;
  path: string;
  frameWidth?: number;
  frameHeight?: number;
  frames?: number;
}

/** Mirrors the regular Phaser loader, but never includes generated builder derivatives. */
export function tinySwordsLocalManifest(): TinySwordsLocalAsset[] {
  const specs: TinySwordsLocalAsset[] = [];
  for (const [name, path] of Object.entries(staticAssets)) {
    const asset: TinySwordsLocalAsset = { key: `tiny-${name}`, path };
    if (name === 'tree1' || name === 'tree2') { asset.frameWidth = 192; asset.frameHeight = 256; }
    else if (['tree3', 'tree4', 'waterFoam', 'explosion'].includes(name)) {
      asset.frameWidth = 192; asset.frameHeight = 192;
    } else if (name.startsWith('bush')) { asset.frameWidth = 128; asset.frameHeight = 128; }
    else if (name.startsWith('waterRock') || name === 'dust') {
      asset.frameWidth = 64; asset.frameHeight = 64;
    }
    specs.push(asset);
  }
  const seen = new Set<string>();
  for (const team of ['blue', 'red'] as const) {
    const color = teamColor[team];
    for (const [kind, definition] of Object.entries(UNIT_VISUALS) as [UnitKind, UnitVisualDefinition][]) {
      for (const [state, sheet] of Object.entries(definition.states) as [UnitVisualState, Sheet][]) {
        const key = unitSheetKey(team, kind, state);
        if (seen.has(key)) continue;
        seen.add(key);
        const size = sheet.frameSize ?? 192;
        specs.push({
          key, path: `Units/${color} Units/${definition.family}/${sheet.file}.png`,
          frameWidth: size, frameHeight: size, frames: sheet.frames,
        });
      }
    }
    for (const [kind, file] of Object.entries(buildingFiles) as [BuildingKind, string][]) {
      if (file) specs.push({
        key: buildingKey(team, kind),
        path: `Buildings/${color} Buildings/${file}.png`,
      });
    }
  }
  return specs;
}

export function preloadTinySwords(scene: Phaser.Scene): void {
  // The original pack is only available after local install. Public builds use
  // fallback rendering or the private ZIP importer instead of fetching 100+ 404s.
  if (!__TINY_SWORDS_INSTALLED__) return;
  const loaded = new Set<string>();
  for (const [key, file] of Object.entries(staticAssets)) {
    const id = `tiny-${key}`;
    if (scene.textures.exists(id)) continue;
    if (key === 'tree1' || key === 'tree2') scene.load.spritesheet(id, encodeURI(root + file), { frameWidth: 192, frameHeight: 256 });
    else if (key === 'tree3' || key === 'tree4') scene.load.spritesheet(id, encodeURI(root + file), { frameWidth: 192, frameHeight: 192 });
    else if (key === 'bush') scene.load.spritesheet(id, encodeURI(root + file), { frameWidth: 128, frameHeight: 128 });
    else if (key === 'bush2' || key === 'bush3' || key === 'bush4') scene.load.spritesheet(id, encodeURI(root + file), { frameWidth: 128, frameHeight: 128 });
    else if (key === 'waterRock') scene.load.spritesheet(id, encodeURI(root + file), { frameWidth: 64, frameHeight: 64 });
    else if (key === 'waterRock2' || key === 'waterRock3') scene.load.spritesheet(id, encodeURI(root + file), { frameWidth: 64, frameHeight: 64 });
    else if (key === 'waterFoam') scene.load.spritesheet(id, encodeURI(root + file), { frameWidth: 192, frameHeight: 192 });
    else if (key === 'dust') scene.load.spritesheet(id, encodeURI(root + file), { frameWidth: 64, frameHeight: 64 });
    else if (key === 'explosion') scene.load.spritesheet(id, encodeURI(root + file), { frameWidth: 192, frameHeight: 192 });
    else scene.load.image(id, encodeURI(root + file));
  }
  for (const team of ['blue', 'red'] as const) {
    const color = teamColor[team];
    for (const [kind, definition] of Object.entries(UNIT_VISUALS) as [UnitKind, UnitVisualDefinition][]) {
      for (const [state, sheet] of Object.entries(definition.states) as [UnitVisualState, Sheet][]) {
        const key = unitSheetKey(team, kind, state);
        if (loaded.has(key) || scene.textures.exists(key)) continue;
        loaded.add(key);
        const size = sheet.frameSize ?? 192;
        scene.load.spritesheet(key,
          encodeURI(`${root}Units/${color} Units/${definition.family}/${sheet.file}.png`),
          { frameWidth: size, frameHeight: size, endFrame: sheet.frames - 1 });
      }
    }
    for (const [kind, file] of Object.entries(buildingFiles) as [BuildingKind, string][]) {
      if (file && !scene.textures.exists(buildingKey(team, kind))) scene.load.image(buildingKey(team, kind), encodeURI(`${root}Buildings/${color} Buildings/${file}.png`));
    }
    for (const [state, sheet] of Object.entries(UNIT_VISUALS.builder.states) as [UnitVisualState, Sheet][]) {
      const key = builderUnitSheetKey(team, state);
      if (loaded.has(key) || scene.textures.exists(key)) continue;
      loaded.add(key);
      const size = sheet.frameSize ?? 192;
      scene.load.spritesheet(key,
        encodeURI(`${import.meta.env.BASE_URL}assets/generated/builder/${color} Units/Pawn/${sheet.file}.png`),
        { frameWidth: size, frameHeight: size, endFrame: sheet.frames - 1 });
    }
  }
}

export function frameCount(kind: UnitKind, state: UnitVisualState): number {
  return UNIT_VISUALS[kind].states[state]?.frames ?? UNIT_VISUALS[kind].states.idle?.frames ?? 1;
}

export function availableUnitKey(scene: Phaser.Scene, team: Team, kind: UnitKind, state: UnitVisualState): string | null {
  const requested = unitSheetKey(team, kind, state);
  if (scene.textures.exists(requested)) return requested;
  const fallback = unitSheetKey(team, kind, 'idle');
  if (scene.textures.exists(fallback)) {
    warnMissingAsset(`Tiny Swords: missing ${requested}; using idle`);
    return fallback;
  }
  warnMissingAsset(`Tiny Swords: missing ${requested} and idle`);
  return null;
}
