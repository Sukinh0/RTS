import type { AIStrategy } from '../core/ai/AIStrategy';
import { sanitizeStrategy } from '../training/genome';

/** Cache key and file name (in public/) of the champion written by `npm run train`. */
export const TRAINED_AI_KEY = 'ia-treinada';

export const wantsTrainedAI = (search: string): boolean => {
  const params = new URLSearchParams(search);
  return params.get('ia') === 'treinada' && !params.has('noai');
};

export interface Champion { version: number; generation: number; strategy: AIStrategy }

/** A missing file may come back as the page's own HTML, so anything unreadable means "no champion". */
export function readChampion(text: unknown): Champion | null {
  let data: unknown;
  try {
    data = JSON.parse(String(text));
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const { version, generation, strategy } = data as Record<string, unknown>;
  if (typeof strategy !== 'object' || strategy === null) return null;
  return { version: Number(version) || 0, generation: Number(generation) || 0, strategy: sanitizeStrategy(strategy) };
}
