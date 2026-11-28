import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/game/Simulation';
import { pickEntity } from './pointerPicking';

describe('pointer picking', () => {
  const simulation = new Simulation(1);
  const entities = simulation.entities.all();
  const worker = entities.find((entity) => entity.id === 'blue-worker-1')!;

  it('selects a unit from its cell or from the body drawn above it', () => {
    expect(pickEntity((worker.x + 0.5) * 12, (worker.y + 0.5) * 12, entities)?.id).toBe(worker.id);
    expect(pickEntity((worker.x + 0.5) * 12, worker.y * 12 - 3, entities)?.id).toBe(worker.id);
  });

  it('finds nothing on open ground', () => {
    expect(pickEntity((worker.x + 0.5) * 12, (worker.y - 4) * 12, entities)).toBeUndefined();
  });
});
