"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

function storage() {
  const values = {};
  return {
    values,
    async get(keys) {
      if (Array.isArray(keys)) return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]]));
      if (typeof keys === "string") return keys in values ? { [keys]: values[keys] } : {};
      return Object.fromEntries(Object.entries(keys).map(([k, defaultValue]) => [k, values[k] ?? defaultValue]));
    },
    async set(entries) { Object.assign(values, entries); },
    async remove(key) { delete values[key]; }
  };
}

async function runBackgroundTests() {
  const listeners = {};
  const local = storage();
  const session = storage();
  const notifications = [];
  const tabs = [
    { id: 5, windowId: 1, url: "https://chatgpt.com/c/AAA", title: "My analysis - ChatGPT", active: true },
    { id: 6, windowId: 1, url: "https://chatgpt.com/c/BBB", title: "My code - ChatGPT", active: false }
  ];
  const chrome = {
    storage: { local, session },
    tabs: {
      async query() { return tabs; },
      async get(id) { const tab = tabs.find((item) => item.id === id); if (!tab) throw Error("Missing tab"); return tab; },
      async sendMessage(id, message) { if (message.type === "GET_STATUS") return { key: `chat:${id === 5 ? "AAA" : "BBB"}`, enabled: true, phase: "running" }; return {}; },
      async update() {}
    },
    runtime: {
      getURL(relativePath) { return `chrome-extension://test/${relativePath}`; },
      async getContexts() { return [{ contextType: "OFFSCREEN_DOCUMENT" }]; },
      async sendMessage() { return { ok: true }; },
      onMessage: { addListener(handler) { listeners.message = handler; } }
    },
    notifications: {
      async create(id, payload) { notifications.push({ id, payload }); return id; },
      async getPermissionLevel() { return "granted"; },
      async getAll() { return Object.fromEntries(notifications.map((item) => [item.id, true])); },
      async clear() {},
      onClicked: { addListener(handler) { listeners.clicked = handler; } }
    },
    offscreen: { async createDocument() {} },
    windows: { async update() {} },
    tabsEvent: {},
  };
  chrome.tabs.onUpdated = { addListener(handler) { listeners.updated = handler; } };
  chrome.tabs.onRemoved = { addListener(handler) { listeners.removed = handler; } };
  const sandbox = { chrome, URL, Date, Set, Map, Number, console };
  vm.runInNewContext(fs.readFileSync(path.join(root, "background.js"), "utf8"), sandbox);
  function call(message, sender = {}) {
    return new Promise((resolve) => { listeners.message(message, sender, resolve); });
  }
  let overview = await call({ type: "GET_OVERVIEW" });
  assert.equal(overview.tabs.length, 2);
  assert.equal(overview.tabs[0].enabled, false);
  assert.equal((await call({ type: "SET_MONITOR", tabId: 5, enabled: true })).ok, true);
  assert.equal(local.values["watch:chat:AAA"], true);
  overview = await call({ type: "GET_OVERVIEW" });
  assert.equal(overview.tabs[0].enabled, true);
  assert.equal(overview.tabs[1].enabled, false);
  await call({ type: "COMPLETED" }, { tab: tabs[0], url: tabs[0].url });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].payload.title, "ChatGPT · Risposta pronta");
  await call({ type: "COMPLETED" }, { tab: tabs[1], url: tabs[1].url });
  assert.equal(notifications.length, 1);
  await call({ type: "SET_SHOW_TITLES", enabled: true });
  assert.equal(local.values.showTitles, true);
  await call({ type: "SET_MONITOR", tabId: 5, enabled: false });
  await call({ type: "COMPLETED" }, { tab: tabs[0], url: tabs[0].url });
  assert.equal(notifications.length, 1);
  assert.equal(local.values["watch:chat:AAA"], undefined);
  assert.equal((await call({ type: "SET_MONITOR", tabId: 9, enabled: true })).ok, false);
  let testResult = await call({ type: "TEST_NOTIFICATION" });
  assert.equal(testResult.ok, true);
  assert.equal(testResult.permission, "granted");
  assert.equal(testResult.registered, true);
  assert.equal(notifications.length, 2);
  assert.equal(notifications[1].payload.priority, 2);
  assert.equal(notifications[1].payload.iconUrl, "chrome-extension://test/icons/icon128.png");

  chrome.notifications.getPermissionLevel = async () => "denied";
  testResult = await call({ type: "TEST_NOTIFICATION" });
  assert.equal(testResult.ok, false);
  assert.equal(testResult.permission, "denied");
  assert.equal(notifications.length, 2);

  chrome.notifications.getPermissionLevel = async () => "granted";
  chrome.notifications.create = async () => { throw new Error("Notification blocked"); };
  testResult = await call({ type: "TEST_NOTIFICATION" });
  assert.equal(testResult.error, "Notification blocked");
  assert.equal(notifications.length, 2);
  console.log("Background: selected chat, successful/denied/failed notifications, privacy OK");
}

