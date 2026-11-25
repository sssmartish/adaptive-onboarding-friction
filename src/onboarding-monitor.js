import { EVENT_TYPES, StateEngine, createInteractionEvent } from "./state-engine.js";

function assertSteps(steps) {
  if (!Array.isArray(steps) || steps.length < 2) {
    throw new TypeError("A reusable onboarding monitor requires at least two ordered steps.");
  }
  const identifiers = steps.map((step) => step.id);
  if (identifiers.some((id) => !Number.isInteger(id)) || new Set(identifiers).size !== identifiers.length) {
    throw new TypeError("Every onboarding step requires a unique integer id.");
  }
}

export class OnboardingMonitor {
  constructor({ steps, engineOptions = {}, onDecision = null }) {
    assertSteps(steps);
    this.steps = steps.map((step) => ({ ...step }));
    this.engine = new StateEngine(engineOptions);
    this.onDecision = onDecision;
  }

  process(input, context = {}) {
    const event = createInteractionEvent(
      {
        sessionId: this.engine.session.session_id,
        type: input.type,
        step: input.step,
        destinationStep: input.destinationStep,
        direction: input.direction,
        validationCode: input.validationCode
      },
      this.engine.options
    );
    const trace = this.engine.process(event, context);
    this.onDecision?.(trace);
    return trace;
  }

  reportValidationError({ step, validationCode }) {
    return this.process({ type: EVENT_TYPES.INPUT_ERROR, step, validationCode });
  }

  reportFieldValid({ step, validationCode }) {
    return this.process({ type: EVENT_TYPES.FIELD_VALID, step, validationCode });
  }

  reportNavigation({ fromStep, toStep }) {
    return this.process({
      type: EVENT_TYPES.NAVIGATION_MOVE,
      step: fromStep,
      destinationStep: toStep
    });
  }

  reportStepProgress({ step, destinationStep = step + 1 }) {
    return this.process({
      type: EVENT_TYPES.STEP_PROGRESS,
      step,
      destinationStep,
      direction: "forward"
    });
  }

  reportCompletion({ step }) {
    return this.process(
      { type: EVENT_TYPES.COMPLETION, step, destinationStep: null, direction: "none" },
      { terminal: true }
    );
  }

  reset() {
    return this.engine.reset();
  }

  snapshot() {
    return this.engine.snapshot();
  }
}
