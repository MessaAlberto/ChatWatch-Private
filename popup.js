"use strict";

const tabList = document.getElementById("tab-list");
const errorBox = document.getElementById("error");
const titleSwitch = document.getElementById("show-titles");
const soundSwitch = document.getElementById("sound-enabled");
const soundTestButton = document.getElementById("test-sound");
const detectorResult = document.getElementById("detector-result");
let filter = "all";
let busy = new Set();
let latest = { tabs: [], showTitles: false, soundEnabled: true };
let refreshing = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatTitle(title, tabId) {
  const cleaned = (title || "").replace(/\s*[-–|]\s*ChatGPT\s*$/, "").trim();
  return cleaned && cleaned !== "ChatGPT" ? cleaned : `ChatGPT · Scheda ${tabId}`;
}

function status(tab) {
  if (!tab.enabled) return { text: "Non monitorata", type: "idle" };
  if (tab.phase === "running") return { text: `Risposta in corso · ${tab.signal || "rilevamento attivo"}`, type: "running" };
  if (tab.phase === "ready") return { text: "Risposta completata", type: "ready" };
  if (tab.phase === "unavailable") return { text: "Apri o ricarica la scheda", type: "unavailable" };
  return { text: "In attesa di una risposta", type: "idle" };
}

function svgIcon() {
  const span = el("span", "tab-icon");
  span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3V6a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 10h8M8 14h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  return span;
}

function updateView() {
  const all = latest.tabs || [];
  const enabled = all.filter((tab) => tab.enabled);
  document.getElementById("count-monitored").textContent = enabled.length;
  document.getElementById("count-running").textContent = enabled.filter((tab) => tab.phase === "running").length;
  document.getElementById("count-ready").textContent = enabled.filter((tab) => tab.phase === "ready").length;
  document.getElementById("tab-count").textContent = all.length;
  if (document.activeElement !== titleSwitch) titleSwitch.checked = latest.showTitles;
  if (document.activeElement !== soundSwitch) soundSwitch.checked = latest.soundEnabled;
  soundTestButton.disabled = !latest.soundEnabled;

  const selected = all.filter((tab) => filter === "all" || tab.enabled);
  selected.sort((a, b) => Number(b.enabled) - Number(a.enabled) || Number(b.active) - Number(a.active) || a.id - b.id);
  const fragment = document.createDocumentFragment();
  if (!selected.length) {
    const empty = el("div", "empty");
    empty.append(el("strong", "", filter === "monitored" ? "Nessuna chat monitorata" : "Nessuna scheda ChatGPT"));
    empty.append(el("span", "", filter === "monitored" ? "Attiva l'interruttore su una chat dalla scheda Tutte." : "Apri ChatGPT in una scheda di Chrome per iniziare."));
    fragment.append(empty);
  }
  for (const tab of selected) {
    const state = status(tab);
    const item = el("div", `tab ${tab.enabled ? "monitored" : ""}`.trim());
    item.append(svgIcon());
    const info = el("div", "tab-info");
    const label = el("div", "tab-title", formatTitle(tab.title, tab.id));
    label.title = label.textContent;
    const detail = el("div", `tab-detail ${state.type}`);
    detail.append(el("span", "status-dot"), el("span", "", state.text));
    info.append(label, detail);
    item.append(info);
    const toggle = el("button", "switch-button");
    toggle.type = "button";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-label", `${tab.enabled ? "Disattiva" : "Attiva"} monitoraggio: ${label.textContent}`);
    toggle.setAttribute("aria-checked", String(tab.enabled));
    toggle.dataset.id = String(tab.id);
    toggle.disabled = busy.has(tab.id);
    item.append(toggle);
    fragment.append(item);
  }
  tabList.replaceChildren(fragment);
  if (!detectorResult.hidden) renderDiagnostics();
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_OVERVIEW" });
    if (response?.error) throw new Error(response.error);
    if (!response?.tabs) throw new Error("Unable to retrieve ChatGPT tabs.");
    latest = response;
    errorBox.hidden = true;
    updateView();
  } catch (error) {
    errorBox.textContent = `Errore: ${error.message}`;
    errorBox.hidden = false;
  } finally {
    refreshing = false;
  }
}

tabList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  const id = Number(button.dataset.id);
  const tab = latest.tabs.find((item) => item.id === id);
  if (!tab || busy.has(id)) return;
  busy.add(id);
  updateView();
  try {
    const response = await chrome.runtime.sendMessage({ type: "SET_MONITOR", tabId: id, enabled: !tab.enabled });
    if (!response?.ok) throw new Error("Impossibile aggiornare la chat.");
    await refresh();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    busy.delete(id);
    updateView();
  }
});

document.querySelectorAll(".filter").forEach((button) => {
  button.addEventListener("click", () => {
    filter = button.dataset.filter;
    document.querySelectorAll(".filter").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    updateView();
  });
});

