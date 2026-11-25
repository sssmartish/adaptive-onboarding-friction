import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EVENT_TYPES, STATES, StateEngine } from "../../src/state-engine.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(root, "evidence/results/scenario-matrix.json");
let eventId = 0;

function event(engine, type, options = {}) {
  eventId += 1;
  return {
    event_id: `scenario_event_${eventId}`,
    session_id: engine.session.session_id,
    type,
    step: options.step ?? 1,
    destination_step: options.destinationStep ?? null,
    direction: options.direction ?? "none",
    timestamp: "2026-08-12T00:00:00.000Z",
    validation_code: options.code ?? null
  };
}

const error = (engine, code, step = 1) => event(engine, EVENT_TYPES.INPUT_ERROR, { code, step });
const valid = (engine, code, step = 1) => event(engine, EVENT_TYPES.FIELD_VALID, { code, step });
const progress = (engine, step) => event(engine, EVENT_TYPES.STEP_PROGRESS, { step, destinationStep: step + 1, direction: "forward" });
const move = (engine, fromStep, toStep) => event(engine, EVENT_TYPES.NAVIGATION_MOVE, {
  step: fromStep,
  destinationStep: toStep,
  direction: toStep > fromStep ? "forward" : "backward"
});

function loop(engine, step = 2) {
  engine.process(move(engine, step, step - 1));
  return engine.process(move(engine, step - 1, step));
}

function definition(id, description, expectedState, expectedRaw, expectedEffective, run, expectedRule = null) {
  return { id, description, expectedState, expectedRaw, expectedEffective, expectedRule, run };
}

const definitions = [
  definition("S01", "No adverse evidence", STATES.STABLE, 0, 0, () => ({ engine: new StateEngine() })),
  definition("S02", "One Back movement is neutral", STATES.STABLE, 0, 0, () => {
    const engine = new StateEngine();
    return { engine, trace: engine.process(move(engine, 2, 1)) };
  }),
  definition("S03", "One completed navigation loop", STATES.STABLE, 0.2, 0.2, () => {
    const engine = new StateEngine();
    return { engine, trace: loop(engine) };
  }),
  definition("S04", "Two navigation loops reach Friction", STATES.FRICTION, 0.4, 0.4, () => {
    const engine = new StateEngine();
    loop(engine);
    return { engine, trace: loop(engine) };
  }),
  definition("S05", "Three navigation loops activate the Critical override", STATES.CRITICAL, 0.6, 0.8, () => {
    const engine = new StateEngine();
    loop(engine);
    loop(engine);
    return { engine, trace: loop(engine) };
  }, "Repeated navigation-loop override"),
  definition("S06", "One input error", STATES.STABLE, 0.2, 0.2, () => {
    const engine = new StateEngine();
    return { engine, trace: engine.process(error(engine, "name:required")) };
  }),
  definition("S07", "Two different input errors", STATES.FRICTION, 0.4, 0.4, () => {
    const engine = new StateEngine();
    engine.process(error(engine, "name:required"));
    return { engine, trace: engine.process(error(engine, "email:required")) };
  }),
  definition("S08", "Three matching input errors activate the Critical override", STATES.CRITICAL, 0.6, 0.8, () => {
    const engine = new StateEngine();
    engine.process(error(engine, "email:format"));
    engine.process(error(engine, "email:format"));
    return { engine, trace: engine.process(error(engine, "email:format")) };
  }, "Repeated input-failure override"),
  definition("S09", "Four adverse evidence items reach Critical", STATES.CRITICAL, 0.8, 0.8, () => {
    const engine = new StateEngine();
    [1, 2, 3, 4].forEach((step) => engine.process(error(engine, `field_${step}:required`, step)));
    return { engine, trace: engine.lastTrace };
  }),
  definition("S10", "One input error and one loop form mixed Friction", STATES.FRICTION, 0.4, 0.4, () => {
    const engine = new StateEngine();
    engine.process(error(engine, "name:required"));
    return { engine, trace: loop(engine) };
  }),
  definition("S11", "Matching field-valid resolves only its input evidence", STATES.STABLE, 0, 0, () => {
    const engine = new StateEngine();
    engine.process(error(engine, "role:required", 2));
    return { engine, trace: engine.process(valid(engine, "role:required", 2)) };
  }),
  definition("S12", "Field-valid leaves unrelated loop evidence", STATES.STABLE, 0.2, 0.2, () => {
    const engine = new StateEngine();
    loop(engine);
    return { engine, trace: engine.process(valid(engine, "role:required", 2)) };
  }),
  definition("S13", "Field correction recovers three-error Critical to Friction", STATES.FRICTION, 0.4, 0.4, () => {
    const engine = new StateEngine();
    engine.process(error(engine, "role:required", 2));
    engine.process(error(engine, "role:required", 2));
    engine.process(error(engine, "role:required", 2));
    return { engine, trace: engine.process(valid(engine, "role:required", 2)) };
  }),
  definition("S14", "Later step progress completes recovery to Stable", STATES.STABLE, 0.2, 0.2, () => {
    const engine = new StateEngine();
    engine.process(error(engine, "role:required", 2));
    engine.process(error(engine, "role:required", 2));
    engine.process(error(engine, "role:required", 2));
    engine.process(valid(engine, "role:required", 2));
    return { engine, trace: engine.process(progress(engine, 2)) };
  }),
  definition("S15", "Progress recovers navigation Critical to Friction", STATES.FRICTION, 0.4, 0.4, () => {
    const engine = new StateEngine();
    loop(engine); loop(engine); loop(engine);
    return { engine, trace: engine.process(progress(engine, 2)) };
  }),
  definition("S16", "Second progress recovers remaining loop evidence to Stable", STATES.STABLE, 0.2, 0.2, () => {
    const engine = new StateEngine();
    loop(engine); loop(engine); loop(engine);
    engine.process(progress(engine, 2));
    return { engine, trace: engine.process(progress(engine, 3)) };
  }),
  definition("S17", "New input error interrupts recovery", STATES.FRICTION, 0.6, 0.6, () => {
    const engine = new StateEngine();
    engine.process(error(engine, "email:format"));
    engine.process(error(engine, "email:format"));
    engine.process(error(engine, "email:format"));
    engine.process(valid(engine, "email:format"));
    return { engine, trace: engine.process(error(engine, "name:required")) };
  }),
  definition("S18", "Successful terminal completion returns Stable", STATES.STABLE, 0, 0, () => {
    const engine = new StateEngine();
    engine.process(error(engine, "confirmation:required", 5));
    const completion = event(engine, EVENT_TYPES.COMPLETION, { step: 5 });
    return { engine, trace: engine.process(completion, { terminal: true }) };
  }, "Successful completion"),
  definition("S19", "Reset clears a Critical session", STATES.STABLE, 0, 0, () => {
    const engine = new StateEngine();
    [1, 2, 3, 4].forEach((step) => engine.process(error(engine, `field_${step}:required`, step)));
    engine.reset();
    return { engine };
  }),
  definition("S20", "First successful required field resolves one unresolved input error", STATES.STABLE, 0, 0, () => {
    const engine = new StateEngine();
    engine.process(error(engine, "email:format", 1));
    return { engine, trace: engine.process(valid(engine, "confirmation:valid", 5)) };
  }),
  definition("S21", "Repeated success cannot be farmed to clear another input error", STATES.STABLE, 0.2, 0.2, () => {
    const engine = new StateEngine();
    engine.process(error(engine, "email:format", 1));
    engine.process(valid(engine, "confirmation:valid", 5));
    engine.process(error(engine, "role:required", 2));
    return { engine, trace: engine.process(valid(engine, "confirmation:valid", 5)) };
  })
];