async function runContentTests() {
  const handlers = {};
  const messages = [];
  let stopVisible = false;
  let sendVisible = true;
  let observing = false;
  let observerInstance;
  const location = { href: "https://chatgpt.com/c/AAA", pathname: "/c/AAA" };

  class FakeElement {
    constructor(kind) { this.kind = kind; this.nodeType = 1; this.disabled = false; this.id = ""; }
    getClientRects() { return [1]; }
    matches(selector) { return this.kind === "stop" && selector.includes("stop-button"); }
    querySelector() { return null; }
    closest(selector) {
      if (this.kind === "assistant" && selector.includes('section[data-turn="assistant"]')) return this;
      if (this.kind === "editor" && selector.includes("#prompt-textarea")) return this;
      if (this.kind === "stop" && selector.includes("stop-button")) return this;
      if (this.kind === "send" && selector.includes("send-button")) return this;
      if (this.kind === "send" && selector.includes("form")) return this;
      return null;
    }
  }
  const stop = new FakeElement("stop");
  const send = new FakeElement("send");
  const editor = new FakeElement("editor");
  const assistant = new FakeElement("assistant");
  const document = {
    body: {},
    querySelectorAll(selector) {
      if (selector.includes("stop-button")) return stopVisible ? [stop] : [];
      if (selector.includes("send-button")) return sendVisible ? [send] : [];
      return [];
    },
    querySelector() { return null; },
    addEventListener(type, callback) { handlers[`document:${type}`] = callback; }
  };
  const window = { addEventListener(type, callback) { handlers[`window:${type}`] = callback; } };
  const chrome = {
    runtime: {
      onMessage: { addListener(callback) { handlers.message = callback; } },
      async sendMessage(message) {
        messages.push(message);
        if (message.type === "GET_CONFIG") return { enabled: true, key: "chat:AAA" };
        return { ok: true };
      }
    }
  };
  const context = {
    window, chrome, document, location, Element: FakeElement,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observerInstance = this; }
      observe() { observing = true; }
      disconnect() { observing = false; }
    },
    setTimeout, clearTimeout, setInterval, clearInterval, Date
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "content.js"), "utf8"), context);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(observing, true);
  function status() {
    let result;
    handlers.message({ type: "GET_STATUS" }, {}, (answer) => { result = answer; });
    return result;
  }
  assert.equal(status().phase, "idle");

  stopVisible = true;
  sendVisible = false;
  observerInstance.callback([{ target: editor }]);
  await new Promise((resolve) => setTimeout(resolve, 310));
  assert.equal(status().phase, "running");
  assert.equal(status().detector.stop, 1);
  stopVisible = false;
  sendVisible = true;
  observerInstance.callback([{ target: editor }]);
  await new Promise((resolve) => setTimeout(resolve, 2050));
  assert.equal(status().phase, "ready");
  assert.equal(messages.filter((message) => message.type === "COMPLETED").length, 1);

  handlers["document:keydown"]({ target: editor, key: "Enter", shiftKey: false, isComposing: false });
  assert.equal(status().phase, "running");
  assert.equal(status().detector.submissions, 1);
  observerInstance.callback([{ target: assistant }]);
  await new Promise((resolve) => setTimeout(resolve, 3300));
  assert.equal(status().phase, "ready");
  assert.equal(messages.filter((message) => message.type === "COMPLETED").length, 2);

  stopVisible = true;
  sendVisible = false;
  observerInstance.callback([{ target: editor }]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(status().phase, "running");
  handlers["document:click"]({ target: stop });
  stopVisible = false;
  sendVisible = true;
  observerInstance.callback([{ target: editor }]);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(status().phase, "idle");
  assert.equal(messages.filter((message) => message.type === "COMPLETED").length, 2);

  chrome.runtime.sendMessage = async (message) => message.type === "GET_CONFIG" ? { enabled: false, key: "chat:AAA" } : {};
  handlers.message({ type: "SYNC_CONFIG" }, {}, () => {});
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(observing, false);
  console.log("Content: stop detector, keyboard send fallback, completion, interruption, disabled observer OK");
}

(async () => {
  await runBackgroundTests();
  await runContentTests();
  console.log("All tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
