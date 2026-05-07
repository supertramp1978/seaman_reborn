import { getAudioContext } from './tts.js';

class SeManager {
  #buffers  = new Map(); // name → AudioBuffer
  #ambients = new Map(); // name → { src, gain, volume }

  async loadBuffer(name, url) {
    try {
      const ctx = getAudioContext();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ab  = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(ab);
      this.#buffers.set(name, buf);
    } catch (e) {
      console.warn(`[se] loadBuffer(${name}) failed:`, e.message);
    }
  }

  playOneShot(name, { volume = 1.0 } = {}) {
    const ctx = getAudioContext();
    const buf = this.#buffers.get(name);
    if (!ctx || !buf) return;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(ctx.destination);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    src.start();
  }

  startAmbient(name, { volume = 0.25, fadeInMs = 1000 } = {}) {
    if (this.#ambients.has(name)) return;
    const ctx = getAudioContext();
    const buf = this.#buffers.get(name);
    if (!ctx || !buf) return;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + fadeInMs / 1000);
    gain.connect(ctx.destination);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain);
    src.start();
    this.#ambients.set(name, { src, gain, volume });
  }

  stopAmbient(name, { fadeOutMs = 1000 } = {}) {
    const entry = this.#ambients.get(name);
    if (!entry) return;
    const ctx = getAudioContext();
    const { src, gain } = entry;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + fadeOutMs / 1000);
    this.#ambients.delete(name);
    setTimeout(() => { try { src.stop(); } catch {} }, fadeOutMs + 50);
  }
}

export const se = new SeManager();