const scenarios = definitions.map((item) => {
  const { engine, trace } = item.run();
  const actualState = trace?.accepted_state ?? engine.session.current_state;
  const actualRaw = trace?.raw_score ?? 0;
  const actualEffective = trace?.effective_score ?? 0;
  const actualRule = trace?.matched_rule ?? "Stable score range";
  const passed = actualState === item.expectedState && actualRaw === item.expectedRaw &&
    actualEffective === item.expectedEffective && (item.expectedRule === null || actualRule === item.expectedRule);
  return {
    id: item.id,
    description: item.description,
    expected_state: item.expectedState,
    expected_raw_score: item.expectedRaw,
    expected_effective_score: item.expectedEffective,
    expected_rule: item.expectedRule,
    actual_state: actualState,
    actual_raw_score: actualRaw,
    actual_effective_score: actualEffective,
    actual_rule: actualRule,
    status: passed ? "pass" : "fail"
  };
});

const passed = scenarios.filter((scenario) => scenario.status === "pass").length;
const result = {
  recorded_at: new Date().toISOString(),
  scoring_definition: {
    navigation_loop: "A return to the navigation route's starting step without intervening step progress.",
    raw_score: "Unresolved input-error and confirmed navigation-loop evidence divided by five.",
    effective_score: "Raw score with a 0.8 floor only while a Critical override is active.",
    recovery: "A required field's first successful validation resolves one unresolved input error, prioritising matching evidence; repeated success cannot be farmed, field-valid never clears loop evidence, and genuine step progress resolves one relevant item."
  },
  scenarios,
  summary: {
    total: scenarios.length,
    passed,
    failed: scenarios.length - passed,
    oracle_accuracy_percent: Number(((passed / scenarios.length) * 100).toFixed(1))
  }
};

assert.equal(result.summary.failed, 0);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result.summary, null, 2));
