interface Samples {
  values: Float64Array;
  count: number;
  totalMs: number;
  maxMs: number;
}

/** Opt-in, bounded diagnostics. No timers, console output, or per-frame DOM updates. */
export class PerformanceMonitor {
  enabled = false;
  private started = 0;
  private readonly metrics = new Map<string, Samples>();
  private readonly undo: Array<() => void> = [];

  enable(): void { this.enabled = true; this.reset(); }
  reset(): void { this.metrics.clear(); this.started = performance.now(); }
  onDisable(cleanup: () => void): void { this.undo.push(cleanup); }
  disable(): void {
    for (const restore of this.undo.splice(0).reverse()) restore();
    this.enabled = false;
  }
  record(name: string, ms: number): void {
    if (!this.enabled) return;
    let metric = this.metrics.get(name);
    if (!metric) this.metrics.set(name, metric = { values: new Float64Array(600), count: 0, totalMs: 0, maxMs: 0 });
    metric.values[metric.count % metric.values.length] = ms;
    metric.count++;
    metric.totalMs += ms;
    metric.maxMs = Math.max(metric.maxMs, ms);
  }
  /** Instance hooks are removed on disable; normal operation uses original methods. */
  watch<T extends object>(target: T, key: keyof T, name: string, countOnly = false): void {
    const original = target[key];
    if (typeof original !== 'function') throw new Error(`Not a method: ${String(key)}`);
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    const record = this.record.bind(this);
    Object.defineProperty(target, key, { configurable: true, writable: true, value: function (this: T, ...args: unknown[]) {
      const start = countOnly ? 0 : performance.now();
      try { return Reflect.apply(original, this, args); }
      finally { record(name, countOnly ? 0 : performance.now() - start); }
    } });
    this.undo.push(() => {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else Reflect.deleteProperty(target, key);
    });
  }
  snapshot() {
    const seconds = Math.max(.001, (performance.now() - this.started) / 1000);
    const metrics = Object.fromEntries([...this.metrics].map(([name, m]) => {
      const recent = Array.from(m.values.subarray(0, Math.min(m.count, m.values.length))).sort((a,b) => a-b);
      return [name, { calls: m.count, callsPerSecond: m.count / seconds, meanMs: m.totalMs / m.count,
        p95Ms: recent[Math.ceil(recent.length * .95) - 1] ?? 0, maxMs: m.maxMs, totalMs: m.totalMs }];
    }));
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
    return { enabled: this.enabled, seconds, fps: metrics.frameInterval ? 1000 / metrics.frameInterval.meanMs : null,
      metrics, heapUsedBytes: memory?.usedJSHeapSize ?? null, heapTotalBytes: memory?.totalJSHeapSize ?? null };
  }
}
