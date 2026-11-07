"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.version, "1.2.0");
assert(manifest.permissions.includes("offscreen"));

async function testBackgroundAudio() {
  let handler;
  let created = 0;
  let played = 0;
  let audioExists = false;
  const values = {};
  const tab = { id: 7, windowId: 1, url: "https://chatgpt.com/c/XYZ", title: "Example - ChatGPT" };
  const notifications = [];
  const chrome = {
    storage: {
      local: {
        async get(defaults) {
          if (typeof defaults === "string") return { [defaults]: values[defaults] };
          return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, values[key] ?? value]));
        },
        async set(items) { Object.assign(values, items); },
        async remove(key) { delete values[key]; }
      },
      session: { async get() { return {}; }, async set() {}, async remove() {} }
    },
    runtime: {
      getURL(file) { return `chrome-extension://example/${file}`; },
      async getContexts() { return audioExists ? [{ contextType: "OFFSCREEN_DOCUMENT" }] : []; },
      async sendMessage(message) {
        assert.equal(message.target, "offscreen");
        assert.equal(message.type, "PLAY_CHIME");
        played++;
        return { ok: true };
      },
      onMessage: { addListener(fn) { handler = fn; } }
    },
    offscreen: {
      async createDocument(opts) {
        assert.deepEqual(Array.from(opts.reasons), ["AUDIO_PLAYBACK"]);
        assert.equal(opts.url, "offscreen.html");
        created++;
        audioExists = true;
      }
    },
    notifications: {
      async create(id, payload) { notifications.push({ id, payload }); return id; },
      onClicked: { addListener() {} }
    },
    tabs: {
      async get(id) { assert.equal(id, tab.id); return tab; },
      async query() { return [tab]; },
      async sendMessage() { return { key: "chat:XYZ", phase: "ready" }; },
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} }
    },
    windows: { async update() {} }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "background.js"), "utf8"), { chrome, URL, Date, Set, Map, Number, console });
  const send = (message, sender = {}) => new Promise((resolve) => handler(message, sender, resolve));
  assert.equal(handler({ type: "PLAY_CHIME", target: "offscreen" }, {}, () => {}), false);
  await send({ type: "SET_MONITOR", tabId: tab.id, enabled: true });
  let result = await send({ type: "GET_OVERVIEW" });
  assert.equal(result.soundEnabled, true);
  await send({ type: "COMPLETED" }, { tab, url: tab.url });
  assert.equal(notifications.length, 1);
  assert.equal(created, 1);
  assert.equal(played, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(await send({ type: "TEST_SOUND" }))), { ok: true, skipped: false });
  assert.equal(created, 1);
  assert.equal(played, 2);
  assert.equal((await send({ type: "SET_SOUND_ENABLED", enabled: false })).ok, true);
  assert.equal(values.soundEnabled, false);
  result = await send({ type: "GET_OVERVIEW" });
  assert.equal(result.soundEnabled, false);
  await send({ type: "COMPLETED" }, { tab, url: tab.url });
  assert.equal(played, 2);
  assert.equal((await send({ type: "SET_SOUND_ENABLED", enabled: "yes" })).ok, false);
  assert.equal((await send({ type: "SET_SOUND_ENABLED", enabled: true }, { tab })).ok, false);
  await send({ type: "TEST_SOUND" });
  assert.equal(played, 3);

  chrome.runtime.sendMessage = async () => ({ ok: false, error: "Audio blocked" });
  const failure = await send({ type: "TEST_SOUND" });
  assert.equal(failure.ok, false);
  assert.match(failure.error, /Audio blocked/);
  console.log("Sound background: opt-in, default, offscreen reuse, sender checks and errors OK");
}

async function testOffscreenSynthesis() {
  let onMessage;
  let notes = 0;
  let closed = 0;
  const setValueAtTime = () => {};
  class FakeAudioContext {
    constructor() { this.state = "running"; this.currentTime = 10; this.destination = {}; }
    async resume() {}
    async close() { closed++; }
    createOscillator() {
      notes++;
      return { type: "", frequency: { setValueAtTime }, connect() {}, start() {}, stop() {} };
    }
    createGain() {
      return { gain: { setValueAtTime, exponentialRampToValueAtTime: setValueAtTime }, connect() {} };
    }
  }
  const chrome = { runtime: { onMessage: { addListener(handler) { onMessage = handler; } } } };
  const sandbox = { chrome, AudioContext: FakeAudioContext, setTimeout: (fn) => { fn(); } };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(root, "offscreen.js"), "utf8"), sandbox);
  assert.equal(onMessage({ target: "background", type: "PLAY_CHIME" }, {}, () => {}), false);
  const result = await new Promise((resolve) => {
    assert.equal(onMessage({ target: "offscreen", type: "PLAY_CHIME" }, {}, resolve), true);
  });
  assert.equal(result.ok, true);
  assert.equal(notes, 2);
  assert.equal(closed, 1);
  console.log("Offscreen sound: two-note chime, context cleanup and message routing OK");
}

(async () => {
  await testBackgroundAudio();
  await testOffscreenSynthesis();
  console.log("All sound tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
