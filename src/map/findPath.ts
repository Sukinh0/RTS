import { MapGrid, type Point } from './MapGrid';

interface Node {
  index: number;
  g: number;
  f: number;
  order: number;
}

class MinHeap {
  private readonly items: Node[] = [];

  get size(): number { return this.items.length; }

  push(node: Node): void {
    this.items.push(node);
    let child = this.items.length - 1;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (!this.less(this.items[child], this.items[parent])) break;
      [this.items[child], this.items[parent]] = [this.items[parent], this.items[child]];
      child = parent;
    }
  }

  pop(): Node | undefined {
    const first = this.items[0];
    const last = this.items.pop();
    if (!first || !last || this.items.length === 0) return first;
    this.items[0] = last;
    let parent = 0;
    while (true) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let smallest = parent;
      if (left < this.items.length && this.less(this.items[left], this.items[smallest])) smallest = left;
      if (right < this.items.length && this.less(this.items[right], this.items[smallest])) smallest = right;
      if (smallest === parent) break;
      [this.items[parent], this.items[smallest]] = [this.items[smallest], this.items[parent]];
      parent = smallest;
    }
    return first;
  }

  private less(a: Node, b: Node): boolean {
    return a.f < b.f || (a.f === b.f && (a.g > b.g || (a.g === b.g && a.order < b.order)));
  }
}

const DIRECTIONS: readonly Point[] = [
  [0, -1], [1, 0], [0, 1], [-1, 0],
  [1, -1], [1, 1], [-1, 1], [-1, -1],
];

function heuristic(x: number, y: number, goalX: number, goalY: number): number {
  const dx = Math.abs(goalX - x);
  const dy = Math.abs(goalY - y);
  return 14 * Math.min(dx, dy) + 10 * (Math.max(dx, dy) - Math.min(dx, dy));
}

/** Deterministic A* with eight directions and no crossing blocked corners. */
export function findPath(
  map: MapGrid,
  start: Point,
  goal: Point,
  canEnter: (x: number, y: number) => boolean = (x, y) => map.isPassable(x, y),
): Point[] | null {
  const [startX, startY] = start;
  const [goalX, goalY] = goal;
  if (!map.contains(startX, startY) || !map.contains(goalX, goalY) || !canEnter(goalX, goalY)) return null;
  const width = map.width;
  const startIndex = startY * width + startX;
  const goalIndex = goalY * width + goalX;
  if (startIndex === goalIndex) return [start];

  const scores = new Float64Array(width * map.height).fill(Infinity);
  const previous = new Int32Array(width * map.height).fill(-1);
  const closed = new Uint8Array(width * map.height);
  const heap = new MinHeap();
  scores[startIndex] = 0;
  let order = 0;
  heap.push({ index: startIndex, g: 0, f: heuristic(startX, startY, goalX, goalY), order: order++ });

  while (heap.size > 0) {
    const node = heap.pop()!;
    if (closed[node.index] || node.g !== scores[node.index]) continue;
    if (node.index === goalIndex) {
      const path: Point[] = [];
      for (let index = goalIndex; index !== -1; index = previous[index]) {
        path.push([index % width, Math.floor(index / width)]);
      }
      return path.reverse();
    }
    closed[node.index] = 1;
    const x = node.index % width;
    const y = Math.floor(node.index / width);
    for (const [dx, dy] of DIRECTIONS) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (!map.contains(nextX, nextY) || !canEnter(nextX, nextY)) continue;
      if (dx !== 0 && dy !== 0 && (!canEnter(x + dx, y) || !canEnter(x, y + dy))) continue;
      const nextIndex = nextY * width + nextX;
      if (closed[nextIndex]) continue;
      const g = node.g + (dx !== 0 && dy !== 0 ? 14 : 10);
      if (g >= scores[nextIndex]) continue;
      scores[nextIndex] = g;
      previous[nextIndex] = node.index;
      heap.push({ index: nextIndex, g, f: g + heuristic(nextX, nextY, goalX, goalY), order: order++ });
    }
  }
  return null;
}
