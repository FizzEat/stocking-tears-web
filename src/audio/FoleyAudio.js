/**
 * Procedural Web Audio API Foley Engine (zero external audio files needed):
 *  - Crisp nylon tear/snap sound when stocking fibers rip
 *  - Soft fabric rustle / slide noise while rolling socks/stockings or pulling ribbon
 *  - Gentle crystalline chime on stage clear & victory chord on all-clear
 */
export class FoleyAudio {
  constructor() {
    this.ctx = null;
    this.noiseBuffer = null;
    this.muted = false;
    this.voiceEnabled = true;
    this.lastTearTime = 0;
    this.lastSlideTime = 0;
    this.lastVoiceTime = 0;
    this.voiceIndex = 0;
    this.voiceLines = ['哥哥轻点', '哎呀，哥哥轻点啦', '轻一点，要勾丝啦'];
  }

  _ensureContext() {
    if (this.muted) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this._createNoiseBuffer();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  _createNoiseBuffer() {
    const sr = this.ctx.sampleRate;
    const len = sr * 1.0;
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buf;
  }

  setMuted(m) {
    this.muted = m;
    if (m && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  /**
   * Plays a cute anime-style Chinese voice reaction via Web Speech API (zero audio files needed).
   */
  playVoiceReaction() {
    if (this.muted || !this.voiceEnabled) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const now = performance.now();
    if (now - this.lastVoiceTime < 2200) return; // avoid overlapping spam
    this.lastVoiceTime = now;

    try {
      const synth = window.speechSynthesis;
      synth.cancel();

      const text = this.voiceLines[this.voiceIndex % this.voiceLines.length];
      this.voiceIndex++;

      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'zh-CN';
      utter.pitch = 1.32; // soft higher anime-like tone
      utter.rate = 1.06;
      utter.volume = 0.88;

      const voices = synth.getVoices();
      const zhFemale =
        voices.find((v) => /zh/i.test(v.lang) && /tingting|xiaoxiao|meijia|sinji|female|女/i.test(v.name)) ||
        voices.find((v) => /zh[-_]CN/i.test(v.lang)) ||
        voices.find((v) => /zh/i.test(v.lang));
      if (zhFemale) utter.voice = zhFemale;

      synth.speak(utter);
    } catch {
      // Ignore speech synthesis errors on restricted browsers
    }
  }

  /**
   * Short crisp nylon rip / elastic snap when a stocking spring tears.
   */
  playTearSnap(intensity = 1.0) {
    const ctx = this._ensureContext();
    if (!ctx || !this.noiseBuffer) return;

    const now = ctx.currentTime;
    if (now - this.lastTearTime < 0.045) return; // throttle rapid bursts
    this.lastTearTime = now;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2600 + Math.random() * 1400, now);
    bp.frequency.exponentialRampToValueAtTime(1100, now + 0.065);
    bp.Q.value = 2.4;

    const gain = ctx.createGain();
    const vol = Math.min(0.22, 0.11 * intensity);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.075);

    src.connect(bp);
    bp.connect(gain);
    gain.connect(ctx.destination);

    src.start(now, Math.random() * 0.5, 0.09);
  }

  /**
   * Soft cloth-sliding / silk rustle while dragging socks, stockings, or ribbon.
   */
  playFabricSlide(speed = 0.5) {
    const ctx = this._ensureContext();
    if (!ctx || !this.noiseBuffer) return;

    const now = ctx.currentTime;
    if (now - this.lastSlideTime < 0.08) return;
    this.lastSlideTime = now;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1200 + Math.min(1800, speed * 900), now);
    bp.Q.value = 1.6;

    const gain = ctx.createGain();
    const vol = Math.min(0.065, 0.018 + speed * 0.03);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.11);

    src.connect(bp);
    bp.connect(gain);
    gain.connect(ctx.destination);

    src.start(now, Math.random() * 0.6, 0.12);
  }

  /**
   * Soft pop when a sock slips off or the ribbon knot comes loose.
   */
  playPop() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.09);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.11, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.14);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  /**
   * Pleasant crystalline chime when clearing a stage (isFinal = true for full victory arpeggio).
   */
  playStageClear(isFinal = false) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const notes = isFinal ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const t = now + i * 0.085;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.09, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + (isFinal ? 0.55 : 0.36));

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  }
}
