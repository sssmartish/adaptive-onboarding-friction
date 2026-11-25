import test from "node:test";
import assert from "node:assert/strict";

import { EVENT_TYPES, STATES, createInteractionEvent } from "../../src/state-engine.js";
import { OnboardingMonitor } from "../../src/onboarding-monitor.js";
import { identifySignal, selectResponse } from "../../src/response-controller.js";
import {
  aggregateSessionReports,
  createSessionReport,
  validateSessionReport
} from "../../src/session-report.js";

test("Friction input evidence adds workflow guidance without repeating the field error", () => {
  const trace = { accepted_state: STATES.FRICTION, E: 2, L: 0, event: { type: EVENT_TYPES.INPUT_ERROR } };
  const response = selectResponse(trace, {
    fieldLabel: "Email address",
    validationMessage: "Use a valid email format."
  });
  assert.equal(identifySignal(trace), "input");
  assert.equal(response.level, "Additional guidance");
  assert.match(response.message, /blocked progress more than once/i);
  assert.doesNotMatch(response.message, /Email address|valid email format/i);
  assert.equal(response.announce, true);
});

test("Critical input evidence produces focused, reversible help and an error summary", () => {
  const response = selectResponse(
    { accepted_state: STATES.CRITICAL, E: 3, L: 0, event: { type: EVENT_TYPES.INPUT_ERROR } },
    { fieldLabel: "Full name", validationMessage: "Enter your full name." }
  );
  assert.equal(response.showErrorSummary, true);
  assert.equal(response.offerDetailedHelp, true);
  assert.equal(response.level, "Focused guidance");
  assert.doesNotMatch(response.message, /Enter your full name/i);
});

