import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const screenshotDirectory = resolve(root, "evidence/screenshots");
const resultsPath = resolve(root, "evidence/results/browser-test-results.json");
const port = Number(process.env.PORT ?? 4173);
const baseUrl = `http://127.0.0.1:${port}`;

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  return process.env.CODEX_NODE_MODULES
    ? require(join(process.env.CODEX_NODE_MODULES, "playwright"))
    : require("playwright");
}

function waitForServer(server) {
  return new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error("The prototype server did not start in time.")), 10000);
    server.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("Prototype available")) {
        clearTimeout(timeout);
        resolveReady();
      }
    });
    server.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`The prototype server exited with code ${code}.`));
    });
  });
}

const { chromium } = loadPlaywright();
const server = spawn(process.execPath, ["scripts/server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"]
});

const results = {
  recorded_at: new Date().toISOString(),
  browser: null,
  viewport: { width: 1440, height: 1000 },
  cases: [],
  remote_requests: [],
  console_errors: [],
  ui_metrics: []
};
function record(id, description) { results.cases.push({ id, description, status: "pass" }); }

let browser;
let page;
try {
  await waitForServer(server);
  await mkdir(screenshotDirectory, { recursive: true });
  await mkdir(dirname(resultsPath), { recursive: true });
  const executablePath = process.env.BROWSER_PATH;
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
  results.browser = await browser.version();
  page = await browser.newPage({ viewport: results.viewport });
  await page.context().tracing.start({ screenshots: true, snapshots: true });

  page.on("console", (message) => { if (message.type() === "error") results.console_errors.push(message.text()); });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) results.remote_requests.push(request.url());
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__fypPrototype));
  assert.equal(await page.locator("#state-badge").textContent(), "Standard support");
  assert.equal(await page.locator("#trace-state").textContent(), "Stable");
  record("B01", "Application opens with standard user-facing support and a Stable research state.");
  await page.screenshot({ path: resolve(screenshotDirectory, "01-stable-initial.png"), fullPage: true });

  const missingLabels = await page.locator("input, select, textarea").evaluateAll((controls) =>
    controls.filter((control) => control.labels?.length === 0).map((control) => control.id || control.name)
  );
  assert.deepEqual(missingLabels, []);
  assert.equal(await page.locator('[aria-live="polite"]').count(), 1);
  assert.equal(await page.locator("#support-message").getAttribute("aria-live"), null);
  assert.equal(await page.locator("#mobile-support-title").getAttribute("aria-live"), null);
  record("B02", "Controls have labels and exactly one canonical polite live-announcement source.");

  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "onboarding-form");
  record("B03", "The skip link moves keyboard focus to the form.");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__fypPrototype));

  await page.locator("#continue-button").click();
  assert.equal(await page.locator("#trace-state").textContent(), "Stable");
  assert.equal(await page.locator("#state-badge").textContent(), "Standard support");
  assert.equal(await page.locator("#adaptive-announcer").textContent(), "");
  assert.equal(await page.locator("#support-message-text").textContent(), "The highlighted field explains what must be corrected before you continue. No additional adaptive guidance is active.");
  record("B04", "One isolated error remains ordinary validation and produces no adaptive announcement.");
  await page.screenshot({ path: resolve(screenshotDirectory, "02-isolated-validation.png"), fullPage: true });
  await page.locator("#continue-button").click();
  assert.equal(await page.locator("#state-badge").textContent(), "Additional guidance");
  assert.equal(await page.locator("#trace-state").textContent(), "Friction");
  assert.equal(await page.locator("#trace-score-row").isHidden(), true);
  assert.equal(await page.locator("#trace-raw-score").textContent(), "0.4");
  assert.doesNotMatch(await page.locator("#support-message-text").textContent(), /Enter your full name/i);
  record("B05", "Two input errors reach Friction and activate non-duplicative additional guidance.");
  await page.locator("details.trace-panel summary").click();
  await page.screenshot({ path: resolve(screenshotDirectory, "03-friction-live-adaptation.png"), fullPage: true });

  await page.locator("#continue-button").click();
  assert.equal(await page.locator("#state-badge").textContent(), "Focused guidance");
  assert.equal(await page.locator("#trace-state").textContent(), "Critical");
  assert.equal(await page.locator("#trace-adjustment").textContent(), "+0.2");
  assert.equal(await page.locator("#trace-score").textContent(), "0.8");
  assert.equal(await page.locator("#trace-score-row").isVisible(), true);
  assert.equal(await page.locator("#support-help-toggle").isVisible(), true);
  assert.doesNotMatch(await page.locator("#support-message-text").textContent(), /Enter your full name/i);
  assert.doesNotMatch(await page.locator("#error-summary-text").textContent(), /Enter your full name/i);
  record("B06", "The repeated-error override exposes its decision score and offers non-duplicative focused help.");
  await page.screenshot({ path: resolve(screenshotDirectory, "04-critical-focused-guidance.png"), fullPage: true });

  const focusBeforeHelp = await page.evaluate(() => document.activeElement?.id);
  await page.locator("#support-help-toggle").click();
  assert.equal(await page.locator("#support-help").isVisible(), true);
  assert.equal(await page.locator("#support-help-toggle").getAttribute("aria-expanded"), "true");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "support-help-toggle");
  await page.screenshot({ path: resolve(screenshotDirectory, "05-reversible-step-by-step-help.png"), fullPage: true });
  await page.locator("#support-help-toggle").click();
  assert.equal(await page.locator("#support-help").isHidden(), true);
  assert.equal(focusBeforeHelp, "full-name");
  record("B07", "Focused help is keyboard-operable, reversible and does not move focus when opened.");

  await page.locator("#full-name").fill("Demo User");
  assert.equal(await page.locator("#full-name-error").textContent(), "");
  assert.equal(await page.locator("#full-name").getAttribute("aria-invalid"), null);
  assert.equal(await page.locator("#error-summary").isHidden(), true);
  assert.equal(await page.locator("#trace-events").textContent(), "4 of 5");
  record("B08", "A corrected field clears stale error presentation and emits one field-valid recovery event.");

  await page.locator("#reset-button").click();
  await page.locator("#full-name").fill("Demo User");
  await page.locator("#email").fill("demo@example.com");
  await page.locator("#continue-button").click();
  assert.equal(await page.locator("[data-step-panel]:visible").getAttribute("data-step-panel"), "2");

  await page.locator("#continue-button").click();
  assert.equal(await page.locator("#role-error").textContent(), "Choose a primary role.");
  assert.equal(await page.locator("#role").getAttribute("aria-invalid"), "true");
  await page.locator("#role").selectOption("Student");
  assert.equal(await page.locator("#role-error").textContent(), "");
  assert.equal(await page.locator("#role").getAttribute("aria-invalid"), null);
  assert.equal(await page.locator("#error-summary").isHidden(), true);
  assert.equal(await page.locator("#trace-raw-score").textContent(), "0.0");
  record("B09", "A valid field change clears its error and summary and resolves matching evidence.");

  await page.locator("#back-button").click();
  assert.equal(await page.locator("#trace-loops").textContent(), "0");
  assert.equal(await page.locator("#trace-raw-score").textContent(), "0.0");
  assert.match(await page.locator("#trace-recovery").textContent(), /no loop evidence/i);
  record("B10", "One Back movement is neutral and does not add navigation-loop evidence.");

  await page.locator("#continue-button").click();
  assert.equal(await page.locator("#trace-loops").textContent(), "1");
  assert.equal(await page.locator("#trace-raw-score").textContent(), "0.2");
  record("B11", "Returning to the route's starting step creates one navigation-loop episode.");

  await page.locator("#back-button").click();
  await page.locator("#continue-button").click();
  await page.locator("#back-button").click();
  await page.locator("#continue-button").click();
  assert.equal(await page.locator("#trace-loops").textContent(), "3");
  assert.equal(await page.locator("#state-badge").textContent(), "Focused guidance");
  assert.equal(await page.locator("#trace-state").textContent(), "Critical");
  assert.equal(await page.locator("#trace-rule").textContent(), "Repeated navigation-loop override");
  assert.equal(await page.locator("#trace-raw-score").textContent(), "0.6");
  assert.equal(await page.locator("#trace-score").textContent(), "0.8");
  await page.locator("#support-help-toggle").click();
  const navigationHelp = await page.locator("#support-help-steps").textContent();
  assert.match(navigationHelp, /current position|required action/i);
  assert.doesNotMatch(navigationHelp, /highlighted|error message|correct that field/i);
  record("B12", "Three completed navigation-loop episodes activate focused navigation support and the Critical override.");
  await page.locator("details.trace-panel").evaluate((details) => { details.open = true; });
  await page.screenshot({ path: resolve(screenshotDirectory, "06-critical-navigation-guidance.png"), fullPage: true });
  await page.locator("#support-help-toggle").click();

  await page.setViewportSize({ width: 320, height: 844 });
  assert.equal(await page.locator(".mobile-support").isVisible(), true);
  assert.equal(await page.locator("#mobile-support-help-toggle").isVisible(), true);
  await page.locator("#mobile-support-help-toggle").click();
  const mobileNavigationHelp = await page.locator("#mobile-support-help-steps").textContent();
  assert.match(mobileNavigationHelp, /current position|required action/i);
  assert.doesNotMatch(mobileNavigationHelp, /highlighted|error message|correct that field/i);
  const mobileCriticalLayout = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const withinViewport = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return rect.left >= 0 && rect.right <= viewportWidth + 0.5;
    };
    return {
      noOverflow: document.documentElement.scrollWidth <= viewportWidth,
      formWithinViewport: withinViewport(".form-card"),
      supportWithinViewport: withinViewport(".mobile-support"),
      helpVisible: !document.querySelector("#mobile-support-help").hidden
    };
  });
  assert.deepEqual(mobileCriticalLayout, {
    noOverflow: true,
    formWithinViewport: true,
    supportWithinViewport: true,
    helpVisible: true
  });
  await page.screenshot({
    path: resolve(screenshotDirectory, "06b-mobile-critical-navigation-help.png"),
    fullPage: true
  });
  await page.locator("#mobile-support-help-toggle").click();
  await page.setViewportSize(results.viewport);

  await page.locator("#continue-button").click();
  assert.equal(await page.locator("#state-badge").textContent(), "Recovering");
  assert.equal(await page.locator("#trace-state").textContent(), "Friction");
  assert.equal(await page.locator("#trace-raw-score").textContent(), "0.4");
  record("B13", "Genuine progress recovers navigation Critical through Friction and presents recovery guidance.");
  await page.locator("details.trace-panel").evaluate((details) => { details.open = true; });
  await page.screenshot({ path: resolve(screenshotDirectory, "07-staged-recovery.png"), fullPage: true });

  await page.locator("#primary-goal").selectOption("Track learning");
  await page.locator("#outcome").fill("Complete each learning milestone clearly.");
  await page.locator("#continue-button").click();
  assert.equal(await page.locator("#state-badge").textContent(), "Standard support");
  assert.equal(await page.locator("#trace-state").textContent(), "Stable");
  record("B14", "A later step-progress event confirms Stable recovery and withdraws additional support.");

  await page.locator('input[name="pace"][value="Guided"]').check();
  await page.locator("#continue-button").click();
  await page.locator("#confirmation").check();
  await page.locator("#continue-button").click();
  assert.equal(await page.locator("#completion-panel").isVisible(), true);
  assert.equal(await page.locator("#trace-rule").textContent(), "Successful completion");
  record("B15", "Successful completion explicitly returns the session to Stable.");
  await page.locator("details.trace-panel").evaluate((details) => { details.open = true; });
  await page.screenshot({ path: resolve(screenshotDirectory, "08-completed-stable.png"), fullPage: true });

  await page.locator("details.developer-panel").evaluate((details) => { details.open = true; });
  await page.locator("#generate-report-button").click();
  assert.equal(await page.locator("#session-report-panel").isVisible(), true);
  const report = await page.evaluate(() => window.__fypPrototype.generateSessionReport());
  assert.equal(report.session.outcome, "completed");
  assert.equal(report.privacy.form_values_included, false);
  assert.equal(JSON.stringify(report).includes("Demo User"), false);
  assert.equal(JSON.stringify(report).includes("demo@example.com"), false);
  assert.equal(await page.locator("#report-events tr").count() > 0, true);
  record("B16", "The accessible post-session report excludes form values and renders the event-decision sequence.");
  await page.screenshot({ path: resolve(screenshotDirectory, "09-session-report.png"), fullPage: true });

  await page.evaluate(async () => {
    window.__fypPrototype.reset();
    for (let index = 0; index < 100; index += 1) {
      window.__fypPrototype.processSyntheticEvent({
        type: index % 8 === 0 ? "input_error" : "step_progress",
        direction: index % 8 === 0 ? "none" : "forward",
        step: (index % 5) + 1,
        destinationStep: ((index + 1) % 5) + 1,
        validationCode: index % 8 === 0 ? `field_${index % 3}:required` : null
      });
      await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    }
  });
  results.ui_metrics = await page.evaluate(() => window.__fypPrototype.getMetrics());
  const durations = results.ui_metrics.map((metric) => metric.first_frame_ms).filter(Number.isFinite);
  const maximumFirstFrame = Math.max(...durations);
  assert.equal(maximumFirstFrame < 100, true);
  record("B17", "One hundred semantic interactions remain below the first-frame target.");

  assert.deepEqual(results.remote_requests, []);
  assert.deepEqual(results.console_errors, []);
  record("B18", "No interaction request leaves the local origin and no console error occurs.");

  const securityResponse = await fetch(baseUrl);
  assert.match(securityResponse.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  const storage = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookies: document.cookie }));
  assert.deepEqual(storage, { local: 0, session: 0, cookies: "" });
  record("B19", "Security headers are present and browser storage remains unused.");

  for (const width of [320, 360, 390, 412, 768]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1024 });
    await page.reload({ waitUntil: "networkidle" });
    const layout = await page.evaluate(() => ({
      noOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      mobileSupportVisible: getComputedStyle(document.querySelector(".mobile-support")).display !== "none",
      traceBelowForm: document.querySelector(".support-card").getBoundingClientRect().top > document.querySelector(".form-card").getBoundingClientRect().top
    }));
    assert.deepEqual(layout, { noOverflow: true, mobileSupportVisible: true, traceBelowForm: true });
  }
  record("B20", "Responsive layouts from 320 to 768 pixels have no horizontal overflow and keep equivalent support near the form.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(screenshotDirectory, "10-mobile-standard-support.png") });

  const keyboardPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await keyboardPage.goto(baseUrl, { waitUntil: "networkidle" });
  await keyboardPage.locator("#full-name").fill("Keyboard User");
  await keyboardPage.locator("#email").fill("keyboard@example.com");
  await keyboardPage.keyboard.press("Tab");
  await keyboardPage.locator("#continue-button").press("Enter");
  await keyboardPage.locator("#role").selectOption("Student");
  await keyboardPage.locator("#continue-button").press("Enter");
  await keyboardPage.locator("#primary-goal").selectOption("Plan a project");
  await keyboardPage.locator("#outcome").fill("Finish the complete workflow using keyboard controls.");
  await keyboardPage.locator("#continue-button").press("Enter");
  await keyboardPage.locator('input[name="pace"][value="Concise"]').check();
  await keyboardPage.locator("#continue-button").press("Enter");
  await keyboardPage.locator("#confirmation").check();
  await keyboardPage.locator("#continue-button").press("Enter");
  assert.equal(await keyboardPage.locator("#completion-panel").isVisible(), true);
  record("B21", "The complete five-stage workflow remains keyboard operable.");
  await keyboardPage.close();

  const rawValue = "private@example.com";
  await page.setViewportSize(results.viewport);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#email").fill(rawValue);
  const snapshot = await page.evaluate(() => window.__fypPrototype.getSnapshot());
  assert.equal(JSON.stringify(snapshot).includes(rawValue), false);
  record("B22", "Semantic events and traces exclude raw form values.");

  const confirmationPage = await browser.newPage({ viewport: results.viewport });
  await confirmationPage.goto(baseUrl, { waitUntil: "networkidle" });
  await confirmationPage.locator("#full-name").fill("Confirmation User");
  await confirmationPage.locator("#email").fill("confirmation@example.com");
  await confirmationPage.locator("#continue-button").click();
  await confirmationPage.locator("#role").selectOption("Designer");
  await confirmationPage.locator("#continue-button").click();
  await confirmationPage.locator("#primary-goal").selectOption("Plan a project");
  await confirmationPage.locator("#outcome").fill("Complete the required confirmation test.");
  await confirmationPage.locator("#continue-button").click();
  for (let index = 0; index < 4; index += 1) {
    await confirmationPage.locator("#continue-button").click();
  }
  await confirmationPage.locator('input[name="pace"][value="Guided"]').check();
  await confirmationPage.locator("#continue-button").click();
  assert.equal(await confirmationPage.locator("#confirmation").getAttribute("required"), "");
  assert.match(await confirmationPage.locator('label[for="confirmation"]').textContent(), /\*/);
  assert.equal(await confirmationPage.locator("#trace-raw-score").textContent(), "0.4");
  await confirmationPage.locator("#confirmation").check();
  assert.equal(await confirmationPage.locator("#trace-raw-score").textContent(), "0.2");
  assert.equal(await confirmationPage.locator("#trace-errors").textContent(), "1");
  await confirmationPage.locator("#confirmation").uncheck();
  await confirmationPage.locator("#confirmation").check();
  assert.equal(await confirmationPage.locator("#trace-raw-score").textContent(), "0.2");
  await confirmationPage.locator("details.trace-panel").evaluate((details) => { details.open = true; });
  await confirmationPage.screenshot({ path: resolve(screenshotDirectory, "11-confirmation-success-recovery.png"), fullPage: true });
  record("B23", "The required confirmation is marked and its first valid check resolves one input-error item without repeat-toggle score farming.");
  await confirmationPage.close();

  const analysisPage = await browser.newPage({ viewport: results.viewport });
  await analysisPage.goto(`${baseUrl}/analysis.html`, { waitUntil: "networkidle" });
  assert.equal(await analysisPage.locator("#report-files").getAttribute("multiple"), "");
  assert.match(await analysisPage.locator(".intro-copy").textContent(), /not uploaded/i);
  assert.equal(await analysisPage.locator('[aria-live="polite"]').count(), 1);
  const reportOne = await page.evaluate(() => window.__fypPrototype.generateSessionReport());
  const reportTwo = structuredClone(reportOne);
  reportTwo.session.session_id = "controlled_second_session";
  reportTwo.session.outcome = "incomplete";
  await analysisPage.locator("#report-files").setInputFiles([
    { name: "session-one.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(reportOne)) },
    { name: "session-two.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(reportTwo)) }
  ]);
  await analysisPage.locator("#aggregate-panel").waitFor({ state: "visible" });
  assert.match(await analysisPage.locator("#import-status").textContent(), /2 valid reports imported/i);
  assert.equal(await analysisPage.locator("#aggregate-summary dd").first().textContent(), "2");
  record("B24", "The local aggregate analyser validates and combines multiple reports without network upload.");
  await analysisPage.screenshot({ path: resolve(screenshotDirectory, "12-local-aggregate-analysis.png"), fullPage: true });
  await analysisPage.close();

  await page.reload({ waitUntil: "networkidle" });
  await page.getByLabel("Full name").fill("Example Tester");
  await page.getByLabel("Email address").fill("tester@example.com");
  const continueButton = page.getByRole("button", { name: "Save and continue" });
  await continueButton.click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByLabel("Email address").fill("not-an-email");
  for (let i = 0; i < 5; i += 1) await continueButton.click();
  assert.equal(await page.locator("#trace-state").textContent(), "Critical");
  assert.equal(await page.locator("#trace-raw-score").textContent(), "1.0");
  await page.getByLabel("Email address").fill("tester@example.com");
  assert.equal(await page.locator("#trace-raw-score").textContent(), "0.8");
  assert.equal(await page.locator("#email-error").textContent(), "");
  assert.equal(await page.locator("#error-summary").isHidden(), true);
  assert.doesNotMatch(await page.locator("#support-message-text").textContent(), /highlighted/i);
  await continueButton.click();
  assert.equal(await page.locator('[data-step-panel="2"]').isVisible(), true);
  assert.equal(await page.locator('#role[aria-invalid="true"]').count(), 0);
  assert.equal(await page.locator("#trace-state").textContent(), "Critical");
  assert.equal(await page.locator("#trace-raw-score").textContent(), "1.0");
  assert.equal(await page.locator("#error-summary").isHidden(), true);
  await page.locator("#support-help-toggle").click();
  const routeHelp = await page.locator("#support-help-steps").textContent();
  assert.match(routeHelp, /current position/i);
  assert.doesNotMatch(routeHelp, /highlighted|error message|correct that field/i);
  record("B25", "Corrected Account errors do not produce misleading field guidance after returning to Profile.");
  await page.context().tracing.stop();

  results.summary = {
    passed: results.cases.length,
    failed: 0,
    maximum_first_frame_ms: Number(maximumFirstFrame.toFixed(3))
  };
  await writeFile(resultsPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(results.summary, null, 2));
} catch (error) {
  results.cases.push({ id: "ERROR", description: error.message, status: "fail" });
  if (page) {
    await page.screenshot({ path: resolve(screenshotDirectory, "failure.png"), fullPage: true }).catch(() => {});
    await page.context().tracing.stop({ path: resolve(dirname(resultsPath), "browser-failure-trace.zip") }).catch(() => {});
  }
  await mkdir(dirname(resultsPath), { recursive: true });
  await writeFile(resultsPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
