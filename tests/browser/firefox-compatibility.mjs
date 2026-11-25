import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const resultsPath = resolve(root, "evidence/results/firefox-compatibility-results.json");
const screenshotPath = resolve(root, "evidence/screenshots/07-firefox-initial-render.png");
const port = Number(process.env.PORT ?? 4176);
const baseUrl = `http://127.0.0.1:${port}`;
const firefoxPath = "C:\\Program Files\\Mozilla Firefox\\firefox.exe";
const applicationIni = "C:\\Program Files\\Mozilla Firefox\\application.ini";

function waitForOutput(processHandle, text, timeoutMs = 15000) {
  return new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out while waiting for ${text}.`)), timeoutMs);
    processHandle.stdout.on("data", (chunk) => {
      if (chunk.toString().includes(text)) {
        clearTimeout(timeout);
        resolveReady();
      }
    });
    processHandle.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`The prototype server exited with code ${code}.`));
    });
  });
}

function waitForExit(processHandle, timeoutMs = 30000) {
  return new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      processHandle.kill("SIGTERM");
      reject(new Error("Firefox did not finish the render check in time."));
    }, timeoutMs);
    processHandle.on("exit", (code) => {
      clearTimeout(timeout);
      code === 0 ? resolveExit() : reject(new Error(`Firefox exited with code ${code}.`));
    });
  });
}

const result = {
  recorded_at: new Date().toISOString(),
  name: "Mozilla Firefox",
  version: null,
  initial_render: false,
  method: "Native Firefox headless rendering of the live local prototype",
  interaction_automation: "Not performed in Firefox; full interaction scenarios were automated in Edge and Chrome.",
  status: "fail"
};

const appServer = spawn(process.execPath, ["scripts/server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForOutput(appServer, "Prototype available");
  await mkdir(dirname(screenshotPath), { recursive: true });

  const iniText = await readFile(applicationIni, "utf8");
  result.version = iniText.match(/^Version=(.+)$/m)?.[1] ?? "Unknown";

  const firefox = spawn(
    firefoxPath,
    ["-headless", "--window-size", "1365,1265", "-screenshot", screenshotPath, baseUrl],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] }
  );
  await waitForExit(firefox);

  const screenshotStat = await stat(screenshotPath);
  result.initial_render = screenshotStat.isFile() && screenshotStat.size > 10000;
  assert.equal(result.initial_render, true);
  result.status = "pass";
} catch (error) {
  result.error = error.message;
  throw error;
} finally {
  await mkdir(dirname(resultsPath), { recursive: true });
  await writeFile(resultsPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  appServer.kill("SIGTERM");
}

console.log(JSON.stringify(result, null, 2));
