import { STATES } from "./state-engine.js";

export const SUPPORT_LEVELS = Object.freeze({
  [STATES.STABLE]: "Standard support",
  [STATES.FRICTION]: "Additional guidance",
  [STATES.CRITICAL]: "Focused guidance"
});

export function identifySignal(trace) {
  if (["field_valid", "step_progress", "completion"].includes(trace.event?.type)) return "progress";
  if (
    trace.accepted_state === STATES.CRITICAL &&
    trace.matched_rule === "Repeated navigation-loop override"
  ) return "navigation";
  if (
    trace.accepted_state === STATES.CRITICAL &&
    trace.matched_rule === "Repeated input-failure override"
  ) return "input";
  if (trace.E > 0 && trace.L > 0) return "mixed";
  if (trace.E > 0) return "input";
  if (trace.L > 0) return "navigation";
  return "neutral";
}

function response({
  code,
  level,
  title,
  message,
  announce = false,
  announcement = "",
  showErrorSummary = false,
  offerDetailedHelp = false,
  helpTitle = "Step-by-step help",
  helpSteps = []
}) {
  return {
    code,
    level,
    title,
    message,
    announce,
    announcement,
    showErrorSummary,
    offerDetailedHelp,
    helpTitle,
    helpSteps
  };
}

export function selectResponse(trace, context = {}) {
  const evidenceSignal = identifySignal(trace);
  // Historical evidence stays in the trace, but guidance needs a current trigger.
  const signal = !context.validationMessage && evidenceSignal !== "progress"
    ? trace.loop_detected ? "navigation" : "neutral"
    : evidenceSignal;
  const stepName = context.stepName ?? "the current step";

  if (trace.accepted_state === STATES.CRITICAL) {
    if (signal === "progress") {
      return response({
        code: "critical_recovery",
        level: SUPPORT_LEVELS[STATES.FRICTION],
        title: "Recovery is under way",
        message: `${trace.recovery_status} Continue with the next required action.`,
        announce: true,
        announcement: `Recovery is under way. ${trace.recovery_status}`
      });
    }
    if (signal === "mixed") {
      return response({
        code: "critical_mixed",
        level: SUPPORT_LEVELS[STATES.CRITICAL],
        title: "Focus on one blocking action",
        message: `There is a validation error at ${stepName}, and the session has recent navigation-loop evidence. Resolve the highlighted field before changing steps again.`,
        announce: true,
        announcement: "Focused guidance is available. Resolve the highlighted field before changing steps again.",
        showErrorSummary: true,
        offerDetailedHelp: true,
        helpSteps: [
          "Read the instruction attached to the highlighted field.",
          "Correct that field and confirm that its error message clears.",
          "Use Save and continue to make forward progress."
        ]
      });
    }
    if (signal === "input") {
      return response({
        code: "critical_input",
        level: SUPPORT_LEVELS[STATES.CRITICAL],
        title: "Focused help is available",
        message: "Repeated attempts at this step have not restored progress. Focus remains on the highlighted field, and optional step-by-step help is available.",
        announce: true,
        announcement: "Focused guidance is available for the repeatedly blocked field.",
        showErrorSummary: true,
        offerDetailedHelp: true,
        helpSteps: [
          "Read the requirement beside the highlighted field.",
          "Enter or select a value that fulfils that requirement.",
          "Confirm that the inline error clears, then use Save and continue."
        ]
      });
    }
    if (signal === "navigation") {
      return response({
        code: "critical_navigation",
        level: SUPPORT_LEVELS[STATES.CRITICAL],
        title: "Break the repeated route",
        message: trace.matched_rule === "Repeated navigation-loop override"
          ? `The same route has been completed repeatedly without new progress. You are at ${stepName}. Complete the required action here before returning to earlier steps.`
          : `You returned to a step you had already visited without reaching a new step. You are at ${stepName}. If you are ready, use Save and continue.`,
        announce: true,
        announcement: "Focused navigation guidance is available.",
        offerDetailedHelp: true,
        helpSteps: [
          `Confirm your current position: ${stepName}.`,
          "Review this step and complete any required action that is still unfinished.",
          "Use Save and continue; use Back only when you need to review completed information."
        ]
      });
    }
  }

  if (trace.accepted_state === STATES.FRICTION) {
    if (signal === "progress") {
      return response({
        code: "friction_recovery",
        level: "Recovering",
        title: "The interaction is recovering",
        message: trace.recovery_status,
        announce: true,
        announcement: `The interaction is recovering. ${trace.recovery_status}`
      });
    }
    if (signal === "input") {
      return response({
        code: "friction_input",
        level: SUPPORT_LEVELS[STATES.FRICTION],
        title: "Additional guidance is active",
        message: "This step has blocked progress more than once. Review the instruction at the highlighted field, correct it, and then continue.",
        announce: true,
        announcement: "Additional guidance is active because this step has blocked progress more than once."
      });
    }
    if (signal === "navigation") {
      return response({
        code: "friction_navigation",
        level: SUPPORT_LEVELS[STATES.FRICTION],
        title: "A repeated route was detected",
        message: `You returned to the route's starting point without new progress. You are at ${stepName}.`,
        announce: true,
        announcement: `Additional navigation guidance is active. You returned to the route's starting point without new progress.`
      });
    }
    if (signal === "mixed") {
      return response({
        code: "friction_mixed",
        level: SUPPORT_LEVELS[STATES.FRICTION],
        title: "Review the blocking action first",
        message: `There is a validation error at ${stepName}, and the session has recent navigation-loop evidence. Resolve the highlighted requirement before navigating again.`,
        announce: true,
        announcement: "Additional guidance is active. Resolve the highlighted requirement before navigating again."
      });
    }
  }

  if (signal === "input") {
    return response({
      code: "stable_validation",
      level: SUPPORT_LEVELS[STATES.STABLE],
      title: "Use the field-level guidance",
      message: "The highlighted field explains what must be corrected before you continue. No additional adaptive guidance is active."
    });
  }

  return response({
    code: signal === "progress" ? "stable_progress" : "stable_default",
    level: SUPPORT_LEVELS[STATES.STABLE],
    title: "Standard guidance is active",
    message: "Complete the current step when you are ready."
  });
}
