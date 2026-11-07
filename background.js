"use strict";

const CHAT_PATTERNS = ["https://chatgpt.com/*", "https://chat.openai.com/*"];
const CHAT_ORIGINS = new Set(["https://chatgpt.com", "https://chat.openai.com"]);
const notificationCooldown = new Map();
const AUDIO_DOCUMENT = "offscreen.html";
let creatingAudioDocument = null;

async function ensureAudioDocument() {
  const url = chrome.runtime.getURL(AUDIO_DOCUMENT);
  if (creatingAudioDocument) return creatingAudioDocument;
  creatingAudioDocument = (async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [url]
    });
    if (contexts.length) return;
    await chrome.offscreen.createDocument({
      url: AUDIO_DOCUMENT,
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play a brief local chime when a monitored ChatGPT response finishes."
    });
  })();
  try {
    await creatingAudioDocument;
  } finally {
    creatingAudioDocument = null;
  }
}

async function playSound(force = false) {
  const { soundEnabled } = await chrome.storage.local.get({ soundEnabled: true });
  if (!force && soundEnabled !== true) return { ok: true, skipped: true };
  try {
    await ensureAudioDocument();
    const response = await chrome.runtime.sendMessage({ target: "offscreen", type: "PLAY_CHIME" });
    if (!response?.ok) throw new Error(response?.error || "Audio playback unavailable");
    return { ok: true, skipped: false };
  } catch (error) {
    console.warn("ChatWatch sound unavailable:", error);
    return { ok: false, error: error?.message || "Audio playback unavailable" };
  }
}

function chatKey(url, tabId) {
  try {
    const parsed = new URL(url);
    if (!CHAT_ORIGINS.has(parsed.origin)) return null;
    if (/^\/(share|auth|backend-api|settings)(\/|$)/.test(parsed.pathname)) return null;
    const match = parsed.pathname.match(/(?:^|\/)c\/([\w-]+)(?:\/|$)/);
    return match ? `chat:${match[1]}` : `tab:${tabId}`;
  } catch {
    return null;
  }
}

function storageLocation(key) {
  return key.startsWith("chat:") ? chrome.storage.local : chrome.storage.session;
}

async function readEnabled(key) {
  if (!key) return false;
  const data = await storageLocation(key).get(`watch:${key}`);
  return data[`watch:${key}`] === true;
}

async function setEnabled(key, enabled) {
  const storage = storageLocation(key);
  const name = `watch:${key}`;
  if (enabled) await storage.set({ [name]: true });
  else await storage.remove(name);
}

async function getConfig(tab, promoteDraft = false) {
  const key = chatKey(tab.url, tab.id);
  if (!key) return { enabled: false, key: null };

  if (promoteDraft && key.startsWith("chat:")) {
    const draftKey = `tab:${tab.id}`;
    if (await readEnabled(draftKey)) {
      await setEnabled(key, true);
      await setEnabled(draftKey, false);
    }
  }
  return { enabled: await readEnabled(key), key };
}

async function notifyTabsToSync() {
  const tabs = await chrome.tabs.query({ url: CHAT_PATTERNS });
  await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: "SYNC_CONFIG" }).catch(() => {})));
}

async function overview() {
  const tabs = await chrome.tabs.query({ url: CHAT_PATTERNS });
  const settings = await chrome.storage.local.get({ showTitles: false, soundEnabled: true });
  const result = await Promise.all(tabs.map(async (tab) => {
    const config = await getConfig(tab);
    let phase = "idle";
    let signal = "Nessun segnale";
    let detector = null;
    try {
      const answer = await chrome.tabs.sendMessage(tab.id, { type: "GET_STATUS" });
      if (answer?.key === config.key && config.enabled) {
        phase = answer.phase || "idle";
        signal = answer.signal || "Nessun segnale";
        detector = answer.detector || null;
      } else if (config.enabled) {
        phase = "unavailable";
        signal = "Script da ricaricare";
      }
    } catch {
      phase = "unavailable";
    }
    return {
      id: tab.id,
      windowId: tab.windowId,
      active: tab.active,
      title: tab.title || "ChatGPT",
      key: config.key,
      enabled: config.enabled,
      phase,
      signal,
      detector
    };
  }));
  return { tabs: result.filter((tab) => tab.key), showTitles: settings.showTitles === true, soundEnabled: settings.soundEnabled !== false };
}

