"use strict";

function systemNotificationHelp(os) {
  switch (os) {
    case "mac":
      return {
        name: "macOS",
        path: "Impostazioni di Sistema → Notifiche → Google Chrome",
        instructions: "Attiva «Consenti notifiche» e scegli «Banner» o «Avvisi». Se ci sono due voci Google Chrome, controllale entrambe. Verifica anche «Full immersion» → «Non disturbare».",
        reload: "⌘R"
      };
    case "win":
      return {
        name: "Windows",
        path: "Impostazioni → Sistema → Notifiche → Google Chrome",
        instructions: "Attiva le notifiche di Chrome e i banner. Verifica anche che «Non disturbare» sia disattivato.",
        reload: "Ctrl+R"
      };
    case "linux":
      return {
        name: "Linux",
        path: "Impostazioni di sistema → Notifiche",
        instructions: "Consenti le notifiche di Google Chrome e controlla la modalità «Non disturbare». I menu possono variare tra GNOME, KDE e altri ambienti desktop.",
        reload: "Ctrl+R"
      };
    case "cros":
      return {
        name: "ChromeOS",
        path: "Impostazioni → App → Notifiche",
        instructions: "Controlla le notifiche di Chrome e disattiva «Non disturbare».",
        reload: "Ctrl+R"
      };
    default:
      return {
        name: "Sistema non identificato",
        path: "Impostazioni di sistema → Notifiche",
        instructions: "Consenti le notifiche di Google Chrome e disattiva «Non disturbare», se attivo.",
        reload: "Ricarica"
      };
  }
}

async function detectNotificationPlatform() {
  try {
    const platform = await chrome.runtime.getPlatformInfo();
    return systemNotificationHelp(platform.os);
  } catch {
    return systemNotificationHelp("unknown");
  }
}
