import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const resultsPath = resolve(root, "evidence/results/browser-compatibility-results.json");
const port = Number(process.env.PORT ?? 4175);
const baseUrl = `http://127.0.0.1:${port}`;
const require = createRequire(import.meta.url);
const playwright = process.env.CODEX_NODE_MODULES
  ? require(join(process.env.CODEX_NODE_MODULES, "playwright"))
  : require("playwright");

const candidates = [
  {
    name: "Microsoft Edge",
    launcher: playwright.chromium,
    channel: "msedge"
  },
  {
    name: "Google Chrome",
    launcher: playwright.chromium,
    channel: "chrome"
  }
];

function waitForServer(server) {
  return new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error("The compatibility-test server did not start.")), 10000);
    server.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("Prototype available")) {
        clearTimeout(timeout);
        resolveReady();
      }
    });
    server.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`The compatibility-test server exited with code ${code}.`));
    });
  });
}

async function completeCleanOnboarding(page) {
  await page.locator("#full-name").fill("Compatibility User");
  await page.locator("#email").fill("compatibility@example.com");
  await page.locator("#continue-button").click();
  await page.locator("#role").selectOption("Developer");
  await page.locator("#continue-button").click();
  await page.locator("#primary-goal").selectOption("Plan a project");
  await page.locator("#outcome").fill("Create a clear and accessible project plan.");
  await page.locator("#continue-button").click();
  await page.locator('input[name="pace"][value="Concise"]').check();
  await page.locator("#continue-button").click();
  await page.locator("#confirmation").check();
  await page.locator("#continue-button").click();
}

const server = spawn(process.execPath, ["scripts/server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"]
});

const results = {
  recorded_at: new Date().toISOString(),
  viewport: { width: 1280, height: 900 },
  browsers: []
};

try {
  await waitForServer(server);
  for (const candidate of candidates) {
    let browser;
    const browserResult = {
      name: candidate.name,
      version: null,
      initial_state: false,
      friction_boundary: false,
      critical_override: false,
      clean_completion: false,
      console_errors: [],
      status: "fail"
    };

    try {
      browser = await candidate.launcher.launch({ channel: candidate.channel, headless: true });
      browserResult.version = await browser.version();
      const page = await browser.newPage({ viewport: results.viewport });
      page.on("console", (message) => {
        if (message.type() === "error") browserResult.console_errors.push(message.text());
      });
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await page.waitForFunction(() => Boolean(window.__fypPrototype));

      browserResult.initial_state =
        (await page.locator("#state-badge").textContent()) === "Standard support" &&
        (await page.locator("#trace-state").textContent()) === "Stable";
      await page.locator("#continue-button").click();
      await page.locator("#continue-button").click();
      browserResult.friction_boundary =
        (await page.locator("#state-badge").textContent()) === "Additional guidance" &&
        (await page.locator("#trace-state").textContent()) === "Friction";
      await page.locator("#continue-button").click();
      browserResult.critical_override =
        (await page.locator("#state-badge").textContent()) === "Focused guidance" &&
        (await page.locator("#trace-state").textContent()) === "Critical" &&
        (await page.locator("#trace-rule").textContent()) === "Repeated input-failure override";

      await page.locator("#reset-button").click();
      await completeCleanOnboarding(page);
      browserResult.clean_completion =
        (await page.locator("#completion-panel").isVisible()) &&
        (await page.locator("#state-badge").textContent()) === "Standard support" &&
        (await page.locator("#trace-state").textContent()) === "Stable";

      assert.equal(browserResult.initial_state, true);
      assert.equal(browserResult.friction_boundary, true);
      assert.equal(browserResult.critical_override, true);
      assert.equal(browserResult.clean_completion, true);
      assert.deepEqual(browserResult.console_errors, []);
      browserResult.status = "pass";
    } catch (error) {
      browserResult.error = error.message;
    } finally {
      if (browser) await browser.close();
      results.browsers.push(browserResult);
    }
  }

  results.summary = {
    passed: results.browsers.filter((browser) => browser.status === "pass").length,
    failed: results.browsers.filter((browser) => browser.status !== "pass").length
  };
  await mkdir(dirname(resultsPath), { recursive: true });
  await writeFile(resultsPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  assert.equal(results.summary.failed, 0);
  console.log(JSON.stringify(results, null, 2));
} finally {
  server.kill("SIGTERM");
}