titleSwitch.addEventListener("change", async () => {
  try {
    const result = await chrome.runtime.sendMessage({ type: "SET_SHOW_TITLES", enabled: titleSwitch.checked });
    if (!result?.ok) throw new Error("Impostazione non salvata.");
    latest.showTitles = titleSwitch.checked;
  } catch (error) {
    titleSwitch.checked = !titleSwitch.checked;
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
});


soundSwitch.addEventListener("change", async () => {
  const enabled = soundSwitch.checked;
  try {
    const result = await chrome.runtime.sendMessage({ type: "SET_SOUND_ENABLED", enabled });
    if (!result?.ok) throw new Error("Impossibile salvare la preferenza audio.");
    latest.soundEnabled = enabled;
    updateView();
  } catch (error) {
    soundSwitch.checked = !enabled;
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
});

soundTestButton.addEventListener("click", async () => {
  soundTestButton.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "TEST_SOUND" });
    if (!result?.ok) throw new Error(result?.error || "Riproduzione non disponibile.");
    showNotificationResult("Suono di prova inviato", "Se non hai sentito il segnale, controlla l'uscita audio e il volume del sistema.");
  } catch (error) {
    showNotificationResult("Suono non disponibile", error.message, true);
  } finally {
    soundTestButton.disabled = !latest.soundEnabled;
  }
});

function renderDiagnostics() {
  const monitored = (latest.tabs || []).filter((tab) => tab.enabled);
  const heading = el("strong", "", "Stato sensori (nessun testo dei messaggi letto)");
  const description = el("p", "", "Aggiornamento automatico ogni 2,5 secondi. Invia un messaggio nella chat monitorata e osserva i segnali.");
  const rows = monitored.map((tab) => {
    const data = tab.detector;
    const row = el("div", "sensor-row");
    row.append(el("div", "sensor-name", `Scheda ${tab.id} · ${status(tab).text.split(" · ")[0]}`));
    if (!data) {
      row.append(el("div", "sensor-data", "Script non raggiungibile: ricarica questa scheda ChatGPT."));
      return row;
    }
    row.append(el("div", "sensor-data", `Pulsante Stop: ${data.stopVisible ? "sì" : "no"} · Invio: ${data.sendVisible ? "sì" : "no"}`));
    row.append(el("div", "sensor-data", `Invii rilevati: ${data.submissions} · Stop rilevati: ${data.stop} · Attività assistente: ${data.assistant} · Risposte completate: ${data.completed}`));
    row.append(el("div", "sensor-data", `Ultimo evento: ${tab.signal || "nessuno"}`));
    return row;
  });
  if (!rows.length) rows.push(el("p", "", "Nessuna chat abilitata."));
  detectorResult.replaceChildren(heading, description, ...rows);
}

document.getElementById("check-detector").addEventListener("click", async () => {
  detectorResult.hidden = false;
  await refresh();
  renderDiagnostics();
});

const notificationResult = document.getElementById("notification-result");
const notificationHelp = document.getElementById("notification-help");
let platformHelp = systemNotificationHelp("unknown");
const platformReady = detectNotificationPlatform().then((platform) => {
  platformHelp = platform;
  notificationHelp.textContent = `${platform.name}: ${platform.path}. ${platform.instructions}`;
  return platform;
});

function showNotificationResult(title, details, warning = false) {
  const heading = el("strong", "", title);
  const paragraph = el("p", "", details);
  if (!notificationResult) {
    errorBox.textContent = `${title}: ${details}`;
    errorBox.hidden = false;
    return;
  }
  notificationResult.replaceChildren(heading, paragraph);
  notificationResult.classList.toggle("warning", warning);
  notificationResult.hidden = false;
}

document.getElementById("test-notification").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  showNotificationResult("Verifica in corso…", "Controllo delle autorizzazioni di Chrome.");
  try {
    await platformReady;
    const result = await chrome.runtime.sendMessage({ type: "TEST_NOTIFICATION" });
    if (!result?.ok) throw new Error(result?.error || "Chrome non ha creato la notifica.");
    const details = result.registered
      ? `Chrome ha registrato la notifica, ma non può verificare che il sistema abbia mostrato il banner. Se non lo vedi: ${platformHelp.path}. ${platformHelp.instructions}`
      : `Chrome ha accettato la richiesta, ma la notifica non risulta più attiva. Potrebbe essere già stata chiusa o nascosta. Controlla: ${platformHelp.path}. ${platformHelp.instructions}`;
    showNotificationResult("Richiesta accettata da Chrome", details);
  } catch (error) {
    showNotificationResult("Notifica non disponibile", `${error.message} Controlla i permessi dell'estensione in Chrome, poi ${platformHelp.path}. ${platformHelp.instructions}`, true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById("refresh").addEventListener("click", refresh);
refresh();
setInterval(refresh, 2500);
