import { barricadeNeighborMask } from './VisualRegistry';

export interface BarricadeNode { id: string; x: number; y: number; team: string }

/** Cached visual-only adjacency; callers invalidate only for membership, completion or visibility changes. */
export class BarricadeTopology {
  private revision = -1;
  private invalidated = true;
  private readonly cells = new Map<string, BarricadeNode>();
  private readonly masks = new Map<string, number>();

  invalidate(): void { this.invalidated = true; }

  sync(revision: number, nodes: readonly BarricadeNode[]): void {
    if (!this.invalidated && this.revision === revision) return;
    const next = new Map<string, BarricadeNode>();
    for (const node of nodes) next.set(this.cellKey(node.x, node.y), node);
    const changedCells = new Set<string>();
    for (const [key, old] of this.cells) {
      const current = next.get(key);
      if (!current || current.id !== old.id || current.team !== old.team) changedCells.add(key);
    }
    for (const [key, current] of next) {
      const old = this.cells.get(key);
      if (!old || old.id !== current.id || old.team !== current.team) changedCells.add(key);
    }
    if (this.invalidated && changedCells.size === 0) {
      for (const key of next.keys()) changedCells.add(key);
    }
    const affected = new Set<string>();
    for (const key of changedCells) {
      const [x, y] = key.split(',').map(Number);
      for (const [dx, dy] of [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]]) affected.add(this.cellKey(x + dx, y + dy));
    }
    for (const key of changedCells) {
      const old = this.cells.get(key);
      if (old) this.masks.delete(old.id);
    }
    for (const key of affected) {
      const node = next.get(key);
      if (!node) continue;
      const has = (dx: number, dy: number): boolean => {
        const neighbor = next.get(this.cellKey(node.x + dx, node.y + dy));
        return !!neighbor && neighbor.team === node.team;
      };
      this.masks.set(node.id, barricadeNeighborMask(has(0, -1), has(1, 0), has(0, 1), has(-1, 0)));
    }
    this.cells.clear();
    for (const [key, node] of next) this.cells.set(key, node);
    this.revision = revision;
    this.invalidated = false;
  }

  maskFor(id: string): number { return this.masks.get(id) ?? 0; }

  private cellKey(x: number, y: number): string { return `${x},${y}`; }
}
