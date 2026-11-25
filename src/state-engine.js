export const STATES = Object.freeze({
  STABLE: "Stable",
  FRICTION: "Friction",
  CRITICAL: "Critical"
});

export const EVENT_TYPES = Object.freeze({
  INPUT_ERROR: "input_error",
  FIELD_VALID: "field_valid",
  NAVIGATION_MOVE: "navigation_move",
  NAVIGATION_LOOP: "navigation_loop",
  STEP_PROGRESS: "step_progress",
  COMPLETION: "completion"
});

export const WINDOW_SIZE = 5;
export const FRICTION_THRESHOLD = 0.4;
export const CRITICAL_THRESHOLD = 0.8;

function makeIdentifier(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function validationTarget(code) {
  return code?.split(":")[0] ?? null;
}

function isAdverseEvidence(event) {
  return event.type === EVENT_TYPES.INPUT_ERROR || event.type === EVENT_TYPES.NAVIGATION_LOOP;
}

function isRecoveryEvent(event) {
  return event.type === EVENT_TYPES.FIELD_VALID || event.type === EVENT_TYPES.STEP_PROGRESS;
}

function latestMatchingInputFailure(events) {
  const recentThree = events.slice(-3);
  return (
    recentThree.length === 3 &&
    recentThree.every((event) => event.type === EVENT_TYPES.INPUT_ERROR) &&
    new Set(recentThree.map((event) => event.step)).size === 1 &&
    new Set(recentThree.map((event) => event.validation_code)).size === 1
  );
}

export function createSession(options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const idFactory = options.idFactory ?? (() => makeIdentifier("session"));
  return {
    session_id: idFactory(),
    start_time: now(),
    end_time: null,
    current_state: STATES.STABLE,
    max_completed_step: 0
  };
}

export function createInteractionEvent(input, options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const idFactory = options.idFactory ?? (() => makeIdentifier("event"));
  if (!Object.values(EVENT_TYPES).includes(input.type)) {
    throw new TypeError(`Unsupported event type: ${input.type}`);
  }

  const step = Number(input.step);
  const destinationStep = input.destinationStep == null ? null : Number(input.destinationStep);
  let direction = input.direction ?? "none";
  if (input.type === EVENT_TYPES.NAVIGATION_MOVE && destinationStep != null) {
    direction = destinationStep > step ? "forward" : destinationStep < step ? "backward" : "none";
  }
  if (!["forward", "backward", "none"].includes(direction)) {
    throw new TypeError(`Unsupported direction: ${direction}`);
  }

  return {
    event_id: idFactory(),
    session_id: input.sessionId,
    type: input.type,
    step,
    destination_step: destinationStep,
    direction,
    timestamp: now(),
    validation_code: input.validationCode ?? null
  };
}

export function analyseWindow(events, options = {}) {
  const evidence = options.evidence ?? events.filter(isAdverseEvidence).slice(-WINDOW_SIZE);
  const inputErrors = evidence.filter((event) => event.type === EVENT_TYPES.INPUT_ERROR);
  const navigationLoops = evidence.filter((event) => event.type === EVENT_TYPES.NAVIGATION_LOOP);
  const rawScore = (inputErrors.length + navigationLoops.length) / WINDOW_SIZE;
  return {
    E: inputErrors.length,
    L: navigationLoops.length,
    S: rawScore,
    rawScore,
    inputOverride: options.inputOverride ?? latestMatchingInputFailure(events),
    navigationOverride: options.navigationOverride ?? false,
    evidenceLength: evidence.length
  };
}

export function classifyWindow(analysis, options = {}) {
  if (options.terminal) {
    return { state: STATES.STABLE, rule: "Successful completion", effectiveScore: 0 };
  }

  if (analysis.inputOverride) {
    return {
      state: STATES.CRITICAL,
      rule: "Repeated input-failure override",
      effectiveScore: Math.max(analysis.rawScore, CRITICAL_THRESHOLD)
    };
  }
  if (analysis.navigationOverride) {
    return {
      state: STATES.CRITICAL,
      rule: "Repeated navigation-loop override",
      effectiveScore: Math.max(analysis.rawScore, CRITICAL_THRESHOLD)
    };
  }
  if (analysis.rawScore >= CRITICAL_THRESHOLD) {
    return { state: STATES.CRITICAL, rule: "Critical score range", effectiveScore: analysis.rawScore };
  }
  if (analysis.rawScore >= FRICTION_THRESHOLD) {
    return { state: STATES.FRICTION, rule: "Friction score range", effectiveScore: analysis.rawScore };
  }
  return { state: STATES.STABLE, rule: "Stable score range", effectiveScore: analysis.rawScore };
}

function removeEvidenceAt(evidence, index) {
  if (index < 0) return 0;
  evidence.splice(index, 1);
  return 1;
}

function resolveFieldEvidence(evidence, event, allowFirstSuccessCredit = false) {
  const target = validationTarget(event.validation_code);
  let index = evidence.findIndex(
    (item) =>
      item.type === EVENT_TYPES.INPUT_ERROR &&
      item.step === event.step &&
      validationTarget(item.validation_code) === target
  );
  if (index < 0 && allowFirstSuccessCredit) {
    index = evidence.findIndex((item) => item.type === EVENT_TYPES.INPUT_ERROR);
  }
  return removeEvidenceAt(evidence, index);
}

function resolveProgressEvidence(evidence, event) {
  let index = evidence.findIndex(
    (item) => item.type === EVENT_TYPES.INPUT_ERROR && item.step === event.step
  );
  if (index < 0) index = evidence.findIndex((item) => item.type === EVENT_TYPES.NAVIGATION_LOOP);
  return removeEvidenceAt(evidence, index);
}

function recoveryMessage({ event, previousState, state, evidenceLength, terminal, loopDetected, resolved }) {
  if (terminal) return "Completed; no unresolved trigger remains.";
  if (event.type === EVENT_TYPES.INPUT_ERROR || loopDetected) return "New adverse evidence recorded.";
  if (event.type === EVENT_TYPES.NAVIGATION_MOVE) return "Navigation movement recorded; no loop evidence was added.";
  if (!isRecoveryEvent(event)) return "No recovery action is required.";

  const progressRequired = Math.max(0, evidenceLength - 1);
  if (resolved === 0) return "Successful interaction recorded; no matching adverse evidence remained.";
  if (previousState === STATES.CRITICAL && state === STATES.FRICTION) {
    return `Critical resolved; ${progressRequired} additional recovery event${progressRequired === 1 ? "" : "s"} needed for Stable.`;
  }
  if (previousState === STATES.CRITICAL && state === STATES.CRITICAL) {
    return `Recovery recorded; ${progressRequired} additional recovery event${progressRequired === 1 ? "" : "s"} needed for Stable.`;
  }
  if (previousState === STATES.FRICTION && state === STATES.STABLE) return "Recovery confirmed; Stable reached.";
  if (state === STATES.FRICTION) {
    return `${progressRequired} additional recovery event${progressRequired === 1 ? "" : "s"} needed for Stable.`;
  }
  return "Successful interaction recorded; no unresolved trigger remains.";
}

export class StateEngine {
  constructor(options = {}) {
    this.options = options;
    this.reset();
  }

  detectNavigationLoop(event) {
    if (event.type !== EVENT_TYPES.NAVIGATION_MOVE || event.destination_step == null) return false;
    if (event.destination_step === event.step) return false;
    if (this.navigationAnchor == null) this.navigationAnchor = event.step;
    this.navigationRoute.push(event.destination_step);
    if (event.destination_step !== this.navigationAnchor) return false;
    this.lastDetectedLoopRoute = [this.navigationAnchor, ...this.navigationRoute];
    this.navigationAnchor = null;
    this.navigationRoute = [];
    return true;
  }

  process(event, context = {}) {
    if (event.session_id !== this.session.session_id) {
      throw new Error("The interaction event does not belong to the active session.");
    }

    const previousState = this.session.current_state;
    this.window.push(event);
    if (this.window.length > WINDOW_SIZE) this.window.shift();

    let resolvedEvidence = 0;
    const loopDetected = this.detectNavigationLoop(event);

    if (event.type === EVENT_TYPES.INPUT_ERROR) {
      this.evidence.push(event);
      if (this.evidence.length > WINDOW_SIZE) this.evidence.shift();
    }

    if (loopDetected) {
      const loopEvidence = { ...event, type: EVENT_TYPES.NAVIGATION_LOOP };
      this.evidence.push(loopEvidence);
      if (this.evidence.length > WINDOW_SIZE) this.evidence.shift();
      this.navigationLoopsSinceProgress += 1;
    }

    let firstFieldSuccess = false;
    let duplicateFieldSuccessIgnored = false;
    if (event.type === EVENT_TYPES.FIELD_VALID) {
      const fieldKey = `${event.step}:${validationTarget(event.validation_code)}`;
      firstFieldSuccess = !this.creditedFieldSuccesses.has(fieldKey);
      resolvedEvidence = resolveFieldEvidence(this.evidence, event, firstFieldSuccess);
      this.creditedFieldSuccesses.add(fieldKey);
      duplicateFieldSuccessIgnored = !firstFieldSuccess && resolvedEvidence === 0;
    }

    if (event.type === EVENT_TYPES.STEP_PROGRESS) {
      resolvedEvidence = resolveProgressEvidence(this.evidence, event);
      this.session.max_completed_step = Math.max(this.session.max_completed_step, event.step);
      this.navigationLoopsSinceProgress = 0;
      this.navigationAnchor = null;
      this.navigationRoute = [];
    }

    if (event.type === EVENT_TYPES.INPUT_ERROR) {
      const key = `${event.step}:${event.validation_code}`;
      this.inputFailureStreak = key === this.previousInputFailureKey ? this.inputFailureStreak + 1 : 1;
      this.previousInputFailureKey = key;
    } else {
      this.inputFailureStreak = 0;
      this.previousInputFailureKey = null;
    }

    if (event.type === EVENT_TYPES.COMPLETION || context.terminal) {
      this.evidence = [];
      this.navigationLoopsSinceProgress = 0;
      this.navigationAnchor = null;
      this.navigationRoute = [];
      this.inputFailureStreak = 0;
      this.previousInputFailureKey = null;
      this.session.max_completed_step = Math.max(this.session.max_completed_step, event.step);
      this.session.end_time = event.timestamp;
    }

    const terminal = event.type === EVENT_TYPES.COMPLETION || Boolean(context.terminal);
    const analysis = analyseWindow(this.window, {
      evidence: this.evidence,
      inputOverride: this.inputFailureStreak >= 3,
      navigationOverride: this.navigationLoopsSinceProgress >= 3
    });
    const classification = classifyWindow(analysis, { terminal });
    const acceptedState = classification.state;
    const scoreAdjustment = Number((classification.effectiveScore - analysis.rawScore).toFixed(10));

    this.session.current_state = acceptedState;
    this.recoveryStatus = recoveryMessage({
      event,
      previousState,
      state: acceptedState,
      evidenceLength: analysis.evidenceLength,
      terminal,
      loopDetected,
      resolved: resolvedEvidence
    });

    this.lastTrace = {
      event,
      E: analysis.E,
      L: analysis.L,
      S: analysis.rawScore,
      raw_score: analysis.rawScore,
      effective_score: classification.effectiveScore,
      score_adjustment: scoreAdjustment,
      score_adjusted: scoreAdjustment !== 0,
      input_override: analysis.inputOverride,
      navigation_override: analysis.navigationOverride,
      loop_detected: loopDetected,
      loop_route: loopDetected ? [...this.lastDetectedLoopRoute] : null,
      evidence_resolved: resolvedEvidence,
      matched_rule: classification.rule,
      previous_state: previousState,
      accepted_state: acceptedState,
      recovery_applied:
        (previousState === STATES.CRITICAL && acceptedState === STATES.FRICTION) ||
        (previousState === STATES.FRICTION && acceptedState === STATES.STABLE),
      recovery_status: this.recoveryStatus,
      window_length: this.window.length,
      evidence_length: analysis.evidenceLength,
      ordinary_navigation_neutral: event.type === EVENT_TYPES.NAVIGATION_MOVE && !loopDetected,
      first_field_success: firstFieldSuccess,
      duplicate_field_success_ignored: duplicateFieldSuccessIgnored
    };
    return this.lastTrace;
  }

  snapshot() {
    return {
      session: { ...this.session },
      window: this.window.map((event) => ({ ...event })),
      evidence: this.evidence.map((event) => ({ ...event })),
      recoveryStatus: this.recoveryStatus,
      navigationLoopsSinceProgress: this.navigationLoopsSinceProgress,
      navigationAnchor: this.navigationAnchor,
      inputFailureStreak: this.inputFailureStreak,
      creditedFieldSuccesses: [...this.creditedFieldSuccesses],
      lastTrace: this.lastTrace ? { ...this.lastTrace } : null
    };
  }

  reset() {
    if (this.session && !this.session.end_time) {
      this.session.end_time = (this.options.now ?? (() => new Date().toISOString()))();
    }
    this.session = createSession(this.options);
    this.window = [];
    this.evidence = [];
    this.navigationLoopsSinceProgress = 0;
    this.navigationAnchor = null;
    this.navigationRoute = [];
    this.lastDetectedLoopRoute = null;
    this.inputFailureStreak = 0;
    this.previousInputFailureKey = null;
    this.creditedFieldSuccesses = new Set();
    this.recoveryStatus = "No recovery action is required.";
    this.lastTrace = null;
    return this.snapshot();
  }
}
