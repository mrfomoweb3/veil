// Sound, made in the browser with WebAudio: no asset files, nothing to license, ~0 bytes.
// A low wind under the fog, and short cues for the moments that matter: sealing orders, a new
// turn, battles won and lost, a capital falling, the war ending, The Reveal verifying.
//
// Browsers only allow audio after a user gesture, so the context starts on the first click,
// key or pad press. Muting is remembered per browser.

type Cue = 'seal' | 'turn' | 'battle' | 'victory' | 'defeat' | 'fall' | 'end' | 'reveal' | 'join' | 'tick' | 'error';

const KEY = 'veil:muted';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let windGain: GainNode | null = null;
let noise: AudioBuffer | null = null;
let wantWind = false;
let muted = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();
const listeners = new Set<(m: boolean) => void>();

export const isMuted = () => muted;
export function onMute(f: (m: boolean) => void) { listeners.add(f); return () => { listeners.delete(f); }; }
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem(KEY, m ? '1' : '0'); } catch { /* storage blocked */ }
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05);
  listeners.forEach((f) => f(m));
}

function start() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return; }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.9;
  // A gentle limiter so stacked cues never clip.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  master.connect(comp).connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  // Brown noise: soft, windy, no hiss.
  const d = noise.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  if (wantWind) startWind();
}

/** Call once at boot: the audio context waits for the first gesture. */
export function initSound() {
  const go = () => start();
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, go, { capture: true, passive: true });
  window.addEventListener('gamepadconnected', go);
}

function startWind() {
  if (!ctx || !master || !noise || windGain) return;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  lp.Q.value = 0.7;
  // The wind breathes: a slow wobble on the filter and the level.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoAmt = ctx.createGain();
  lfoAmt.gain.value = 180;
  lfo.connect(lfoAmt).connect(lp.frequency);
  windGain = ctx.createGain();
  windGain.gain.value = 0;
  windGain.gain.setTargetAtTime(0.05, ctx.currentTime, 1.5);
  src.connect(lp).connect(windGain).connect(master);
  src.start();
  lfo.start();
}

/** The fog's wind, on the title screen and in matches. */
export function wind(on: boolean) {
  wantWind = on;
  if (!ctx) return;
  if (on) {
    if (!windGain) startWind();
    else windGain.gain.setTargetAtTime(0.05, ctx.currentTime, 1.2);
  } else if (windGain) {
    windGain.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
  }
}

function tone(freq: number, at: number, dur: number, opts: { type?: OscillatorType; gain?: number; glide?: number; attack?: number } = {}) {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(freq, at);
  if (opts.glide) o.frequency.exponentialRampToValueAtTime(opts.glide, at + dur);
  const peak = opts.gain ?? 0.2;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + (opts.attack ?? 0.008));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(master);
  o.start(at);
  o.stop(at + dur + 0.05);
}

function burst(at: number, dur: number, opts: { freq?: number; q?: number; gain?: number; type?: BiquadFilterType } = {}) {
  if (!ctx || !master || !noise) return;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = opts.type ?? 'bandpass';
  f.frequency.value = opts.freq ?? 900;
  f.Q.value = opts.q ?? 1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(opts.gain ?? 0.5, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(master);
  src.start(at, Math.random());
  src.stop(at + dur + 0.05);
}

export function play(cue: Cue) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + 0.01;
  switch (cue) {
    case 'seal': // wax press: a soft thud and a click
      tone(110, t, 0.22, { type: 'sine', gain: 0.35, glide: 55 });
      burst(t, 0.05, { freq: 2400, q: 3, gain: 0.25 });
      tone(880, t + 0.06, 0.12, { type: 'triangle', gain: 0.05 });
      break;
    case 'turn': // the clouds settle: two bell tones
      tone(523.25, t, 0.9, { type: 'sine', gain: 0.12 });
      tone(784, t + 0.12, 1.1, { type: 'sine', gain: 0.09 });
      tone(1568, t + 0.12, 0.5, { type: 'sine', gain: 0.02 });
      break;
    case 'battle': // distant clash: noise hit over a low boom
      tone(70, t, 0.6, { type: 'sine', gain: 0.4, glide: 40 });
      burst(t, 0.35, { freq: 1200, q: 0.8, gain: 0.45 });
      burst(t + 0.09, 0.2, { freq: 3000, q: 4, gain: 0.15 });
      break;
    case 'victory':
      [392, 523.25, 659.25].forEach((f, k) => tone(f, t + k * 0.09, 0.7, { type: 'triangle', gain: 0.1 }));
      break;
    case 'defeat':
      [392, 349.23, 293.66].forEach((f, k) => tone(f, t + k * 0.13, 0.8, { type: 'triangle', gain: 0.09 }));
      break;
    case 'fall': // a capital falls: a deep gong
      tone(65.4, t, 2.8, { type: 'sine', gain: 0.45, attack: 0.004 });
      tone(98.3, t, 2.2, { type: 'sine', gain: 0.18 });
      tone(185.2, t, 1.4, { type: 'sine', gain: 0.07 });
      burst(t, 0.12, { freq: 400, q: 0.5, gain: 0.3, type: 'lowpass' });
      break;
    case 'end': // the war is over: a slow horn
      tone(146.83, t, 1.8, { type: 'sawtooth', gain: 0.05, attack: 0.25 });
      tone(220, t + 0.5, 1.8, { type: 'sawtooth', gain: 0.04, attack: 0.25 });
      tone(293.66, t + 1.0, 2.2, { type: 'sine', gain: 0.1, attack: 0.3 });
      break;
    case 'reveal': // the fog lifts: a rising shimmer
      [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach((f, k) => tone(f, t + k * 0.07, 1.2, { type: 'sine', gain: 0.06 }));
      burst(t, 1.4, { freq: 6000, q: 0.4, gain: 0.05, type: 'highpass' });
      break;
    case 'join':
      tone(659.25, t, 0.3, { type: 'triangle', gain: 0.08 });
      tone(987.77, t + 0.08, 0.4, { type: 'triangle', gain: 0.07 });
      break;
    case 'tick':
      tone(1400, t, 0.04, { type: 'square', gain: 0.015 });
      break;
    case 'error':
      tone(196, t, 0.18, { type: 'square', gain: 0.04 });
      tone(185, t + 0.1, 0.2, { type: 'square', gain: 0.04 });
      break;
  }
}
