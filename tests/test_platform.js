"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "..", "platform.js"), "utf8");

async function testPlatform(os, expectedName, expectedPath) {
  const sandbox = {
    chrome: { runtime: { async getPlatformInfo() { return { os }; } } }
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const result = await vm.runInContext("detectNotificationPlatform()", sandbox);
  assert.equal(result.name, expectedName);
  assert.match(result.path, expectedPath);
  assert.equal(typeof result.instructions, "string");
  assert(result.instructions.length > 10);
}

(async () => {
  await testPlatform("mac", "macOS", /Impostazioni di Sistema.*Notifiche.*Google Chrome/);
  await testPlatform("win", "Windows", /Impostazioni.*Sistema.*Notifiche.*Google Chrome/);
  await testPlatform("linux", "Linux", /Impostazioni di sistema.*Notifiche/);
  await testPlatform("cros", "ChromeOS", /Impostazioni.*App.*Notifiche/);
  await testPlatform("openbsd", "Sistema non identificato", /Impostazioni di sistema/);
  const sandbox = { chrome: { runtime: { async getPlatformInfo() { throw Error("Not available"); } } } };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const result = await vm.runInContext("detectNotificationPlatform()", sandbox);
  assert.equal(result.name, "Sistema non identificato");
  console.log("Platform: macOS, Windows, Linux, ChromeOS and fallback OK");
})().catch((error) => { console.error(error); process.exitCode = 1; });
