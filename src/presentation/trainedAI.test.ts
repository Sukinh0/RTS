import { describe, expect, it } from 'vitest';
import { readChampion, wantsTrainedAI } from './trainedAI';

describe('trained AI option', () => {
  it('is only used when asked for', () => {
    expect(wantsTrainedAI('?ia=treinada')).toBe(true);
    expect(wantsTrainedAI('?ia=treinada&noai')).toBe(false);
    expect(wantsTrainedAI('')).toBe(false);
  });

  it('rejects a missing or broken champion file and sanitizes a loaded one', () => {
    expect(readChampion(undefined)).toBeNull();
    expect(readChampion('<!doctype html>')).toBeNull();
    expect(readChampion('{"version":1}')).toBeNull();
    expect(readChampion(JSON.stringify({ version: 2, generation: 9, strategy: { waveSize: 6, maxTowers: 50 } })))
      .toMatchObject({ version: 2, generation: 9, strategy: { waveSize: 6, maxTowers: 2 } });
  });
});
