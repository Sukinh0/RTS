import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundSystem } from './SoundSystem';

describe('SoundSystem', () => {
  let sound: SoundSystem;
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    });
    sound = new SoundSystem();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initializes with sound enabled and default volume', () => {
    expect(sound.isEnabled()).toBe(true);
    expect(sound.getVolume()).toBe(0.5);
  });

  it('toggles sound on and off', () => {
    expect(sound.toggle()).toBe(false);
    expect(sound.isEnabled()).toBe(false);
    expect(sound.toggle()).toBe(true);
    expect(sound.isEnabled()).toBe(true);
  });

  it('clamps volume to [0, 1] range', () => {
    sound.setVolume(1.5);
    expect(sound.getVolume()).toBe(1.0);
    sound.setVolume(-0.5);
    expect(sound.getVolume()).toBe(0.0);
    sound.setVolume(0.75);
    expect(sound.getVolume()).toBe(0.75);
  });

  it('rejects playing sounds when disabled or volume is 0', () => {
    sound.setEnabled(false);
    expect(sound.play('click')).toBe(false);

    sound.setEnabled(true);
    sound.setVolume(0);
    expect(sound.play('click')).toBe(false);
  });

  it('throttles rapid duplicate sound requests to prevent spam', () => {
    // Mock AudioContext in node test environment
    const mockAudioContext = vi.fn().mockImplementation(() => ({
      state: 'running',
      currentTime: 0,
      resume: vi.fn().mockResolvedValue(undefined),
      createGain: vi.fn().mockReturnValue({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      }),
      createOscillator: vi.fn().mockReturnValue({
        type: 'sine',
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      }),
      destination: {},
    }));
    vi.stubGlobal('AudioContext', mockAudioContext);

    const activeSound = new SoundSystem();
    // First play succeeds
    const first = activeSound.play('meleeAttack');
    expect(first).toBe(true);

    // Immediate second play within 75ms cooldown is throttled
    const second = activeSound.play('meleeAttack');
    expect(second).toBe(false);
  });

  it('supports all required sound effect types', () => {
    const effects = [
      'click', 'order', 'meleeAttack', 'rangedAttack', 'unitDeath',
      'buildingComplete', 'unitProduced', 'resourceDeposited',
      'buildingAttack', 'baseUnderAttack', 'enemySpotted', 'victory', 'defeat',
    ] as const;

    const mockAudioContext = vi.fn().mockImplementation(() => ({
      state: 'running',
      currentTime: 0,
      resume: vi.fn().mockResolvedValue(undefined),
      createGain: vi.fn().mockReturnValue({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      }),
      createOscillator: vi.fn().mockReturnValue({
        type: 'sine',
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      }),
      destination: {},
    }));
    vi.stubGlobal('AudioContext', mockAudioContext);

    const activeSound = new SoundSystem();
    for (const effect of effects) {
      expect(() => activeSound.play(effect)).not.toThrow();
    }
  });
});
