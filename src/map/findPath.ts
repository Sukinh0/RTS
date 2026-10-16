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
  clear(): void { this.items.length = 0; }

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

class SearchWorkspace {
  readonly scores: Float64Array;
  readonly previous: Int32Array;
  readonly seen: Uint32Array;
  readonly closed: Uint32Array;
  readonly heap = new MinHeap();
  generation = 0;
  busy = false;
  constructor(size: number) {
    this.scores = new Float64Array(size);
    this.previous = new Int32Array(size);
    this.seen = new Uint32Array(size);
    this.closed = new Uint32Array(size);
  }
  reset(): void {
    this.heap.clear();
    if (++this.generation === 0xffffffff) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.generation = 1;
    }
  }
}
// Scratch memory, not a route cache: every search still reads current obstacles.
const workspaces = new WeakMap<MapGrid, SearchWorkspace>();

const terrainGuides = new WeakMap<MapGrid, { revision: number; fields: Map<number, Float64Array> }>();

/** Shared static distance landmarks for nearby destinations. This only strengthens
 * the admissible heuristic of the same A*; unit collisions remain in canEnter.
 * Up to eight fields per map, invalidated by every navigation change.
 */
export function terrainHeuristic(map: MapGrid, goal: Point): (x: number, y: number) => number {
  let cache = terrainGuides.get(map);
  if (!cache || cache.revision !== map.navigationRevision) {
    cache = { revision: map.navigationRevision, fields: new Map() };
    terrainGuides.set(map, cache);
  }
  const key = Math.floor(goal[1] / 32) * Math.ceil(map.width / 32) + Math.floor(goal[0] / 32);
  let distances = cache.fields.get(key);
  if (!distances) {
    const started = map.diagnostics?.enabled ? performance.now() : 0;
    distances = new Float64Array(map.width * map.height).fill(Infinity);
    const heap = new MinHeap();
    const root = goal[1] * map.width + goal[0];
    distances[root] = 0;
    let order = 0;
    heap.push({ index: root, g: 0, f: 0, order: order++ });
    while (heap.size) {
      const node = heap.pop()!;
      if (node.g !== distances[node.index]) continue;
      const x = node.index % map.width, y = Math.floor(node.index / map.width);
      for (const [dx, dy] of DIRECTIONS) {
        const nx = x + dx, ny = y + dy;
        if (!map.isPassable(nx, ny)) continue;
        if (dx && dy && (!map.isPassable(x + dx, y) || !map.isPassable(x, y + dy))) continue;
        const index = ny * map.width + nx;
        const cost = node.g + (dx && dy ? 14 : 10);
        if (cost >= distances[index]) continue;
        distances[index] = cost;
        heap.push({ index, g: cost, f: cost, order: order++ });
      }
    }
    if (cache.fields.size === 8) cache.fields.delete(cache.fields.keys().next().value!);
    cache.fields.set(key, distances);
    if (map.diagnostics?.enabled) map.diagnostics.record('terrainGuides', performance.now() - started);
  } else {
    cache.fields.delete(key);
    cache.fields.set(key, distances);
  }
  const goalDistance = distances[goal[1] * map.width + goal[0]];
  return (x, y) => {
    const distance = distances[y * map.width + x];
    const basic = heuristic(x, y, goal[0], goal[1]);
    return Number.isFinite(distance) && Number.isFinite(goalDistance) ? Math.max(basic, Math.abs(distance - goalDistance)) : basic;
  };
}

/** Deterministic A* with eight directions and no crossing blocked corners. */
export function findPath(
  map: MapGrid,
  start: Point,
  goal: Point,
  canEnter: (x: number, y: number) => boolean = (x, y) => map.isPassable(x, y),
  estimate?: (x: number, y: number) => number,
): Point[] | null {
  const monitor = map.diagnostics?.enabled ? map.diagnostics : undefined;
  const started = monitor ? performance.now() : 0;
  let workspace = workspaces.get(map);
  if (!workspace) {
    workspace = new SearchWorkspace(map.width * map.height);
    workspaces.set(map, workspace);
  }
  // A caller-supplied canEnter callback may perform a nested search.
  if (workspace.busy) workspace = new SearchWorkspace(map.width * map.height);
  workspace.busy = true;
  workspace.reset();
  try {
    return search(map, start, goal, canEnter, workspace, estimate);
  } finally {
    monitor?.record('pathfinding', performance.now() - started);
    workspace.heap.clear();
    workspace.busy = false;
  }
}

function search(map: MapGrid, start: Point, goal: Point, canEnter: (x: number, y: number) => boolean, workspace: SearchWorkspace, estimate?: (x: number, y: number) => number): Point[] | null {
  const [startX, startY] = start;
  const [goalX, goalY] = goal;
  if (!map.contains(startX, startY) || !map.contains(goalX, goalY) || !canEnter(goalX, goalY)) return null;
  const width = map.width;
  const startIndex = startY * width + startX;
  const goalIndex = goalY * width + goalX;
  if (startIndex === goalIndex) return [start];
  const horizontal = goalX < startX ? -1 : 1;

  const { scores, previous, closed, seen, heap, generation } = workspace;
  scores[startIndex] = 0;
  previous[startIndex] = -1;
  seen[startIndex] = generation;
  let order = 0;
  heap.push({ index: startIndex, g: 0, f: heuristic(startX, startY, goalX, goalY), order: order++ });

  const maxExpansions = 25000;
  let expansions = 0;

  while (heap.size > 0) {
    if (++expansions > maxExpansions) break;
    const node = heap.pop()!;
    if (closed[node.index] === generation || node.g !== scores[node.index]) continue;
    if (node.index === goalIndex) {
      const path: Point[] = [];
      for (let index = goalIndex; index !== -1; index = previous[index]) {
        path.push([index % width, Math.floor(index / width)]);
      }
      return path.reverse();
    }
    closed[node.index] = generation;
    const x = node.index % width;
    const y = Math.floor(node.index / width);
    for (const [forwardX, dy] of DIRECTIONS) {
      const dx = forwardX * horizontal;
      const nextX = x + dx;
      const nextY = y + dy;
      if (!map.contains(nextX, nextY) || !canEnter(nextX, nextY)) continue;
      if (dx !== 0 && dy !== 0 && (!canEnter(x + dx, y) || !canEnter(x, y + dy))) continue;
      const nextIndex = nextY * width + nextX;
      if (closed[nextIndex] === generation) continue;
      const g = node.g + (dx !== 0 && dy !== 0 ? 14 : 10);
      if (seen[nextIndex] === generation && g >= scores[nextIndex]) continue;
      seen[nextIndex] = generation;
      scores[nextIndex] = g;
      previous[nextIndex] = node.index;
      heap.push({ index: nextIndex, g, f: g + (estimate ? estimate(nextX, nextY) : heuristic(nextX, nextY, goalX, goalY)), order: order++ });
    }
  }
  return null;
}
