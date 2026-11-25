import { mkdir, writeFile } from "node:fs/promises";
import { ONBOARDING_STEPS } from "../src/onboarding-config.js";
import { OnboardingMonitor } from "../src/onboarding-monitor.js";
import { selectResponse } from "../src/response-controller.js";
import { createSessionReport } from "../src/session-report.js";

const timestamp = "2026-01-01T00:00:00.000Z";
const directory = new URL("../evidence/examples/", import.meta.url);
await mkdir(directory, { recursive: true });

for (const [name, failures] of [["example-a", 3], ["example-b", 2]]) {
  let nextId = 0;
  const monitor = new OnboardingMonitor({
    steps: ONBOARDING_STEPS,
    engineOptions: { now: () => timestamp, idFactory: () => `${name}-${nextId++}` }
  });
  const decisions = [];
  for (let i = 0; i < failures; i += 1) {
    const trace = monitor.reportValidationError({ step: 1, validationCode: "email:format" });
    decisions.push({
      ...trace,
      response: selectResponse(trace, { validationMessage: "Use a valid email format." })
    });
  }
  const report = createSessionReport({
    session: monitor.engine.session,
    steps: ONBOARDING_STEPS,
    generatedAt: timestamp,
    decisions
  });
  await writeFile(new URL(`${name}.json`, directory), JSON.stringify(report, null, 2) + "\n");
}
console.log("Wrote two synthetic reports to evidence/examples/.");
