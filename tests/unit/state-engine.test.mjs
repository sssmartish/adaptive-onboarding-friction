import test from "node:test";
import assert from "node:assert/strict";

import {
  CRITICAL_THRESHOLD,
  EVENT_TYPES,
  FRICTION_THRESHOLD,
  STATES,
  StateEngine,
  WINDOW_SIZE,
  analyseWindow,
  classifyWindow
} from "../../src/state-engine.js";

let eventNumber = 0;
function event(engine, type, options = {}) {
  eventNumber += 1;
  return {
    event_id: `event_${eventNumber}`,
    session_id: engine.session.session_id,
    type,
    step: options.step ?? 1,
    destination_step: options.destinationStep ?? null,
    direction: options.direction ?? "none",
    timestamp: `2026-08-12T00:00:${String(eventNumber).padStart(2, "0")}.000Z`,
    validation_code: options.validationCode ?? null
  };
}

const inputError = (engine, code, step = 1) =>
  event(engine, EVENT_TYPES.INPUT_ERROR, { validationCode: code, step });
const fieldValid = (engine, code, step = 1) =>
  event(engine, EVENT_TYPES.FIELD_VALID, { validationCode: code, step });
const progress = (engine, step) =>
  event(engine, EVENT_TYPES.STEP_PROGRESS, { direction: "forward", step, destinationStep: step + 1 });
const navigation = (engine, fromStep, toStep) =>
  event(engine, EVENT_TYPES.NAVIGATION_MOVE, {
    step: fromStep,
    destinationStep: toStep,
    direction: toStep > fromStep ? "forward" : "backward"
  });

function assertScoreStateAlignment(trace) {
  if (trace.accepted_state === STATES.STABLE) assert.equal(trace.effective_score < FRICTION_THRESHOLD, true);
  if (trace.accepted_state === STATES.FRICTION) {
    assert.equal(trace.effective_score >= FRICTION_THRESHOLD && trace.effective_score < CRITICAL_THRESHOLD, true);
  }
  if (trace.accepted_state === STATES.CRITICAL) assert.equal(trace.effective_score >= CRITICAL_THRESHOLD, true);
}

test("one input error uses the fixed denominator and remains Stable", () => {
  const engine = new StateEngine();
  const trace = engine.process(inputError(engine, "email:required"));
  assert.equal(WINDOW_SIZE, 5);
  assert.equal(trace.raw_score, 0.2);
  assert.equal(trace.accepted_state, STATES.STABLE);
});

test("one Back movement is neutral and is not navigation-loop evidence", () => {
  const engine = new StateEngine();
  const trace = engine.process(navigation(engine, 2, 1));
  assert.equal(trace.loop_detected, false);
  assert.equal(trace.L, 0);
  assert.equal(trace.raw_score, 0);
  assert.equal(trace.ordinary_navigation_neutral, true);
});

test("returning to the starting step without progress creates one loop episode", () => {
  const engine = new StateEngine();
  engine.process(navigation(engine, 2, 1));
  const trace = engine.process(navigation(engine, 1, 2));
  assert.equal(trace.loop_detected, true);
  assert.equal(trace.L, 1);
  assert.equal(trace.raw_score, 0.2);
});

test("three loop episodes activate an aligned Critical override", () => {
  const engine = new StateEngine();
  let trace;
  for (let index = 0; index < 3; index += 1) {
    engine.process(navigation(engine, 2, 1));
    trace = engine.process(navigation(engine, 1, 2));
  }
  assert.equal(trace.L, 3);
  assert.equal(trace.raw_score, 0.6);
  assert.equal(trace.effective_score, 0.8);
  assert.equal(trace.score_adjustment, 0.2);
  assert.equal(trace.navigation_override, true);
  assert.equal(trace.matched_rule, "Repeated navigation-loop override");
});

test("a direct multi-step return is one loop episode, not several movements", () => {
  const engine = new StateEngine();
  engine.process(navigation(engine, 4, 3));
  engine.process(navigation(engine, 3, 2));
  const trace = engine.process(navigation(engine, 2, 4));
  assert.equal(trace.loop_detected, true);
  assert.equal(trace.L, 1);
});

test("genuine step progress starts a new loop-detection route", () => {
  const engine = new StateEngine();
  engine.process(navigation(engine, 2, 1));
  engine.process(progress(engine, 2));
  const trace = engine.process(navigation(engine, 3, 2));
  assert.equal(trace.loop_detected, false);
  assert.equal(trace.navigation_override, false);
});

test("score boundaries still classify two and four adverse items", () => {
  const engine = new StateEngine();
  engine.process(inputError(engine, "a:required", 1));
  const friction = engine.process(inputError(engine, "b:required", 2));
  engine.process(inputError(engine, "c:required", 3));
  const critical = engine.process(inputError(engine, "d:required", 4));
  assert.equal(friction.accepted_state, STATES.FRICTION);
  assert.equal(critical.accepted_state, STATES.CRITICAL);
});

test("three matching input errors apply the explicit score adjustment", () => {
  const engine = new StateEngine();
  engine.process(inputError(engine, "email:format"));
  engine.process(inputError(engine, "email:format"));
  const trace = engine.process(inputError(engine, "email:format"));
  assert.equal(trace.raw_score, 0.6);
  assert.equal(trace.effective_score, 0.8);
  assert.equal(trace.score_adjusted, true);
  assert.equal(trace.score_adjustment, 0.2);
});

