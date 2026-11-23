(function (global) {
  'use strict';

  class RetroAudio {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.engineOsc = null;
      this.engineGain = null;
    }

    ensureContext() {
      if (this.muted) return null;
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    }

    setMuted(flag) {
      this.muted = Boolean(flag);
      if (this.muted) this.stopEngine();
    }

    playStart() {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(660, now + 0.08);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.23);
    }

    playCheckpoint() {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(880, now + 0.06);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.19);
    }

    playCrash() {
      this.stopEngine();
      const ctx = this.ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Retro white noise burst + low thud
      const bufferSize = Math.floor(ctx.sampleRate * 0.35);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.28));
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(900, now);
      filter.frequency.exponentialRampToValueAtTime(140, now + 0.32);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(now);
    }

    playFinish() {
      this.stopEngine();
      const ctx = this.ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        const t = now + idx * 0.085;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.065, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + (idx === notes.length - 1 ? 0.36 : 0.11));
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.38);
      });
    }

    updateEngine(speed, accelMag) {
      if (this.muted) {
        this.stopEngine();
        return;
      }
      const ctx = this.ensureContext();
      if (!ctx) return;
      if (!this.engineOsc) {
        this.engineOsc = ctx.createOscillator();
        this.engineGain = ctx.createGain();
        this.engineOsc.type = 'sawtooth';
        this.engineGain.gain.value = 0.0;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 340;
        this.engineOsc.connect(filter);
        filter.connect(this.engineGain);
        this.engineGain.connect(ctx.destination);
        this.engineOsc.start();
      }

      const now = ctx.currentTime;
      const targetFreq = 65 + Math.min(260, speed * 5.2 + accelMag * 2.5);
      const targetGain = accelMag > 0.1 ? 0.032 : speed > 0.5 ? 0.014 : 0.004;
      this.engineOsc.frequency.setTargetAtTime(targetFreq, now, 0.04);
      this.engineGain.gain.setTargetAtTime(targetGain, now, 0.04);
    }

    stopEngine() {
      if (this.engineOsc) {
        try {
          this.engineOsc.stop();
          this.engineOsc.disconnect();
        } catch (_) {}
        this.engineOsc = null;
      }
      if (this.engineGain) {
        try {
          this.engineGain.disconnect();
        } catch (_) {}
        this.engineGain = null;
      }
    }
  }

  global.VectorRacer = global.VectorRacer || {};
  global.VectorRacer.RetroAudio = RetroAudio;
})(typeof window !== 'undefined' ? window : globalThis);
