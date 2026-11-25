import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EVENT_TYPES, StateEngine } from "../../src/state-engine.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(root, "evidence/results/performance-state-engine.json");
const engine = new StateEngine({ idFactory: () => "performance_session" });
const durations = [];
const iterations = 10000;

for (let index = 0; index < iterations; index += 1) {
  const type = index % 6 === 0 ? EVENT_TYPES.INPUT_ERROR : EVENT_TYPES.STEP_PROGRESS;
  const event = {
    event_id: `performance_event_${index}`,
    session_id: engine.session.session_id,
    type,
    step: (index % 5) + 1,
    destination_step: type === EVENT_TYPES.STEP_PROGRESS ? ((index + 1) % 5) + 1 : null,
    direction: type === EVENT_TYPES.STEP_PROGRESS ? "forward" : "none",
    timestamp: "2026-08-12T00:00:00.000Z",
    validation_code: type === EVENT_TYPES.INPUT_ERROR ? `field_${index % 4}:required` : null
  };

  const start = performance.now();
  engine.process(event);
  durations.push(performance.now() - start);
}

durations.sort((a, b) => a - b);
const percentile = (fraction) => durations[Math.min(durations.length - 1, Math.floor(durations.length * fraction))];
const result = {
  recorded_at: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch
  },
  iterations,
  window_capacity: 5,
  timing_unit: "milliseconds",
  minimum_ms: Number(durations[0].toFixed(6)),
  median_ms: Number(percentile(0.5).toFixed(6)),
  p95_ms: Number(percentile(0.95).toFixed(6)),
  p99_ms: Number(percentile(0.99).toFixed(6)),
  maximum_ms: Number(durations.at(-1).toFixed(6)),
  target_ms: 100,
  target_met: durations.at(-1) < 100
};

assert.equal(engine.window.length, 5);
assert.equal(result.target_met, true);

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
