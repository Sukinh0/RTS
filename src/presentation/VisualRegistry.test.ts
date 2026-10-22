import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UnitKind } from '../core/entities/EntityStore';
import { FX_LIMITS, FX_VISUALS, UNIT_VISUALS, type UnitVisualState } from './VisualRegistry';

const teamAssetFolders = { blue: 'Yellow Units', red: 'Red Units' } as const;
const assetRoot = resolve(process.cwd(), 'public/assets');

describe('Tiny Swords unit visual readability', () => {
  it('keeps gameplay feedback brief and bounded under load', () => {
    expect(FX_VISUALS.hitDurationMs).toBeLessThanOrEqual(100);
    expect(FX_LIMITS.activeWorldEffects).toBeLessThanOrEqual(100);
    expect(FX_LIMITS.activeProjectiles).toBeLessThanOrEqual(40);
    expect(FX_LIMITS.activeAttackTrails).toBeGreaterThanOrEqual(FX_LIMITS.activeProjectiles);
    expect(FX_LIMITS.ambientEffectsPerSecond).toBeLessThanOrEqual(10);
  });

  it.each(Object.entries(teamAssetFolders))('has real %s-team sheets for all six class profiles', (team, folder) => {
    const kinds: UnitKind[] = ['worker', 'builder', 'soldier', 'archer', 'shieldbearer', 'scout'];
    for (const kind of kinds) {
      const definition = UNIT_VISUALS[kind];
      for (const sheet of Object.values(definition.states)) {
        const root = kind === 'builder'
          ? resolve(assetRoot, 'generated/builder', folder, 'Pawn')
          : resolve(assetRoot, 'tiny-swords/Units', folder, definition.family);
        expect(existsSync(resolve(root, `${sheet.file}.png`)), `${team}/${kind}/${sheet.file}`).toBe(true);
      }
    }
  });

  it('keeps the worker gather, carry, mine and construction animations mapped to pack sheets', () => {
    const workerStates: UnitVisualState[] = [
      'idle', 'move', 'gatherWood', 'gatherStone', 'mine', 'carryWood', 'carryStone', 'build',
    ];
    for (const state of workerStates) expect(UNIT_VISUALS.worker.states[state]).toBeDefined();
  });

  it('uses the raised shield pose and shield-forward attack for the shieldbearer', () => {
    expect(UNIT_VISUALS.shieldbearer.family).toBe('Warrior');
    expect(UNIT_VISUALS.shieldbearer.states.guard?.file).toBe('Warrior_Guard');
    expect(UNIT_VISUALS.shieldbearer.states.attack?.file).toBe('Warrior_Attack2');
    expect(UNIT_VISUALS.shieldbearer.frameDisplaySize).toBeGreaterThan(UNIT_VISUALS.soldier.frameDisplaySize);
  });

  it('uses the foot Lancer scout profile with no monk healing or mounted sheets', () => {
    expect(UNIT_VISUALS.scout.family).toBe('Lancer');
    expect(UNIT_VISUALS.scout.states.idle?.file).toBe('Lancer_Idle');
    expect(UNIT_VISUALS.scout.states.move?.file).toBe('Lancer_Run');
    expect(Object.values(UNIT_VISUALS.scout.states).some((sheet) => sheet.file.startsWith('Heal'))).toBe(false);
  });
});
