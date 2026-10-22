import Phaser from 'phaser';
import type { BuildingKind, UnitKind } from '../core/entities/EntityStore';
import type { Team } from '../map/MapGrid';

// Tiny Swords is a presentation set. Neither its frame count nor its size affects the simulation.
export type UnitVisualState = 'idle' | 'move' | 'attack' | 'guard' | 'gatherWood'
  | 'gatherStone' | 'mine' | 'carryWood' | 'carryStone' | 'build';

interface Sheet { file: string; frames: number; frameSize?: number }
interface UnitVisualDefinition { family: 'Pawn' | 'Warrior' | 'Archer' | 'Lancer' | 'Monk'; states: Partial<Record<UnitVisualState, Sheet>>; size: number }

const pawn: UnitVisualDefinition = {
  family: 'Pawn', size: 36, states: {
    idle: { file: 'Pawn_Idle', frames: 8 }, move: { file: 'Pawn_Run', frames: 6 },
    gatherWood: { file: 'Pawn_Interact Axe', frames: 6 },
    gatherStone: { file: 'Pawn_Interact Pickaxe', frames: 6 },
    mine: { file: 'Pawn_Interact Pickaxe', frames: 6 },
    carryWood: { file: 'Pawn_Run Wood', frames: 6 },
    carryStone: { file: 'Pawn_Run Pickaxe', frames: 6 },
    build: { file: 'Pawn_Interact Hammer', frames: 3 },
    attack: { file: 'Pawn_Interact Axe', frames: 6 },
  },
};

export const UNIT_VISUALS: Record<UnitKind, UnitVisualDefinition> = {
  worker: pawn,
  builder: pawn,
  soldier: { family: 'Warrior', size: 36, states: {
    idle: { file: 'Warrior_Idle', frames: 8 }, move: { file: 'Warrior_Run', frames: 6 },
    attack: { file: 'Warrior_Attack1', frames: 4 }, guard: { file: 'Warrior_Guard', frames: 6 },
  } },
  archer: { family: 'Archer', size: 36, states: {
    idle: { file: 'Archer_Idle', frames: 6 }, move: { file: 'Archer_Run', frames: 4 },
    attack: { file: 'Archer_Shoot', frames: 8 },
  } },
  shieldbearer: { family: 'Warrior', size: 36, states: {
    idle: { file: 'Warrior_Idle', frames: 8 },
    move: { file: 'Warrior_Run', frames: 6 },
    guard: { file: 'Warrior_Guard', frames: 6 },
    attack: { file: 'Warrior_Attack1', frames: 4 },
  } },
  // Monk is a readable temporary scout; the pack has no mounted reconnaissance unit.
  scout: { family: 'Monk', size: 36, states: {
    idle: { file: 'Idle', frames: 6 }, move: { file: 'Run', frames: 4 },
  } },
};

const root = `${import.meta.env.BASE_URL}assets/tiny-swords/`;
const teamColor: Record<Team, string> = { blue: 'Yellow', red: 'Red' };
const staticAssets = {
  terrain: 'Terrain/Tileset/Tilemap_color3.png',
  water: 'Terrain/Tileset/Water Background color.png',
  tree1: 'Terrain/Resources/Wood/Trees/Tree1.png',
  tree2: 'Terrain/Resources/Wood/Trees/Tree2.png',
  gold: 'Terrain/Resources/Gold/Gold Stones/Gold Stone 3.png',
  stone: 'Terrain/Decorations/Rocks/Rock2.png',
  waterRock: 'Terrain/Decorations/Rocks in the Water/Water Rocks_01.png',
  bush: 'Terrain/Decorations/Bushes/Bushe1.png',
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

export function buildingKey(team: Team, kind: BuildingKind): string {
  return kind === 'barricade' ? 'tiny-stone' : `tiny-building-${team}-${kind}`;
}

export interface TinySwordsAsset {
  key: string;
  path: string;
  frameWidth?: number;
  frameHeight?: number;
  frames?: number;
}

/** The upload flow and normal boot use one source of truth for every texture. */
export function tinySwordsManifest(): TinySwordsAsset[] {
  const manifest: TinySwordsAsset[] = [];
  const loaded = new Set<string>();
  for (const [key, file] of Object.entries(staticAssets)) {
    const id = `tiny-${key}`;
    if (key === 'tree1' || key === 'tree2') manifest.push({ key: id, path: file, frameWidth: 192, frameHeight: 256 });
    else if (key === 'bush') manifest.push({ key: id, path: file, frameWidth: 128, frameHeight: 128 });
    else if (key === 'waterRock' || key === 'dust') manifest.push({ key: id, path: file, frameWidth: 64, frameHeight: 64 });
    else if (key === 'explosion') manifest.push({ key: id, path: file, frameWidth: 192, frameHeight: 192 });
    else manifest.push({ key: id, path: file });
  }
  for (const team of ['blue', 'red'] as const) {
    const color = teamColor[team];
    for (const [kind, definition] of Object.entries(UNIT_VISUALS) as [UnitKind, UnitVisualDefinition][]) {
      for (const [state, sheet] of Object.entries(definition.states) as [UnitVisualState, Sheet][]) {
        const key = unitSheetKey(team, kind, state);
        if (loaded.has(key)) continue;
        loaded.add(key);
        const size = sheet.frameSize ?? 192;
        manifest.push({
          key,
          path: `Units/${color} Units/${definition.family}/${sheet.file}.png`,
          frameWidth: size,
          frameHeight: size,
          frames: sheet.frames,
        });
      }
    }
    for (const [kind, file] of Object.entries(buildingFiles) as [BuildingKind, string][]) {
      if (file) manifest.push({ key: buildingKey(team, kind), path: `Buildings/${color} Buildings/${file}.png` });
    }
  }
  return manifest;
}

export function preloadTinySwords(scene: Phaser.Scene): void {
  for (const asset of tinySwordsManifest()) {
    if (scene.textures.exists(asset.key)) continue;
    const url = encodeURI(root + asset.path);
    if (asset.frameWidth && asset.frameHeight) {
      scene.load.spritesheet(asset.key, url, {
        frameWidth: asset.frameWidth, frameHeight: asset.frameHeight,
        ...(asset.frames ? { endFrame: asset.frames - 1 } : {}),
      });
    } else scene.load.image(asset.key, url);
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
    if (import.meta.env.DEV) console.warn(`Tiny Swords: missing ${requested}; using idle`);
    return fallback;
  }
  if (import.meta.env.DEV) console.warn(`Tiny Swords: missing ${requested} and idle`);
  return null;
}
