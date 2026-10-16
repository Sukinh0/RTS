import { FIXED_STEP_MS } from '../../config/runtime';

/** Converts variable frame durations into deterministic simulation ticks. */
export class FixedStepClock {
  private accumulatorMs = 0;
  private tickCount = 0;
  droppedMs = 0;

  get ticks(): number {
    return this.tickCount;
  }

  get elapsedMs(): number {
    return this.tickCount * FIXED_STEP_MS;
  }

  advance(deltaMs: number, tick: () => void | boolean, maxSteps = Infinity): number {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      throw new RangeError('deltaMs must be a finite, nonnegative number');
    }

    if (!(maxSteps > 0) || (Number.isFinite(maxSteps) && !Number.isInteger(maxSteps))) throw new RangeError('maxSteps must be a positive integer or Infinity');
    this.accumulatorMs += deltaMs;
    let executed = 0;
    while (this.accumulatorMs >= FIXED_STEP_MS - 1e-9 && executed < maxSteps) {
      this.accumulatorMs = Math.max(0, this.accumulatorMs - FIXED_STEP_MS);
      this.tickCount += 1;
      executed += 1;
      if (tick() === false) {
        this.accumulatorMs = 0;
        break;
      }
    }
    if (this.accumulatorMs >= FIXED_STEP_MS - 1e-9) {
      const dropped = Math.floor((this.accumulatorMs + 1e-9) / FIXED_STEP_MS) * FIXED_STEP_MS;
      this.accumulatorMs = Math.max(0, this.accumulatorMs - dropped);
      this.droppedMs += dropped;
    }
    return executed;
  }
}
