export type SoundEffect =
  | 'click'
  | 'order'
  | 'meleeAttack'
  | 'rangedAttack'
  | 'unitDeath'
  | 'buildingComplete'
  | 'unitProduced'
  | 'resourceDeposited'
  | 'buildingAttack'
  | 'baseUnderAttack'
  | 'enemySpotted'
  | 'victory'
  | 'defeat';

const SOUND_COOLDOWNS_MS: Record<SoundEffect, number> = {
  click: 40,
  order: 80,
  meleeAttack: 75,
  rangedAttack: 75,
  unitDeath: 100,
  buildingComplete: 200,
  unitProduced: 150,
  resourceDeposited: 120,
  buildingAttack: 100,
  baseUnderAttack: 3500,
  enemySpotted: 3000,
  victory: 2000,
  defeat: 2000,
};

const MAX_CONCURRENT_VOICES = 4;

/**
 * Procedural Web Audio sound system for RTS V1.1.
 * Synthesizes retro RTS sound effects with zero external assets,
 * featuring per-sound cooldowns, voice limits, volume and mute controls.
 */
export class SoundSystem {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled = true;
  private volume = 0.5;
  private activeVoices = 0;
  private readonly lastPlayed = new Map<SoundEffect, number>();

  constructor() {
    this.loadSettings();
  }

  private loadSettings(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const savedEnabled = window.localStorage.getItem('rts_sound_enabled');
        if (savedEnabled !== null) {
          this.enabled = savedEnabled === 'true';
        }
        const savedVolume = window.localStorage.getItem('rts_sound_volume');
        if (savedVolume !== null) {
          const parsed = parseFloat(savedVolume);
          if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
            this.volume = parsed;
          }
        }
      }
    } catch {
      // LocalStorage access may fail in restricted test contexts
    }
  }

  private saveSettings(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('rts_sound_enabled', String(this.enabled));
        window.localStorage.setItem('rts_sound_volume', String(this.volume));
      }
    } catch {
      // Ignore
    }
  }

  private getAudioContext(): AudioContext | null {
    const AudioCtx = (typeof window !== 'undefined'
      ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext);
    if (!AudioCtx) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Initializes or unlocks the AudioContext on user interaction.
   */
  unlock(): void {
    const ctx = this.getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.saveSettings();
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime);
    }
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  getVolume(): number {
    return this.volume;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.saveSettings();
    if (this.masterGain && this.ctx && this.enabled) {
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  /**
   * Plays a synthesized procedural sound effect, respecting cooldowns and voice limits.
   */
  play(effect: SoundEffect): boolean {
    if (!this.enabled || this.volume <= 0) return false;

    const now = Date.now();
    const last = this.lastPlayed.get(effect) ?? 0;
    const cooldown = SOUND_COOLDOWNS_MS[effect] ?? 50;
    if (now - last < cooldown) {
      return false; // Throttled to prevent audio spam
    }

    if (this.activeVoices >= MAX_CONCURRENT_VOICES) {
      return false; // Limit concurrent voices
    }

    const ctx = this.getAudioContext();
    if (!ctx || !this.masterGain) return false;

    this.lastPlayed.set(effect, now);
    this.activeVoices += 1;

    try {
      const duration = this.synthesize(ctx, this.masterGain, effect);
      setTimeout(() => {
        this.activeVoices = Math.max(0, this.activeVoices - 1);
      }, Math.max(50, Math.round(duration * 1000)));
      return true;
    } catch {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
      return false;
    }
  }

  private synthesize(ctx: AudioContext, destination: GainNode, effect: SoundEffect): number {
    const now = ctx.currentTime;

    switch (effect) {
      case 'click': {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(350, now + 0.03);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
        osc.connect(gain);
        gain.connect(destination);
        osc.start(now);
        osc.stop(now + 0.03);
        return 0.03;
      }

      case 'order': {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(660, now + 0.04);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.connect(gain);
        gain.connect(destination);
        osc.start(now);
        osc.stop(now + 0.08);
        return 0.08;
      }

      case 'meleeAttack': {
        // Noise burst punch + tone
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.08);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.connect(gain);
        gain.connect(destination);
        osc.start(now);
        osc.stop(now + 0.08);
        return 0.08;
      }

      case 'rangedAttack': {
        // High twang whoosh
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 0.09);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        osc.connect(gain);
        gain.connect(destination);
        osc.start(now);
        osc.stop(now + 0.09);
        return 0.09;
      }

      case 'unitDeath': {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(240, now);
        osc.frequency.exponentialRampToValueAtTime(45, now + 0.22);
        gain.gain.setValueAtTime(0.28, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.connect(gain);
        gain.connect(destination);
        osc.start(now);
        osc.stop(now + 0.22);
        return 0.22;
      }

      case 'buildingComplete': {
        // Triumphant two-tone chime (C5 -> E5 -> G5)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.08);
        osc.frequency.setValueAtTime(783.99, now + 0.16);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
        osc.connect(gain);
        gain.connect(destination);
        osc.start(now);
        osc.stop(now + 0.26);
        return 0.26;
      }

      case 'unitProduced': {
        // Quick brass / chime flourish (D5 -> A5)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.setValueAtTime(880, now + 0.07);
        gain.gain.setValueAtTime(0.28, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(gain);
        gain.connect(destination);
        osc.start(now);
        osc.stop(now + 0.18);
        return 0.18;
      }

      case 'resourceDeposited': {
        // Crisp coin / wood ping
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1174.66, now); // D6
        osc.frequency.setValueAtTime(1567.98, now + 0.03); // G6
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.connect(gain);
        gain.connect(destination);
        osc.start(now);
        osc.stop(now + 0.08);
        return 0.08;
      }

      case 'buildingAttack': {
        // Deep stone/wood crunch thud
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(130, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.14);
        gain.gain.setValueAtTime(0.32, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.connect(gain);
        gain.connect(destination);
        osc.start(now);
        osc.stop(now + 0.14);
        return 0.14;
      }

      case 'baseUnderAttack': {
        // Klaxon alert (high-low alternating pulse)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(330, now + 0.1);
        osc.frequency.setValueAtTime(440, now + 0.2);
        osc.frequency.setValueAtTime(330, now + 0.3);
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc.connect(gain);
        gain.connect(destination);
        osc.start(now);
        osc.stop(now + 0.4);
        return 0.4;
      }

      case 'enemySpotted': {
        // Radar ping
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(987.77, now); // B5
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.connect(gain);
        gain.connect(destination);
        osc.start(now);
        osc.stop(now + 0.16);
        return 0.16;
      }

      case 'victory': {
        // Victorious ascending fanfare (C5 -> E5 -> G5 -> C6)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.14);
        osc.frequency.setValueAtTime(783.99, now + 0.28);
        osc.frequency.setValueAtTime(1046.50, now + 0.42);
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
        osc.connect(gain);
        gain.connect(destination);
        osc.start(now);
        osc.stop(now + 0.65);
        return 0.65;
      }

      case 'defeat': {
        // Melancholic descending cadence (G4 -> Eb4 -> C4)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(392.00, now);
        osc.frequency.setValueAtTime(311.13, now + 0.2);
        osc.frequency.setValueAtTime(261.63, now + 0.42);
        gain.gain.setValueAtTime(0.32, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
        osc.connect(gain);
        gain.connect(destination);
        osc.start(now);
        osc.stop(now + 0.7);
        return 0.7;
      }
    }
  }
}
