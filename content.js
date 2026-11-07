"use strict";

(() => {
  if (globalThis.__chatWatchLoaded) return;
  globalThis.__chatWatchLoaded = true;

  const STOP_SELECTOR = [
    '[data-testid="stop-button"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label="Stop response"]',
    'button[aria-label="Interrompi la generazione"]',
    'button[aria-label="Interrompi risposta"]',
    'button[aria-label="Detener generación"]',
    'button[aria-label="Arrêter la génération"]'
  ].join(",");
  const SEND_SELECTOR = [
    '[data-testid="send-button"]',
    '#composer-submit-button',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Invia messaggio"]',
    'button.composer-submit-btn'
  ].join(",");
  const EDITOR_SELECTOR = '#prompt-textarea, [contenteditable="true"][role="textbox"], textarea[name="prompt-textarea"]';
  const ASSISTANT_SELECTOR = [
    'section[data-turn="assistant"]',
    '[data-message-author-role="assistant"]',
    '[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]'
  ].join(",");
  const STOP_SQUARE_PATH = "M4.5 5.75C4.5";
  const FINISH_DELAY = 1700;
  const FALLBACK_DELAY = 3000;

  let enabled = false;
  let key = null;
  let phase = "idle";
  let observer = null;
  let scanTimer = null;
  let finishTimer = null;
  let heartbeat = null;
  let currentUrl = location.href;
  let syncRevision = 0;
  let draftSendAt = 0;
  let interrupted = false;
  let sawStop = false;
  let sawSubmit = false;
  let sawAssistant = false;
  let assistantMutationAt = 0;
  let startedAt = 0;
  let lastSignal = "In attesa";
  let lastStop = false;
  let lastSend = false;
  let counters = { submissions: 0, stop: 0, assistant: 0, completed: 0 };

  function visible(node) {
    return !!node && node.getClientRects().length > 0;
  }

  function hasStop() {
    for (const button of document.querySelectorAll(STOP_SELECTOR)) {
      if (visible(button)) return true;
    }
    const primary = document.querySelector('#composer-submit-button, form[data-chatgpt-composer] button.size-token-button-composer');
    if (!visible(primary)) return false;
    const path = primary.querySelector('svg path[d]');
    return !!path && (path.getAttribute('d') || '').startsWith(STOP_SQUARE_PATH);
  }

  function hasSend() {
    for (const button of document.querySelectorAll(SEND_SELECTOR)) {
      if (visible(button) && !button.disabled && !button.matches(STOP_SELECTOR)) {
        const path = button.querySelector('svg path[d]');
        if (!path || !(path.getAttribute('d') || '').startsWith(STOP_SQUARE_PATH)) return true;
      }
    }
    return false;
  }

  function clearTimers() {
    clearTimeout(scanTimer);
    clearTimeout(finishTimer);
    clearInterval(heartbeat);
    scanTimer = null;
    finishTimer = null;
    heartbeat = null;
  }

  function stopWatching() {
    observer?.disconnect();
    observer = null;
    clearTimers();
    phase = "idle";
    interrupted = false;
    sawStop = false;
    sawSubmit = false;
    sawAssistant = false;
    assistantMutationAt = 0;
    startedAt = 0;
    lastSignal = "In attesa";
    lastStop = false;
    lastSend = false;
  }

  function startRun(signal) {
    if (phase !== "running") {
      phase = "running";
      interrupted = false;
      sawStop = false;
      sawSubmit = false;
      sawAssistant = false;
      assistantMutationAt = 0;
      startedAt = Date.now();
    }
    lastSignal = signal;
    if (!heartbeat) heartbeat = setInterval(scan, 1000);
  }

  function sentPrompt() {
    if (!enabled) return;
    if (phase !== "running") startRun("Invio del messaggio rilevato");
    sawSubmit = true;
    counters.submissions++;
    lastSignal = "Invio del messaggio rilevato";
    clearTimeout(finishTimer);
    finishTimer = null;
    scheduleScan();
  }

  function assistantRelated(target) {
    const element = target?.nodeType === 1 ? target : target?.parentElement;
    if (!element?.closest) return false;
    return !!element.closest(ASSISTANT_SELECTOR);
  }

  function recordMutations(mutations) {
    if (!enabled) return;
    if (phase === "running") {
      for (const mutation of mutations) {
        if (!assistantRelated(mutation.target)) continue;
        sawAssistant = true;
        assistantMutationAt = Date.now();
        counters.assistant++;
        break;
      }
    }
    scheduleScan();
  }

  async function finishIfStable() {
    finishTimer = null;
    if (!enabled || phase !== "running") return;
    if (location.href !== currentUrl) { routeChanged(); return; }
    if (hasStop()) { scan(); return; }
    if (interrupted) {
      phase = "idle";
      lastSignal = "Generazione interrotta manualmente";
    } else if (sawStop || (sawSubmit && sawAssistant && hasSend())) {
      const age = Date.now() - assistantMutationAt;
      if (!sawStop && age < FALLBACK_DELAY) {
        finishTimer = setTimeout(finishIfStable, FALLBACK_DELAY - age);
        return;
      }
      phase = "ready";
      counters.completed++;
      lastSignal = "Completamento rilevato";
      chrome.runtime.sendMessage({ type: "COMPLETED" }).catch(() => {});
    }
    if (phase !== "running") {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }

  function scan() {
    scanTimer = null;
    if (!enabled) return;
    if (location.href !== currentUrl) { routeChanged(); return; }
    const stopNow = hasStop();
    const sendNow = hasSend();
    lastStop = stopNow;
    lastSend = sendNow;
    if (stopNow) {
      if (phase !== "running") startRun("Pulsante Stop rilevato");
      if (!sawStop) counters.stop++;
      sawStop = true;
      lastSignal = "Pulsante Stop rilevato";
      clearTimeout(finishTimer);
      finishTimer = null;
      return;
    }
    if (phase !== "running" || finishTimer) return;
    if (interrupted) {
      finishTimer = setTimeout(finishIfStable, 600);
    } else if (sawStop) {
      finishTimer = setTimeout(finishIfStable, FINISH_DELAY);
    } else if (sawSubmit && sawAssistant && sendNow && Date.now() - startedAt > 1800) {
      const age = Date.now() - assistantMutationAt;
      finishTimer = setTimeout(finishIfStable, Math.max(900, FALLBACK_DELAY - age));
    }
  }

  function scheduleScan() {
    if (scanTimer !== null || !enabled) return;
    scanTimer = setTimeout(scan, 220);
  }

  function beginWatching() {
    if (observer || !document.body) return;
    observer = new MutationObserver(recordMutations);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-testid", "aria-label", "disabled", "class"],
      characterData: true
    });
    scan();
  }

  async function syncConfig(promoteDraft = false) {
    const revision = ++syncRevision;
    const urlBefore = location.href;
    let config;
    try {
      config = await chrome.runtime.sendMessage({ type: "GET_CONFIG", promoteDraft });
    } catch {
      config = { enabled: false, key: null };
    }
    if (revision !== syncRevision || location.href !== urlBefore) return;
    const changed = enabled !== !!config?.enabled || key !== (config?.key || null);
    if (changed) stopWatching();
    enabled = !!config?.enabled;
    key = config?.key || null;
    currentUrl = location.href;
    if (enabled) beginWatching();
  }

  function routeChanged() {
    if (location.href === currentUrl) return;
    const newChat = /(?:^|\/)c\/[\w-]+(?:\/|$)/.test(location.pathname);
    const promoteDraft = enabled && key?.startsWith("tab:") && newChat && Date.now() - draftSendAt < 30000;
    draftSendAt = 0;
    currentUrl = location.href;
    stopWatching();
    enabled = false;
    key = null;
    syncConfig(promoteDraft);
  }

  function isComposerEditor(target) {
    const element = target instanceof Element ? target : target?.parentElement;
    return !!element?.closest?.(EDITOR_SELECTOR);
  }

  function isComposerSendButton(target) {
    if (!(target instanceof Element)) return false;
    const button = target.closest(`${SEND_SELECTOR}, form button[type="submit"]`);
    if (!button || button.matches(STOP_SELECTOR)) return false;
    if (button.querySelector('svg path[d^="M4.5 5.75C4.5"]')) return false;
    const form = button.closest("form");
    return !!form || !!button.closest("[data-testid='composer']") || button.id === "composer-submit-button";
  }

  document.addEventListener("submit", (event) => {
    if (!enabled || !event.target?.querySelector?.(EDITOR_SELECTOR)) return;
    if (key?.startsWith("tab:")) draftSendAt = Date.now();
    sentPrompt();
  }, true);

  document.addEventListener("keydown", (event) => {
    if (!enabled || event.key !== "Enter" || event.shiftKey || event.isComposing || !isComposerEditor(event.target)) return;
    if (key?.startsWith("tab:")) draftSendAt = Date.now();
    sentPrompt();
  }, true);

  document.addEventListener("click", (event) => {
    if (!enabled || !(event.target instanceof Element)) return;
    if (event.target.closest(STOP_SELECTOR) || event.target.closest('button:has(svg path[d^="M4.5 5.75C4.5"])')) {
      interrupted = true;
      lastSignal = "Interruzione manuale rilevata";
    } else if (isComposerSendButton(event.target)) {
      if (key?.startsWith("tab:")) draftSendAt = Date.now();
      sentPrompt();
    }
    const link = event.target.closest("a[href]");
    if (link && (link.href.startsWith("https://chatgpt.com/") || link.href.startsWith("https://chat.openai.com/"))) {
      draftSendAt = 0;
      setTimeout(routeChanged, 100);
      setTimeout(routeChanged, 550);
    }
  }, true);

  window.addEventListener("popstate", () => setTimeout(routeChanged, 0));
  window.addEventListener("hashchange", () => setTimeout(routeChanged, 0));
  if (window.navigation) window.navigation.addEventListener("currententrychange", routeChanged);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SYNC_CONFIG") {
      if (location.href !== currentUrl) routeChanged();
      else syncConfig();
      sendResponse({ ok: true });
    }
    if (message?.type === "GET_STATUS") {
      sendResponse({
        key, enabled, phase, signal: lastSignal,
        detector: { stopVisible: lastStop, sendVisible: lastSend, sawStop, sawSubmit, sawAssistant, ...counters }
      });
    }
  });

  syncConfig();
})();
