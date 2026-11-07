/**
 * Broadcast audio. Everything is synthesized with Web Audio so the repo
 * ships no media assets and nothing is sampled from a real broadcast.
 *
 * Two voices:
 *  - ambience(): a low pad + filtered noise bed (the "cable box hum")
 *  - cues: short stepped-tone chimes on screen changes, like a
 *          WeatherStar local update
 */

let ctx = null;
let master = null;
let ambienceNodes = null;
let enabled = false;

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  return ctx;
}

/** Start (or resume) the ambience. Must be called from a user gesture. */
export async function startAudio() {
  const c = ensureContext();
  if (!c) return false;
  if (c.state === "suspended") await c.resume();
  if (!ambienceNodes) ambienceNodes = buildAmbience(c);
  enabled = true;
  master.gain.cancelScheduledValues(c.currentTime);
  master.gain.setTargetAtTime(0.16, c.currentTime, 0.6);
  return true;
}

export function stopAudio() {
  const c = ctx;
  if (!c) return;
  enabled = false;
  master.gain.cancelScheduledValues(c.currentTime);
  master.gain.setTargetAtTime(0, c.currentTime, 0.25);
}

export function isAudioOn() {
  return enabled;
}

function buildAmbience(c) {
  const gain = c.createGain();
  gain.gain.value = 0.5;
  gain.connect(master);

  // Pad: two detuned triangles a fifth apart, slowly breathed.
  const pad = c.createGain();
  pad.gain.value = 0.22;
  pad.connect(gain);
  [55, 82.5, 110].forEach((freq, i) => {
    const osc = c.createOscillator();
    osc.type = i === 2 ? "sine" : "triangle";
    osc.frequency.value = freq;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.05 + i * 0.017;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 0.35 + i * 0.12;
    lfo.connect(lfoGain).connect(osc.detune);
    osc.connect(pad);
    osc.start();
    lfo.start();
  });

  // Noise bed: band-limited pink-ish hiss, the cable-box floor.
  const seconds = 2;
  const buffer = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = 0.97 * last + 0.03 * white;
    data[i] = last * 3.2;
  }
  const noise = c.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1400;
  const noiseGain = c.createGain();
  noiseGain.gain.value = 0.055;
  noise.connect(lp).connect(noiseGain).connect(gain);
  noise.start();

  return { gain, noise, pad };
}

/**
 * Broadcast cue: three descending square beeps, WeatherStar style.
 * Silent no-op when audio is off or unavailable.
 */
export function cue(kind = "change") {
  if (!enabled || !ctx) return;
  const c = ctx;
  const notes =
    kind === "start" ? [523.25, 659.25, 783.99] :
    kind === "alert" ? [392, 329.63, 261.63] :
    [659.25, 523.25, 392];
  notes.forEach((freq, i) => {
    const t = c.currentTime + i * 0.085;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.20, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.09);
  });
}
