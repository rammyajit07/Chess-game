let audioCtx = null;

function ctx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function tone({ freq = 440, dur = 0.06, type = "sine", gain = 0.08, glideTo = null }) {
  const ac = ctx();
  const t0 = ac.currentTime;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ac.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.01);
}

function click({ gain = 0.08, dur = 0.05, freq = 900 }) {
  tone({ freq, dur, type: "triangle", gain, glideTo: 260 });
}

export const Sfx = {
  resume() {
    const ac = ctx();
    if (ac.state !== "running") ac.resume();
  },
  move() {
    click({ gain: 0.07, freq: 820 });
  },
  capture() {
    tone({ freq: 220, dur: 0.09, type: "sawtooth", gain: 0.06, glideTo: 120 });
    setTimeout(() => click({ gain: 0.05, freq: 640 }), 25);
  },
  clockTap() {
    click({ gain: 0.06, freq: 1020 });
  },
  emote() {
    tone({ freq: 660, dur: 0.06, type: "square", gain: 0.03, glideTo: 880 });
  },
  error() {
    tone({ freq: 180, dur: 0.11, type: "sine", gain: 0.05, glideTo: 90 });
  }
};

