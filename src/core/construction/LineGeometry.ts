import type { Point } from '../../map/MapGrid';

export interface GridBounds {
  width: number;
  height: number;
}

/**
 * Computes a contiguous, grid-aligned horizontal or vertical line of cells.
 *
 * Rules:
 * - If |dx| >= |dy|, generates a horizontal line along y = start[1].
 * - Otherwise, generates a vertical line along x = start[0].
 * - Supports dragging in positive and negative directions.
 * - Always includes start and end cells without gaps.
 * - If bounds are provided, cells are strictly clamped to [0, width - 1] and [0, height - 1].
 */
export function computeLineCells(
  start: Point,
  end: Point,
  bounds?: GridBounds,
): Point[] {
  let sX = Math.round(start[0]);
  let sY = Math.round(start[1]);
  let eX = Math.round(end[0]);
  let eY = Math.round(end[1]);

  if (bounds) {
    sX = Math.max(0, Math.min(bounds.width - 1, sX));
    sY = Math.max(0, Math.min(bounds.height - 1, sY));
    eX = Math.max(0, Math.min(bounds.width - 1, eX));
    eY = Math.max(0, Math.min(bounds.height - 1, eY));
  }

  const dx = eX - sX;
  const dy = eY - sY;
  const cells: Point[] = [];

  if (Math.abs(dx) >= Math.abs(dy)) {
    // Horizontal line
    const step = dx >= 0 ? 1 : -1;
    for (let x = sX; x !== eX + step; x += step) {
      cells.push([x, sY]);
    }
  } else {
    // Vertical line
    const step = dy >= 0 ? 1 : -1;
    for (let y = sY; y !== eY + step; y += step) {
      cells.push([sX, y]);
    }
  }

  return cells;
}
