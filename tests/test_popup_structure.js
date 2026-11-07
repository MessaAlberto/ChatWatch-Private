"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "popup.html"), "utf8");
const js = fs.readFileSync(path.join(root, "popup.js"), "utf8");
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const references = [...js.matchAll(/document\.getElementById\("([^"]+)"\)/g)].map((match) => match[1]);

for (const id of references) {
  assert(ids.has(id), `popup.js refers to missing popup.html element: #${id}`);
}

assert.match(html, /id="notification-result"[^>]*role="status"/);
assert.match(js, /notificationResult\.replaceChildren\(heading, paragraph\)/);
console.log(`Popup: all ${references.length} JavaScript element references exist; diagnostic section available.`);
