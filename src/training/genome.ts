import { DEFAULT_STRATEGY, type AIStrategy } from '../core/ai/AIStrategy';

type Gene =
  | { key: keyof AIStrategy; kind: 'int'; min: number; max: number; step?: number }
  | { key: keyof AIStrategy; kind: 'ratio'; min: number; max: number }
  | { key: keyof AIStrategy; kind: 'bool' }
  | { key: keyof AIStrategy; kind: 'choice'; options: readonly string[] };

/** Everything the training is allowed to change, with its legal range. */
export const GENES: readonly Gene[] = [
  { key: 'openingArmy', kind: 'int', min: 0, max: 8 },
  { key: 'route', kind: 'choice', options: ['seed', 'direct', 'flank'] },
  { key: 'waveSize', kind: 'int', min: 1, max: 8 },
  { key: 'reinforcementSize', kind: 'int', min: 1, max: 6 },
  { key: 'minerTarget', kind: 'int', min: 1, max: 4 },
  { key: 'workersEarly', kind: 'int', min: 2, max: 8 },
  { key: 'workersMid', kind: 'int', min: 2, max: 10 },
  { key: 'workersLate', kind: 'int', min: 2, max: 12 },
  { key: 'stoneSurplus', kind: 'int', min: 0, max: 400, step: 25 },
  { key: 'woodSurplus', kind: 'int', min: 0, max: 500, step: 25 },
  { key: 'archerShare', kind: 'ratio', min: 0, max: 2 },
  { key: 'shieldShare', kind: 'ratio', min: 0, max: 1 },
  { key: 'trainScout', kind: 'bool' },
  { key: 'smartDefense', kind: 'bool' },
  { key: 'recallMargin', kind: 'int', min: 0, max: 5 },
  { key: 'earlyWarningDistance', kind: 'int', min: 0, max: 90, step: 5 },
  { key: 'homeBarricades', kind: 'int', min: 0, max: 6 },
  { key: 'maxTowers', kind: 'int', min: 0, max: 3 },
  { key: 'forwardTowerDistance', kind: 'int', min: 0, max: 65, step: 5 },
  { key: 'forwardBarricades', kind: 'int', min: 0, max: 8 },
  { key: 'forwardPostAfterTroops', kind: 'int', min: 0, max: 8 },
];

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** Maps a strategy to a vector in [0, 1], one value per gene. */
export function encode(strategy: Readonly<AIStrategy>): number[] {
  return GENES.map((gene) => {
    const value = strategy[gene.key];
    if (gene.kind === 'bool') return value ? 0.75 : 0.25;
    if (gene.kind === 'choice') return (gene.options.indexOf(value as string) + 0.5) / gene.options.length;
    return clamp(((value as number) - gene.min) / (gene.max - gene.min));
  });
}

export function decode(vector: readonly number[]): AIStrategy {
  const strategy: Record<string, unknown> = { ...DEFAULT_STRATEGY };
  GENES.forEach((gene, index) => {
    const x = clamp(vector[index]);
    if (gene.kind === 'bool') strategy[gene.key] = x >= 0.5;
    else if (gene.kind === 'choice') {
      strategy[gene.key] = gene.options[Math.min(gene.options.length - 1, Math.floor(x * gene.options.length))];
    } else {
      const raw = gene.min + x * (gene.max - gene.min);
      if (gene.kind === 'ratio') strategy[gene.key] = Math.round(raw * 100) / 100;
      else strategy[gene.key] = Math.round(raw / (gene.step ?? 1)) * (gene.step ?? 1);
    }
  });
  return strategy as unknown as AIStrategy;
}

/** Accepts only known genes in legal ranges; anything else falls back to the default value. */
export function sanitizeStrategy(input: unknown): AIStrategy {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const strategy: Record<string, unknown> = { ...DEFAULT_STRATEGY };
  for (const gene of GENES) {
    const value = source[gene.key];
    if (gene.kind === 'bool') {
      if (typeof value === 'boolean') strategy[gene.key] = value;
    } else if (gene.kind === 'choice') {
      if (typeof value === 'string' && gene.options.includes(value)) strategy[gene.key] = value;
    } else if (typeof value === 'number' && value >= gene.min && value <= gene.max
      && (gene.kind === 'ratio' || Number.isInteger(value))) {
      strategy[gene.key] = value;
    }
  }
  return strategy as unknown as AIStrategy;
}