test("ordinary threshold decisions have no score adjustment", () => {
  const engine = new StateEngine();
  engine.process(inputError(engine, "a:required"));
  const trace = engine.process(inputError(engine, "b:required"));
  assert.equal(trace.raw_score, trace.effective_score);
  assert.equal(trace.score_adjusted, false);
  assert.equal(trace.score_adjustment, 0);
});

test("different validation targets do not activate the repeated-error override", () => {
  const engine = new StateEngine();
  engine.process(inputError(engine, "name:required"));
  engine.process(inputError(engine, "email:required"));
  const trace = engine.process(inputError(engine, "email:format"));
  assert.equal(trace.input_override, false);
});

test("field-valid resolves matching input evidence but not loop evidence", () => {
  const engine = new StateEngine();
  engine.process(inputError(engine, "role:required", 2));
  engine.process(navigation(engine, 2, 1));
  engine.process(navigation(engine, 1, 2));
  const trace = engine.process(fieldValid(engine, "role:required", 2));
  assert.equal(trace.E, 0);
  assert.equal(trace.L, 1);
  assert.equal(trace.evidence_resolved, 1);
});

test("a field's first successful validation can resolve one unresolved input error", () => {
  const engine = new StateEngine();
  engine.process(inputError(engine, "email:format", 1));
  const trace = engine.process(fieldValid(engine, "name:required", 1));
  assert.equal(trace.E, 0);
  assert.equal(trace.evidence_resolved, 1);
  assert.equal(trace.first_field_success, true);
});

test("repeated success for the same field cannot clear unrelated input evidence", () => {
  const engine = new StateEngine();
  engine.process(inputError(engine, "email:format", 1));
  engine.process(fieldValid(engine, "name:valid", 1));
  engine.process(inputError(engine, "role:required", 2));
  const trace = engine.process(fieldValid(engine, "name:valid", 1));
  assert.equal(trace.E, 1);
  assert.equal(trace.evidence_resolved, 0);
  assert.equal(trace.duplicate_field_success_ignored, true);
});

test("field correction and step progress provide staged recovery", () => {
  const engine = new StateEngine();
  engine.process(inputError(engine, "role:required", 2));
  engine.process(inputError(engine, "role:required", 2));
  engine.process(inputError(engine, "role:required", 2));
  const friction = engine.process(fieldValid(engine, "role:required", 2));
  const stable = engine.process(progress(engine, 2));
  assert.equal(friction.accepted_state, STATES.FRICTION);
  assert.equal(friction.effective_score, 0.4);
  assert.equal(stable.accepted_state, STATES.STABLE);
  assert.equal(stable.effective_score, 0.2);
});

test("progress recovers a navigation Critical state gradually", () => {
  const engine = new StateEngine();
  for (let index = 0; index < 3; index += 1) {
    engine.process(navigation(engine, 2, 1));
    engine.process(navigation(engine, 1, 2));
  }
  const friction = engine.process(progress(engine, 2));
  const stable = engine.process(progress(engine, 3));
  assert.equal(friction.accepted_state, STATES.FRICTION);
  assert.equal(friction.L, 2);
  assert.equal(stable.accepted_state, STATES.STABLE);
  assert.equal(stable.L, 1);
});

test("the audit window retains only the five most recent semantic events", () => {
  const engine = new StateEngine();
  for (let step = 1; step <= 7; step += 1) engine.process(progress(engine, step));
  assert.deepEqual(engine.window.map((item) => item.step), [3, 4, 5, 6, 7]);
});

test("successful completion clears evidence and returns explicitly to Stable", () => {
  const engine = new StateEngine();
  engine.process(inputError(engine, "confirmation:required", 5));
  const completion = event(engine, EVENT_TYPES.COMPLETION, { step: 5 });
  const trace = engine.process(completion, { terminal: true });
  assert.equal(trace.accepted_state, STATES.STABLE);
  assert.equal(trace.effective_score, 0);
  assert.equal(trace.matched_rule, "Successful completion");
});

test("every accepted state aligns with the effective decision score", () => {
  const engine = new StateEngine();
  const traces = [
    engine.process(inputError(engine, "a:required")),
    engine.process(inputError(engine, "b:required")),
    engine.process(inputError(engine, "c:required")),
    engine.process(inputError(engine, "d:required")),
    engine.process(progress(engine, 1)),
    engine.process(progress(engine, 2))
  ];
  traces.forEach(assertScoreStateAlignment);
});

test("reset clears histories, routes and evidence", () => {
  const engine = new StateEngine();
  engine.process(navigation(engine, 2, 1));
  engine.process(inputError(engine, "name:required"));
  const snapshot = engine.reset();
  assert.equal(snapshot.window.length, 0);
  assert.equal(snapshot.evidence.length, 0);
  assert.equal(snapshot.navigationAnchor, null);
  assert.deepEqual(snapshot.creditedFieldSuccesses, []);
  assert.equal(snapshot.session.current_state, STATES.STABLE);
});

test("classification is deterministic for equivalent analysed evidence", () => {
  const events = [
    { type: EVENT_TYPES.INPUT_ERROR, step: 1, validation_code: "a", direction: "none" },
    { type: EVENT_TYPES.NAVIGATION_LOOP, step: 2, validation_code: null, direction: "none" }
  ];
  assert.deepEqual(classifyWindow(analyseWindow(structuredClone(events))), classifyWindow(analyseWindow(events)));
});