test("navigation-loop support explains the repeated route rather than a Back click", () => {
  const response = selectResponse(
    { accepted_state: STATES.FRICTION, E: 0, L: 2, loop_detected: true, event: { type: EVENT_TYPES.NAVIGATION_MOVE } },
    { stepName: "Step 2 of 5: Profile" }
  );
  assert.match(response.title, /repeated route/i);
  assert.match(response.message, /route's starting point/i);
});

test("a Critical navigation override selects route help even when older input evidence remains", () => {
  const trace = {
    accepted_state: STATES.CRITICAL,
    E: 1,
    L: 3,
    loop_detected: true,
    matched_rule: "Repeated navigation-loop override",
    event: { type: EVENT_TYPES.NAVIGATION_MOVE }
  };
  const response = selectResponse(trace, { stepName: "Step 3 of 5: Goals" });

  assert.equal(identifySignal(trace), "navigation");
  assert.equal(response.code, "critical_navigation");
  assert.equal(response.showErrorSummary, false);
  assert.match(response.message, /same route/i);
  assert.match(response.helpSteps.join(" "), /current position|required action/i);
  assert.doesNotMatch(response.helpSteps.join(" "), /highlighted|error message|correct that field/i);
});

test("returning to Profile after correcting Account offers route help without inventing a field error", () => {
  const monitor = new OnboardingMonitor({ steps: [{ id: 1 }, { id: 2 }] });
  monitor.reportFieldValid({ step: 1, validationCode: "email:valid" });
  monitor.reportStepProgress({ step: 1 });
  monitor.reportNavigation({ fromStep: 2, toStep: 1 });
  for (let i = 0; i < 5; i += 1) {
    monitor.reportValidationError({ step: 1, validationCode: "email:format" });
  }
  const corrected = monitor.reportFieldValid({ step: 1, validationCode: "email:format" });
  assert.equal(corrected.raw_score, 0.8);
  const trace = monitor.reportNavigation({ fromStep: 1, toStep: 2 });
  const guidance = selectResponse(trace, { stepName: "Step 2 of 5: Profile" });

  assert.equal(trace.raw_score, 1);
  assert.equal(trace.accepted_state, STATES.CRITICAL);
  assert.equal(identifySignal(trace), "mixed");
  assert.equal(guidance.code, "critical_navigation");
  assert.equal(guidance.showErrorSummary, false);
  assert.doesNotMatch([guidance.message, guidance.announcement, ...guidance.helpSteps].join(" "), /highlighted|error message|blocking field/i);
});

test("historical evidence without a current blocker or a new loop falls back to standard support", () => {
  for (const accepted_state of Object.values(STATES)) {
    const response = selectResponse({
      accepted_state,
      E: 3,
      L: 1,
      loop_detected: false,
      event: { type: EVENT_TYPES.NAVIGATION_MOVE }
    });
    assert.equal(response.code, "stable_default");
    assert.equal(response.announce, false);
    assert.equal(response.offerDetailedHelp, false);
    assert.equal(response.showErrorSummary, false);
  }
});

test("field-valid interactions are identified as recovery progress", () => {
  const trace = {
    accepted_state: STATES.FRICTION,
    E: 1,
    L: 0,
    event: { type: EVENT_TYPES.FIELD_VALID },
    recovery_status: "Recovery recorded."
  };
  assert.equal(identifySignal(trace), "progress");
  assert.match(selectResponse(trace).title, /recovering/);
});

test("interaction events exclude raw field values", () => {
  const interaction = createInteractionEvent(
    {
      sessionId: "session_test",
      type: EVENT_TYPES.FIELD_VALID,
      step: 1,
      validationCode: "email:format",
      rawValue: "private@example.com"
    },
    { idFactory: () => "event_test", now: () => "2026-08-12T00:00:00.000Z" }
  );
  assert.deepEqual(Object.keys(interaction).sort(), [
    "destination_step",
    "direction",
    "event_id",
    "session_id",
    "step",
    "timestamp",
    "type",
    "validation_code"
  ]);
  assert.equal(JSON.stringify(interaction).includes("private@example.com"), false);
});

test("the reusable monitor works with a different three-step onboarding configuration", () => {
  const monitor = new OnboardingMonitor({
    steps: [
      { id: 1, title: "Identity" },
      { id: 2, title: "Plan" },
      { id: 3, title: "Confirm" }
    ]
  });
  monitor.reportValidationError({ step: 1, validationCode: "identity:required" });
  const resolved = monitor.reportFieldValid({ step: 1, validationCode: "identity:required" });
  monitor.reportStepProgress({ step: 1, destinationStep: 2 });
  assert.equal(resolved.evidence_resolved, 1);
  assert.equal(monitor.snapshot().session.max_completed_step, 1);
});

test("the reusable monitor derives movement direction and loop evidence", () => {
  const monitor = new OnboardingMonitor({ steps: [{ id: 1 }, { id: 2 }] });
  const back = monitor.reportNavigation({ fromStep: 2, toStep: 1 });
  const returnMove = monitor.reportNavigation({ fromStep: 1, toStep: 2 });
  assert.equal(back.event.direction, "backward");
  assert.equal(back.L, 0);
  assert.equal(returnMove.loop_detected, true);
  assert.equal(returnMove.L, 1);
});

test("invalid reusable configurations are rejected deterministically", () => {
  assert.throws(() => new OnboardingMonitor({ steps: [{ id: 1 }] }), /at least two/);
  assert.throws(() => new OnboardingMonitor({ steps: [{ id: 1 }, { id: 1 }] }), /unique integer/);
});

function reportFixture({ id = "session_one", state = STATES.FRICTION, completed = false } = {}) {
  const event = createInteractionEvent(
    {
      sessionId: id,
      type: EVENT_TYPES.INPUT_ERROR,
      step: 2,
      validationCode: "role:required"
    },
    { idFactory: () => `${id}_event`, now: () => "2026-08-12T12:00:00.000Z" }
  );
  return createSessionReport({
    session: {
      session_id: id,
      start_time: "2026-08-12T11:59:00.000Z",
      end_time: completed ? "2026-08-12T12:01:00.000Z" : null
    },
    steps: [{ id: 1, short: "Account", title: "Account" }, { id: 2, short: "Profile", title: "Profile" }],
    outcome: completed ? "completed" : "incomplete",
    generatedAt: "2026-08-12T12:02:00.000Z",
    decisions: [{
      event,
      previous_state: STATES.STABLE,
      accepted_state: state,
      raw_score: 0.4,
      effective_score: state === STATES.CRITICAL ? 0.8 : 0.4,
      matched_rule: "Fixture rule",
      evidence_resolved: 0,
      recovery_status: "New adverse evidence recorded.",
      loop_detected: false,
      response: { code: "friction_input", level: "Additional guidance" }
    }]
  });
}

test("session reports contain semantic evidence and exclude form values", () => {
  const report = reportFixture();
  assert.equal(validateSessionReport(report).valid, true);
  assert.equal(report.privacy.form_values_included, false);
  assert.equal(report.events[0].validation_code, "role:required");
  assert.equal(JSON.stringify(report).includes("private@example.com"), false);
});

test("report validation rejects a prohibited raw value field", () => {
  const report = reportFixture();
  report.events[0].raw_value = "private@example.com";
  assert.equal(validateSessionReport(report).valid, false);
});

test("multiple local reports aggregate completion, state and step evidence", () => {
  const aggregate = aggregateSessionReports([
    reportFixture({ id: "one" }),
    reportFixture({ id: "two", state: STATES.CRITICAL, completed: true })
  ]);
  assert.equal(aggregate.sessions_analysed, 2);
  assert.equal(aggregate.completed_sessions, 1);
  assert.equal(aggregate.maximum_state_distribution.Friction, 1);
  assert.equal(aggregate.maximum_state_distribution.Critical, 1);
  assert.equal(aggregate.input_errors_by_step["Step 2"], 2);
});
