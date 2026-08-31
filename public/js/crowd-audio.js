/**
 * Procedural tennis stadium crowd + SFX via Web Audio API.
 */
export class CrowdAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambienceGain = null;
    this.sfxGain = null;
    this.running = false;
    this.muted = false;
    this._ambienceNodes = [];
    this._ambienceTimers = [];
    this._cheerUntil = 0;
    this._baseAmbienceLevel = 0.2;
  }

  _ensure() {
    if (this.ctx) return true;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.88;
      this.master.connect(this.ctx.destination);
      this.ambienceGain = this.ctx.createGain();
      this.ambienceGain.gain.value = 0;
      this.ambienceGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 1;
      this.sfxGain.connect(this.master);
      return true;
    } catch (_) {
      return false;
    }
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (!this.master || !this.ctx) return;
    const target = this.muted ? 0 : 0.88;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.06);
  }

  toggleMuted() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  isMuted() {
    return this.muted;
  }

  async unlock() {
    if (!this._ensure()) return;
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (_) {
        /* ignore */
      }
    }
  }

  _makeNoiseBuffer(seconds = 2) {
    const sampleRate = this.ctx.sampleRate;
    const bufferSize = Math.floor(sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);
    let prev = 0;
    for (let i = 0; i < bufferSize; i += 1) {
      const white = Math.random() * 2 - 1;
      prev = prev * 0.96 + white * 0.04;
      data[i] = prev * 1.8;
    }
    return buffer;
  }

  _connectLoop(source, filterChain, gain = this.ambienceGain) {
    let node = source;
    for (const filter of filterChain) {
      node.connect(filter);
      node = filter;
    }
    node.connect(gain);
    source.start();
    this._ambienceNodes.push(source);
  }

  /** Layered stadium bed — low rumble + mid crowd wash. */
  _startStadiumBed() {
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._makeNoiseBuffer(3);
    noise.loop = true;

    const low = this.ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 280;
    low.Q.value = 0.6;

    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.13;
    lfoGain.gain.value = 60;
    lfo.connect(lfoGain);
    lfoGain.connect(low.frequency);
    lfo.start();

    const bedGain = this.ctx.createGain();
    bedGain.gain.value = 0.14;
    this._connectLoop(noise, [low, bedGain]);
    this._ambienceNodes.push(lfo);

    const mid = this.ctx.createBufferSource();
    mid.buffer = this._makeNoiseBuffer(2.5);
    mid.loop = true;
    const midFilter = this.ctx.createBiquadFilter();
    midFilter.type = 'bandpass';
    midFilter.frequency.value = 620;
    midFilter.Q.value = 0.55;
    const midGain = this.ctx.createGain();
    midGain.gain.value = 0.055;
    this._connectLoop(mid, [midFilter, midGain]);
  }

  /** Short vowel-like burst — simulates individual spectators. */
  _voiceBurst(kind = 'murmur', volume = 0.028) {
    if (!this._ensure() || this.muted) return;
    const t0 = this.ctx.currentTime;
    const pitch = 95 + Math.random() * 55;
    const formants =
      kind === 'oh'
        ? [480, 900]
        : kind === 'cheer'
          ? [700, 1450]
          : kind === 'gasp'
            ? [520, 1100]
            : [620, 1280];

    for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i += 1) {
      const delay = i * (0.018 + Math.random() * 0.03);
      const osc = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const mix = this.ctx.createGain();
      const f1 = this.ctx.createBiquadFilter();
      const f2 = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();

      osc.type = 'triangle';
      osc2.type = 'sine';
      osc.frequency.value = pitch * (0.92 + Math.random() * 0.16);
      osc2.frequency.value = pitch * 2.01;
      f1.type = 'bandpass';
      f1.frequency.value = formants[0] + (Math.random() - 0.5) * 80;
      f1.Q.value = 4.5;
      f2.type = 'bandpass';
      f2.frequency.value = formants[1] + (Math.random() - 0.5) * 120;
      f2.Q.value = 6;

      const dur = 0.12 + Math.random() * 0.22;
      const peak = volume * (0.7 + Math.random() * 0.5);
      g.gain.setValueAtTime(0.0001, t0 + delay);
      g.gain.linearRampToValueAtTime(peak, t0 + delay + 0.04);
      g.gain.linearRampToValueAtTime(peak * 0.55, t0 + delay + dur * 0.55);
      g.gain.linearRampToValueAtTime(0.0001, t0 + delay + dur);

      osc.connect(mix);
      osc2.connect(mix);
      mix.connect(f1);
      f1.connect(f2);
      f2.connect(g);
      g.connect(this.ambienceGain);
      osc.start(t0 + delay);
      osc2.start(t0 + delay);
      osc.stop(t0 + delay + dur + 0.05);
      osc2.stop(t0 + delay + dur + 0.05);
    }
  }

  /** Rhythmic tennis applause — short clap bursts. */
  _applause(intensity = 0.5, duration = 1.1) {
    if (!this._ensure() || this.muted) return;
    const claps = Math.floor(8 + intensity * 22);
    for (let i = 0; i < claps; i += 1) {
      const delay = (i / claps) * duration * (0.85 + Math.random() * 0.2);
      setTimeout(() => {
        if (!this.running && intensity < 0.3) return;
        const t0 = this.ctx.currentTime;
        const bufferSize = Math.floor(this.ctx.sampleRate * 0.035);
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const ch = buffer.getChannelData(0);
        for (let s = 0; s < bufferSize; s += 1) {
          ch[s] = (Math.random() * 2 - 1) * (1 - s / bufferSize);
        }
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 900 + Math.random() * 700;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1800 + Math.random() * 1200;
        bp.Q.value = 0.8;
        const g = this.ctx.createGain();
        const vol = (0.012 + intensity * 0.028) * (0.6 + Math.random() * 0.8);
        g.gain.setValueAtTime(vol, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
        src.connect(hp);
        hp.connect(bp);
        bp.connect(g);
        g.connect(intensity > 0.35 ? this.sfxGain : this.ambienceGain);
        src.start(t0);
      }, delay * 1000);
    }
  }

  _scheduleAmbienceLife() {
    const scheduleMurmur = () => {
      if (!this.running) return;
      this._voiceBurst('murmur', 0.018 + Math.random() * 0.014);
      const id = setTimeout(scheduleMurmur, 700 + Math.random() * 1800);
      this._ambienceTimers.push(id);
    };
    scheduleMurmur();

    const scheduleRipple = () => {
      if (!this.running) return;
      if (Math.random() < 0.45) this._applause(0.08 + Math.random() * 0.12, 0.35);
      const id = setTimeout(scheduleRipple, 2500 + Math.random() * 4500);
      this._ambienceTimers.push(id);
    };
    scheduleRipple();
  }

  startAmbience() {
    if (!this._ensure() || this.running) return;
    this.running = true;
    this.unlock();
    this._startStadiumBed();
    this.ambienceGain.gain.setTargetAtTime(this._baseAmbienceLevel, this.ctx.currentTime, 1.2);
    this._scheduleAmbienceLife();
  }

  stopAmbience() {
    this.running = false;
    for (const id of this._ambienceTimers) clearTimeout(id);
    this._ambienceTimers = [];
    for (const node of this._ambienceNodes) {
      try {
        node.stop();
      } catch (_) {
        /* ignore */
      }
    }
    this._ambienceNodes = [];
    if (this.ambienceGain && this.ctx) {
      this.ambienceGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    }
  }

  _tone(freq, dur, type = 'sine', vol = 0.08, ramp = 0.02, dest = this.sfxGain) {
    if (!this._ensure() || this.muted) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + ramp);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  _noiseBurst(dur, vol = 0.06, freq = 800) {
    if (!this._ensure() || this.muted) return;
    const t0 = this.ctx.currentTime;
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
      ch[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxGain);
    src.start(t0);
  }

  playHit(powerLevel = 3) {
    this.unlock();
    const lvl = Math.max(1, Math.min(5, powerLevel));
    const thud = 110 + lvl * 16;
    this._tone(thud, 0.045 + lvl * 0.006, 'triangle', 0.06 + lvl * 0.01, 0.005);
    this._noiseBurst(0.035 + lvl * 0.005, 0.028 + lvl * 0.007, 850 + lvl * 70);
    if (lvl >= 3 && Math.random() < 0.25) {
      this._voiceBurst('murmur', 0.012 + lvl * 0.003);
    }
  }

  playBounce() {
    this._tone(85 + Math.random() * 25, 0.035, 'sine', 0.018, 0.003);
  }

  playFault() {
    this.unlock();
    this._voiceBurst('oh', 0.035);
    this._applause(0.12, 0.45);
    this._tone(180, 0.14, 'sine', 0.022, 0.012);
  }

  playDeuce() {
    this.unlock();
    this._voiceBurst('gasp', 0.02);
    this._applause(0.22, 0.7);
  }

  playPoint(winner, kind = 'point') {
    this.unlock();
    const intensity =
      kind === 'match' ? 1 : kind === 'set' ? 0.88 : kind === 'game' ? 0.7 : 0.48;
    this.cheer(intensity, kind);
  }

  cheer(intensity = 0.5) {
    if (!this._ensure() || this.muted) return;
    this._cheerUntil = performance.now() + 800 + intensity * 1400;
    const t0 = this.ctx.currentTime;

    this._applause(intensity, 0.7 + intensity * 1.4);
    const voiceCount = Math.floor(2 + intensity * 5);
    for (let i = 0; i < voiceCount; i += 1) {
      setTimeout(() => {
        this._voiceBurst(intensity > 0.55 ? 'cheer' : 'murmur', 0.02 + intensity * 0.035);
      }, i * (60 + Math.random() * 90));
    }

    if (this.ambienceGain) {
      const boost = this._baseAmbienceLevel + intensity * 0.16;
      this.ambienceGain.gain.setTargetAtTime(boost, t0, 0.04);
      this.ambienceGain.gain.setTargetAtTime(this._baseAmbienceLevel, t0 + 1.4 + intensity * 0.8, 0.7);
    }
  }

  isCheering() {
    return performance.now() < this._cheerUntil;
  }
}
