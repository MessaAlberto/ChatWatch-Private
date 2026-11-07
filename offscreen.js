"use strict";

let activePlayback = Promise.resolve();

async function playChime() {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) throw new Error("Web Audio is unavailable");

  const context = new AudioContextClass();
  try {
    await context.resume();
    if (context.state !== "running") throw new Error("Audio output is suspended");

    const start = context.currentTime + 0.025;
    const notes = [
      { frequency: 659.25, delay: 0, duration: 0.19, volume: 0.075 },
      { frequency: 880, delay: 0.14, duration: 0.28, volume: 0.065 }
    ];

    for (const note of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const from = start + note.delay;
      const end = from + note.duration;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(note.frequency, from);
      gain.gain.setValueAtTime(0.0001, from);
      gain.gain.exponentialRampToValueAtTime(note.volume, from + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(from);
      oscillator.stop(end + 0.01);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { ok: true };
  } finally {
    await context.close();
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen" || message.type !== "PLAY_CHIME") return false;
  activePlayback = activePlayback.catch(() => {}).then(playChime);
  activePlayback.then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error?.message || "Audio playback failed" });
  });
  return true;
});
