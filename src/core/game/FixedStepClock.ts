import { FIXED_STEP_MS } from '../../config/runtime';

/** Converts variable frame durations into deterministic simulation ticks. */
export class FixedStepClock {
  private accumulatorMs = 0;
  private tickCount = 0;

  get ticks(): number {
    return this.tickCount;
  }

  get elapsedMs(): number {
    return this.tickCount * FIXED_STEP_MS;
  }

  advance(deltaMs: number, tick: () => void | boolean): number {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      throw new RangeError('deltaMs must be a finite, nonnegative number');
    }

    this.accumulatorMs += deltaMs;
    let executed = 0;
    while (this.accumulatorMs >= FIXED_STEP_MS - 1e-9) {
      this.accumulatorMs = Math.max(0, this.accumulatorMs - FIXED_STEP_MS);
      this.tickCount += 1;
      executed += 1;
      if (tick() === false) {
        this.accumulatorMs = 0;
        break;
      }
    }
    return executed;
  }
}