async function createCompletionNotification(tabId, sourceUrl) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  const key = chatKey(tab.url, tabId);
  if (!key || key !== chatKey(sourceUrl, tabId) || !(await readEnabled(key))) return;

  const now = Date.now();
  if (now - (notificationCooldown.get(tabId) || 0) < 4000) return;
  notificationCooldown.set(tabId, now);

  const { showTitles } = await chrome.storage.local.get({ showTitles: false });
  const title = showTitles ? (tab.title || "ChatGPT").replace(/\s*[-–|]\s*ChatGPT\s*$/, "").slice(0, 90) : "ChatGPT · Risposta pronta";
  await chrome.notifications.create(`complete:${tabId}:${now}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message: "La risposta è terminata. Clicca per aprire la chat.",
    priority: 1
  });
  await playSound();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "offscreen") return false;
  (async () => {
    switch (message?.type) {
      case "GET_CONFIG": {
        if (!sender.tab || !sender.url || !chatKey(sender.url, sender.tab.id)) return { enabled: false, key: null };
        return getConfig({ id: sender.tab.id, url: sender.url }, message.promoteDraft === true);
      }
      case "GET_OVERVIEW":
        if (sender.tab) return null;
        return overview();
      case "SET_MONITOR": {
        if (sender.tab || !Number.isInteger(message.tabId)) return { ok: false };
        const tab = await chrome.tabs.get(message.tabId).catch(() => null);
        const key = tab && chatKey(tab.url, tab.id);
        if (!key) return { ok: false };
        await setEnabled(key, message.enabled === true);
        await notifyTabsToSync();
        return { ok: true };
      }
      case "SET_SHOW_TITLES": {
        if (sender.tab) return { ok: false };
        await chrome.storage.local.set({ showTitles: message.enabled === true });
        return { ok: true };
      }
      case "SET_SOUND_ENABLED": {
        if (sender.tab || typeof message.enabled !== "boolean") return { ok: false };
        await chrome.storage.local.set({ soundEnabled: message.enabled });
        return { ok: true };
      }
      case "TEST_SOUND": {
        if (sender.tab) return { ok: false, error: "Invalid sender" };
        return playSound(true);
      }
      case "COMPLETED": {
        if (!sender.tab || !sender.url || !chatKey(sender.url, sender.tab.id)) return { ok: false };
        await createCompletionNotification(sender.tab.id, sender.url);
        return { ok: true };
      }
      case "TEST_NOTIFICATION": {
        if (sender.tab) return { ok: false, error: "Invalid sender" };
        const permission = await chrome.notifications.getPermissionLevel();
        if (permission !== "granted") {
          return { ok: false, permission, error: "Chrome non autorizza le notifiche dell'estensione." };
        }
        const requestedId = `test:${Date.now()}`;
        const notificationId = await chrome.notifications.create(requestedId, {
          type: "basic",
          iconUrl: chrome.runtime.getURL("icons/icon128.png"),
          title: "ChatWatch · Notifica di prova",
          message: "Se vedi questo avviso, le notifiche desktop sono visibili.",
          priority: 2
        });
        if (!notificationId) return { ok: false, permission, error: "Chrome non ha restituito un identificativo di notifica." };
        const notifications = await chrome.notifications.getAll();
        return {
          ok: true,
          permission,
          created: true,
          registered: Object.prototype.hasOwnProperty.call(notifications, notificationId)
        };
      }
      default:
        return null;
    }
  })().then(sendResponse).catch((error) => sendResponse({ error: error?.message || "Unknown error" }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    chrome.tabs.sendMessage(tabId, { type: "SYNC_CONFIG" }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  notificationCooldown.delete(tabId);
  chrome.storage.session.remove(`watch:tab:${tabId}`).catch(() => {});
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const match = notificationId.match(/^complete:(\d+):/);
  if (!match) return;
  const tab = await chrome.tabs.get(Number(match[1])).catch(() => null);
  if (!tab) return;
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.notifications.clear(notificationId);
});
