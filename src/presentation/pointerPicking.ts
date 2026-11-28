import type { GameEntity } from '../core/entities/EntityStore';
import { BUILDING_VISUALS, UNIT_VISUALS, WORLD_VISUAL_METRICS } from './VisualRegistry';

const CELL = WORLD_VISUAL_METRICS.cellSize;

/** Screen pixels a press may wander and still count as a click, per mouse button. */
export const CLICK_SLOP = { select: 8, pan: 12, barricade: 4 } as const;

/**
 * What the player is pointing at. Sprites rise well above the cell they stand on,
 * so after the exact cell the drawn body of a unit or building counts too.
 */
export function pickEntity(
  worldX: number,
  worldY: number,
  entities: readonly GameEntity[],
  positionOf: (entity: GameEntity) => { x: number; y: number } = (entity) => entity,
): GameEntity | undefined {
  const cellX = Math.floor(worldX / CELL);
  const cellY = Math.floor(worldY / CELL);
  const onCell = (entity: GameEntity) => (entity.category === 'unit'
    ? entity.x === cellX && entity.y === cellY
    : cellX >= entity.x && cellX < entity.x + entity.width && cellY >= entity.y && cellY < entity.y + entity.height);
  const exact = entities.find(onCell);
  if (exact) return exact;

  let best: GameEntity | undefined;
  let bestScore = Infinity;
  for (const entity of entities) {
    const { x, y } = positionOf(entity);
    const isUnit = entity.category === 'unit';
    const visual = isUnit ? UNIT_VISUALS[entity.kind] : BUILDING_VISUALS[entity.kind];
    const centerX = (x + (isUnit ? 0.5 : entity.width / 2)) * CELL;
    const bottom = (y + (isUnit ? 1 : entity.height)) * CELL;
    const halfWidth = Math.max(visual.visibleWidth, CELL) / 2;
    const top = bottom - Math.max(visual.visibleHeight, CELL);
    if (Math.abs(worldX - centerX) > halfWidth || worldY < top || worldY > bottom) continue;
    // Units are drawn small and move, so they win over a building behind them.
    const score = Math.hypot(worldX - centerX, worldY - (top + bottom) / 2) + (isUnit ? 0 : 1000);
    if (score < bestScore) {
      best = entity;
      bestScore = score;
    }
  }
  return best;
}
