import { EVENT_TYPES, STATES } from "./state-engine.js";

export const REPORT_SCHEMA = "pathfinder-session-report";
export const REPORT_VERSION = 1;

const STATE_RANK = Object.freeze({ [STATES.STABLE]: 0, [STATES.FRICTION]: 1, [STATES.CRITICAL]: 2 });

function countBy(items, keyFactory) {
  const counts = {};
  items.forEach((item) => {
    const key = keyFactory(item);
    if (key) counts[key] = (counts[key] ?? 0) + 1;
  });
  return counts;
}

function highestState(decisions) {
  return decisions.reduce(
    (highest, item) => (STATE_RANK[item.accepted_state] > STATE_RANK[highest] ? item.accepted_state : highest),
    STATES.STABLE
  );
}

function cleanDecision(item, sequence) {
  const event = item.event;
  return {
    sequence,
    event_id: event.event_id,
    type: event.type,
    step: event.step,
    destination_step: event.destination_step,
    direction: event.direction,
    timestamp: event.timestamp,
    validation_code: event.validation_code,
    loop_detected: Boolean(item.loop_detected),
    loop_route: Array.isArray(item.loop_route) ? item.loop_route.map(Number) : null,
    previous_state: item.previous_state,
    accepted_state: item.accepted_state,
    evidence_score: Number(item.raw_score),
    decision_score: Number(item.effective_score),
    matched_rule: item.matched_rule,
    evidence_resolved: Number(item.evidence_resolved ?? 0),
    recovery_status: item.recovery_status,
    assistance_code: item.response?.code ?? "not_recorded",
    assistance_level: item.response?.level ?? "Not recorded"
  };
}

export function createSessionReport({ session, decisions, steps, outcome = "incomplete", generatedAt } = {}) {
  if (!session?.session_id || !Array.isArray(decisions) || !Array.isArray(steps)) {
    throw new TypeError("A session, decision history and ordered steps are required.");
  }
  const events = decisions.map((item, index) => cleanDecision(item, index + 1));
  const inputErrors = events.filter((item) => item.type === EVENT_TYPES.INPUT_ERROR);
  const loops = events.filter((item) => item.loop_detected);
  const recoveries = events.filter((item) => item.evidence_resolved > 0);
  const adaptiveActivations = events.filter((item) =>
    ["Additional guidance", "Focused guidance", "Recovering"].includes(item.assistance_level)
  );
  const finalState = events.at(-1)?.accepted_state ?? STATES.STABLE;
  const generated = generatedAt ?? new Date().toISOString();
  const furthestStep = Math.max(1, ...events.flatMap((item) => [item.step, item.destination_step ?? 0]));

  return {
    schema: REPORT_SCHEMA,
    version: REPORT_VERSION,
    generated_at: generated,
    privacy: {
      form_values_included: false,
      direct_identifiers_included: false,
      storage: "local-file-export"
    },
    session: {
      session_id: session.session_id,
      start_time: session.start_time,
      end_time: session.end_time ?? events.at(-1)?.timestamp ?? generated,
      outcome,
      furthest_step: Math.min(furthestStep, steps.length),
      total_steps: steps.length,
      maximum_state: highestState(events),
      final_state: finalState
    },
    summary: {
      total_events: events.length,
      input_errors: inputErrors.length,
      confirmed_navigation_loops: loops.length,
      recovery_events: recoveries.length,
      adaptive_support_activations: adaptiveActivations.length,
      input_errors_by_step: countBy(inputErrors, (item) => `Step ${item.step}`),
      validation_categories: countBy(inputErrors, (item) => item.validation_code),
      loop_routes: countBy(loops, (item) => item.loop_route?.join(" -> ") ?? `${item.step} -> ${item.destination_step}`)
    },
    steps: steps.map(({ id, short, title }) => ({ id, short, title })),
    events
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasProhibitedKeys(value) {
  if (Array.isArray(value)) return value.some(hasProhibitedKeys);
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(
    ([key, child]) =>
      /^(raw_?value|full_?name|email_?address|organisation|success_?outcome|form_?values?)$/i.test(key) ||
      hasProhibitedKeys(child)
  );
}

export function validateSessionReport(report) {
  const errors = [];
  if (!isPlainObject(report)) return { valid: false, errors: ["The report must be a JSON object."] };
  if (report.schema !== REPORT_SCHEMA) errors.push("Unsupported report schema.");
  if (report.version !== REPORT_VERSION) errors.push("Unsupported report version.");
  if (!isPlainObject(report.privacy) || report.privacy.form_values_included !== false) {
    errors.push("The report does not declare that form values are excluded.");
  }
  if (!isPlainObject(report.session) || typeof report.session.session_id !== "string") {
    errors.push("Session metadata is missing.");
  }
  if (!Array.isArray(report.events)) errors.push("The event list is missing.");
  else {
    report.events.forEach((event, index) => {
      if (!isPlainObject(event) || !Object.values(EVENT_TYPES).includes(event.type)) {
        errors.push(`Event ${index + 1} has an unsupported type.`);
      }
      if (hasProhibitedKeys(event)) {
        errors.push(`Event ${index + 1} contains a prohibited value field.`);
      }
    });
  }
  return { valid: errors.length === 0, errors };
}

export function aggregateSessionReports(reports) {
  if (!Array.isArray(reports) || reports.length === 0) {
    throw new TypeError("At least one session report is required.");
  }
  reports.forEach((report, index) => {
    const validation = validateSessionReport(report);
    if (!validation.valid) throw new TypeError(`Report ${index + 1}: ${validation.errors.join(" ")}`);
  });

  const sessions = reports.map((report) => report.session);
  const events = reports.flatMap((report) => report.events);
  const errors = events.filter((event) => event.type === EVENT_TYPES.INPUT_ERROR);
  const loops = events.filter((event) => event.loop_detected);
  const adaptive = events.filter((event) =>
    ["Additional guidance", "Focused guidance", "Recovering"].includes(event.assistance_level)
  );
  const recoveredSessions = reports.filter((report) =>
    report.events.some((event) => event.evidence_resolved > 0)
  ).length;

  return {
    schema: "pathfinder-aggregate-analysis",
    version: 1,
    generated_at: new Date().toISOString(),
    sessions_analysed: reports.length,
    completed_sessions: sessions.filter((session) => session.outcome === "completed").length,
    incomplete_sessions: sessions.filter((session) => session.outcome !== "completed").length,
    sessions_with_recovery: recoveredSessions,
    maximum_state_distribution: countBy(sessions, (session) => session.maximum_state),
    input_errors_by_step: countBy(errors, (event) => `Step ${event.step}`),
    validation_categories: countBy(errors, (event) => event.validation_code),
    confirmed_loop_routes: countBy(loops, (event) => event.loop_route?.join(" -> ") ?? `${event.step} -> ${event.destination_step}`),
    support_activations_by_step: countBy(adaptive, (event) => `Step ${event.step}`),
    total_events: events.length,
    total_input_errors: errors.length,
    total_confirmed_loops: loops.length,
    interpretation: "Counts identify recurring observable interaction evidence. They do not establish disability, confusion or causation."
  };
}
