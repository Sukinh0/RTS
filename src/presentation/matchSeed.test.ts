import { describe, expect, it } from 'vitest';
import { resolveMatchSeed } from './matchSeed';
import { applyUiArtVariables } from './uiArt';

describe('resolveMatchSeed', () => {
  it('usa a seed informada na URL', () => {
    expect(resolveMatchSeed('?seed=123')).toBe(123);
    expect(resolveMatchSeed('?seed=0')).toBe(0);
  });

  it('sorteia quando a seed falta ou é inválida', () => {
    for (const search of ['', '?seed=', '?seed=abc', '?seed=1.5']) {
      expect(resolveMatchSeed(search, () => 0.5)).toBe(500_000);
    }
  });
});

describe('applyUiArtVariables', () => {
  it('prefixa o subcaminho da publicação', () => {
    const values = new Map<string, string>();
    applyUiArtVariables({ setProperty: (name: string, value: string | null) => { values.set(name, value ?? ''); } }, '/RTS/');
    expect(values.size).toBe(4);
    expect(values.get('--ui-ribbon')).toBe('url("/RTS/assets/tiny-swords/UI%20Elements/UI%20Elements/Ribbons/BigRibbons.png")');
  });
});
