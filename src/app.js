import {
  EVENT_TYPES,
  STATES
} from "./state-engine.js";
import { OnboardingMonitor } from "./onboarding-monitor.js";
import { ONBOARDING_STEPS as STEP_META } from "./onboarding-config.js";
import { selectResponse } from "./response-controller.js";
import { createSessionReport } from "./session-report.js";

const monitor = new OnboardingMonitor({ steps: STEP_META });
const engine = monitor.engine;
const metrics = [];
const decisionHistory = [];
const recordedValidFields = new Set();
let currentStep = 1;
let completed = false;
let currentReport = null;
let lastAnnouncedCode = null;

const form = document.querySelector("#onboarding-form");
const panels = [...document.querySelectorAll("[data-step-panel]")];
const progressItems = [...document.querySelectorAll("#progress-list li")];
const stepCounter = document.querySelector("#step-counter");
const formTitle = document.querySelector("#form-title");
const backButton = document.querySelector("#back-button");
const continueButton = document.querySelector("#continue-button");
const resetButton = document.querySelector("#reset-button");
const startAgainButton = document.querySelector("#start-again-button");
const formActions = document.querySelector("#form-actions");
const completionPanel = document.querySelector("#completion-panel");
const stateBadge = document.querySelector("#state-badge");
const supportMessage = document.querySelector("#support-message");
const supportTitle = document.querySelector("#support-message-title");
const supportText = document.querySelector("#support-message-text");
const orientationText = document.querySelector("#orientation-text");
const errorSummary = document.querySelector("#error-summary");
const errorSummaryText = document.querySelector("#error-summary-text");
const reviewList = document.querySelector("#review-list");
const mobileStateBadge = document.querySelector("#mobile-state-badge");
const mobileSupportTitle = document.querySelector("#mobile-support-title");
const mobileSupportText = document.querySelector("#mobile-support-text");
const adaptiveAnnouncer = document.querySelector("#adaptive-announcer");
const supportHelpToggle = document.querySelector("#support-help-toggle");
const supportHelp = document.querySelector("#support-help");
const supportHelpTitle = document.querySelector("#support-help-title");
const supportHelpSteps = document.querySelector("#support-help-steps");
const mobileSupportHelpToggle = document.querySelector("#mobile-support-help-toggle");
const mobileSupportHelp = document.querySelector("#mobile-support-help");
const mobileSupportHelpTitle = document.querySelector("#mobile-support-help-title");
const mobileSupportHelpSteps = document.querySelector("#mobile-support-help-steps");
const generateReportButton = document.querySelector("#generate-report-button");
const sessionReportPanel = document.querySelector("#session-report-panel");
const sessionReportTitle = document.querySelector("#session-report-title");
const reportSummary = document.querySelector("#report-summary");
const reportEvents = document.querySelector("#report-events");
const closeReportButton = document.querySelector("#close-report-button");
const printReportButton = document.querySelector("#print-report-button");
const exportReportButton = document.querySelector("#export-report-button");

const traceElements = {
  events: document.querySelector("#trace-events"),
  errors: document.querySelector("#trace-errors"),
  loops: document.querySelector("#trace-loops"),
  evidence: document.querySelector("#trace-evidence"),
  rawScore: document.querySelector("#trace-raw-score"),
  adjustmentRow: document.querySelector("#trace-adjustment-row"),
  adjustment: document.querySelector("#trace-adjustment"),
  scoreRow: document.querySelector("#trace-score-row"),
  score: document.querySelector("#trace-score"),
  rule: document.querySelector("#trace-rule"),
  recovery: document.querySelector("#trace-recovery"),
  state: document.querySelector("#trace-state"),
  strip: document.querySelector("#event-strip")
};

function stepName(step = currentStep) {
  return `Step ${step} of ${STEP_META.length}: ${STEP_META[step - 1].short}`;
}

function renderTrace(trace) {
  traceElements.events.textContent = `${trace.window_length} of 5`;
  traceElements.errors.textContent = String(trace.E);
  traceElements.loops.textContent = String(trace.L);
  traceElements.evidence.textContent = `${trace.evidence_length} of 5`;
  traceElements.rawScore.textContent = trace.raw_score.toFixed(1);
  traceElements.adjustmentRow.hidden = !trace.score_adjusted;
  traceElements.scoreRow.hidden = !trace.score_adjusted;
  traceElements.adjustment.textContent = `+${trace.score_adjustment.toFixed(1)}`;
  traceElements.score.textContent = trace.effective_score.toFixed(1);
  traceElements.rule.textContent = trace.matched_rule;
  traceElements.recovery.textContent = trace.recovery_status;
  traceElements.state.textContent = trace.accepted_state;

  traceElements.strip.replaceChildren();
  engine.window.forEach((event, index) => {
    const token = document.createElement("span");
    token.className = "event-token";
    token.dataset.eventType = event.type;
    token.textContent =
      event.type === EVENT_TYPES.INPUT_ERROR
        ? "Input error"
        : event.type === EVENT_TYPES.FIELD_VALID
          ? "Field valid"
          : event.type === EVENT_TYPES.STEP_PROGRESS
            ? "Step progress"
            : event.type === EVENT_TYPES.COMPLETION
              ? "Complete"
              : index === engine.window.length - 1 && trace.loop_detected
                ? "Loop"
                : event.direction === "backward"
                  ? "Back"
                  : "Forward";
    traceElements.strip.append(token);
  });
}

function renderInitialTrace() {
  traceElements.events.textContent = "0 of 5";
  traceElements.errors.textContent = "0";
  traceElements.loops.textContent = "0";
  traceElements.evidence.textContent = "0 of 5";
  traceElements.rawScore.textContent = "0.0";
  traceElements.adjustmentRow.hidden = true;
  traceElements.adjustment.textContent = "+0.0";
  traceElements.scoreRow.hidden = true;
  traceElements.score.textContent = "0.0";
  traceElements.rule.textContent = "Stable score range";
  traceElements.recovery.textContent = "No recovery action is required.";
  traceElements.state.textContent = STATES.STABLE;
  traceElements.strip.replaceChildren();
}

function renderHelp(target, title, steps) {
  target.title.textContent = title;
  target.steps.replaceChildren();
  steps.forEach((step) => {
    const item = document.createElement("li");
    item.textContent = step;
    target.steps.append(item);
  });
}

function closeDetailedHelp() {
  [
    { toggle: supportHelpToggle, panel: supportHelp },
    { toggle: mobileSupportHelpToggle, panel: mobileSupportHelp }
  ].forEach(({ toggle, panel }) => {
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = "Show step-by-step help";
    panel.hidden = true;
  });
  document.body.dataset.focusedHelp = "false";
}

function configureDetailedHelp(response) {
  closeDetailedHelp();
  [supportHelpToggle, mobileSupportHelpToggle].forEach((toggle) => {
    toggle.hidden = !response.offerDetailedHelp;
  });
  renderHelp({ title: supportHelpTitle, steps: supportHelpSteps }, response.helpTitle, response.helpSteps);
  renderHelp(
    { title: mobileSupportHelpTitle, steps: mobileSupportHelpSteps },
    response.helpTitle,
    response.helpSteps
  );
}

function setDetailedHelp(open) {
  [
    { toggle: supportHelpToggle, panel: supportHelp },
    { toggle: mobileSupportHelpToggle, panel: mobileSupportHelp }
  ].forEach(({ toggle, panel }) => {
    if (toggle.hidden) return;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Return to standard page detail" : "Show step-by-step help";
    panel.hidden = !open;
  });
  document.body.dataset.focusedHelp = String(open);
}

function applyResponse(trace, context = {}) {
  const response = selectResponse(trace, context);
  const stateKey = trace.accepted_state.toLowerCase();
  const supportState = response.code === "stable_default" ? "stable" : stateKey;

  document.body.dataset.interactionState = stateKey;
  document.body.dataset.supportState = supportState;
  stateBadge.dataset.state = supportState;
  stateBadge.textContent = response.level;
  supportMessage.dataset.state = supportState;
  supportTitle.textContent = response.title;
  supportText.textContent = response.message;
  mobileStateBadge.dataset.state = supportState;
  mobileStateBadge.textContent = response.level;
  mobileSupportTitle.textContent = response.title;
  mobileSupportText.textContent = response.message;
  configureDetailedHelp(response);

  if (response.showErrorSummary && context.validationMessage) {
    errorSummary.hidden = false;
    errorSummaryText.textContent = `Repeated validation has blocked progress at ${context.fieldLabel}. Continue from the highlighted field.`;
  } else {
    errorSummary.hidden = true;
    errorSummaryText.textContent = "";
  }

  if (!response.announce) {
    adaptiveAnnouncer.textContent = "";
    lastAnnouncedCode = null;
  } else if (response.code !== lastAnnouncedCode) {
    adaptiveAnnouncer.textContent = "";
    requestAnimationFrame(() => {
      if (lastAnnouncedCode === response.code) adaptiveAnnouncer.textContent = response.announcement;
    });
    lastAnnouncedCode = response.code;
  }

  renderTrace(trace);
  return response;
}

function processInteraction(input, context = {}, engineContext = {}) {
  const startedAt = performance.now();
  const trace = monitor.process(
    {
      step: input.step ?? currentStep,
      destinationStep: input.destinationStep,
      type: input.type,
      direction: input.direction,
      validationCode: input.validationCode
    },
    engineContext
  );
  const event = trace.event;
  const response = applyResponse(trace, context);
  decisionHistory.push({
    ...trace,
    event: { ...trace.event },
    loop_route: trace.loop_route ? [...trace.loop_route] : null,
    response: {
      code: response.code,
      level: response.level,
      title: response.title,
      message: response.message
    }
  });
  const metric = {
    event_id: event.event_id,
    event_type: event.type,
    state: trace.accepted_state,
    processing_to_dom_ms: Number((performance.now() - startedAt).toFixed(3)),
    first_frame_ms: null
  };
  metrics.push(metric);

  requestAnimationFrame(() => {
    metric.first_frame_ms = Number((performance.now() - startedAt).toFixed(3));
  });

  return { event, trace, response, metric };
}

function clearFieldError(field) {
  field.removeAttribute("aria-invalid");
  const error = document.querySelector(`#${CSS.escape(field.id)}-error`);
  if (error) error.textContent = "";
}

function validationRuleForField(field) {
  const value = field.type === "checkbox" || field.type === "radio" ? field.checked : field.value.trim();
  const rules = {
    "full-name": () => (!value ? "full_name:required" : value.length < 2 ? "full_name:min_length" : null),
    email: () => (!value ? "email:required" : !field.validity.valid ? "email:format" : null),
    role: () => (!field.value ? "role:required" : null),
    "primary-goal": () => (!field.value ? "primary_goal:required" : null),
    outcome: () => (!value ? "outcome:required" : value.length < 10 ? "outcome:min_length" : null),
    confirmation: () => (!field.checked ? "confirmation:required" : null)
  };
  if (field.name === "pace") {
    return form.querySelector('input[name="pace"]:checked') ? null : "pace:required";
  }
  return rules[field.id]?.() ?? null;
}

function clearResolvedPresentation(field) {
  clearFieldError(field);
  if (field.name === "pace") {
    form.querySelectorAll('input[name="pace"]').forEach((item) => item.removeAttribute("aria-invalid"));
    document.querySelector("#pace-error").textContent = "";
  }
  errorSummary.hidden = true;
  errorSummaryText.textContent = "";
}

function handleFieldResolution(field) {
  if (!field.matches("input, select, textarea") || field.disabled) return;
  if (validationRuleForField(field)) return;

  const hadVisibleError = field.getAttribute("aria-invalid") === "true";
  clearResolvedPresentation(field);
  const targetField = field.name === "pace" ? form.querySelector('input[name="pace"]') : field;
  const key = targetField.id || targetField.name;
  const validationTarget = field.name === "pace" ? "pace" : key.replaceAll("-", "_");
  const modelledRequiredTargets = new Set([
    "full_name",
    "email",
    "role",
    "primary_goal",
    "outcome",
    "pace",
    "confirmation"
  ]);
  if (!modelledRequiredTargets.has(validationTarget) || recordedValidFields.has(key)) {
    if (hadVisibleError && engine.lastTrace) applyResponse(engine.lastTrace, { stepName: stepName() });
    return;
  }

  const snapshot = monitor.snapshot();
  const matchingEvidence = snapshot.evidence.find(
    (item) =>
      item.type === EVENT_TYPES.INPUT_ERROR &&
      item.step === currentStep &&
      item.validation_code?.split(":")[0] === validationTarget
  );

  recordedValidFields.add(key);
  processInteraction(
    {
      type: EVENT_TYPES.FIELD_VALID,
      direction: "none",
      validationCode: matchingEvidence?.validation_code ?? `${validationTarget}:valid`
    },
    { stepName: stepName() }
  );
}

function setFieldError(field, message) {
  field.setAttribute("aria-invalid", "true");
  recordedValidFields.delete(field.id || field.name);
  const error = document.querySelector(`#${CSS.escape(field.id)}-error`);
  if (error) error.textContent = message;
}

function clearStepErrors(step = currentStep) {
  const panel = panels[step - 1];
  panel.querySelectorAll("input, select, textarea").forEach(clearFieldError);
  panel.querySelectorAll(".field-error").forEach((error) => {
    error.textContent = "";
  });
}

function validationFailure(field, fieldLabel, validationMessage, validationCode) {
  setFieldError(field, validationMessage);
  return { field, fieldLabel, validationMessage, validationCode };
}

function validateCurrentStep() {
  clearStepErrors();

  if (currentStep === 1) {
    const name = form.elements.fullName;
    const email = form.elements.email;
    if (!name.value.trim()) {
      return validationFailure(name, "Full name", "Enter your full name before continuing.", "full_name:required");
    }
    if (name.value.trim().length < 2) {
      return validationFailure(name, "Full name", "Enter at least two characters.", "full_name:min_length");
    }
    if (!email.value.trim()) {
      return validationFailure(email, "Email address", "Enter an email address before continuing.", "email:required");
    }
    if (!email.validity.valid) {
      return validationFailure(email, "Email address", "Use a valid format such as name@example.com.", "email:format");
    }
  }

  if (currentStep === 2) {
    const role = form.elements.role;
    if (!role.value) {
      return validationFailure(role, "Primary role", "Choose a primary role.", "role:required");
    }
  }

  if (currentStep === 3) {
    const goal = form.elements.primaryGoal;
    const outcome = form.elements.outcome;
    if (!goal.value) {
      return validationFailure(goal, "Primary goal", "Choose a primary goal.", "primary_goal:required");
    }
    if (!outcome.value.trim()) {
      return validationFailure(outcome, "Success outcome", "Describe what success would look like.", "outcome:required");
    }
    if (outcome.value.trim().length < 10) {
      return validationFailure(outcome, "Success outcome", "Write at least 10 characters.", "outcome:min_length");
    }
  }

  if (currentStep === 4) {
    const pace = form.querySelector('input[name="pace"]:checked');
    if (!pace) {
      const firstPace = form.querySelector('input[name="pace"]');
      form.querySelectorAll('input[name="pace"]').forEach((input) => input.setAttribute("aria-invalid", "true"));
      document.querySelector("#pace-error").textContent = "Choose a setup pace.";
      return {
        field: firstPace,
        fieldLabel: "Setup pace",
        validationMessage: "Choose a setup pace.",
        validationCode: "pace:required"
      };
    }
  }

  if (currentStep === 5) {
    const confirmation = form.elements.confirmation;
    if (!confirmation.checked) {
      return validationFailure(
        confirmation,
        "Review confirmation",
        "Confirm that you have reviewed the information.",
        "confirmation:required"
      );
    }
  }

  return null;
}

function appendReviewItem(term, value) {
  const wrapper = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = term;
  dd.textContent = value || "Not provided";
  wrapper.append(dt, dd);
  reviewList.append(wrapper);
}

function renderReview() {
  reviewList.replaceChildren();
  appendReviewItem("Name", form.elements.fullName.value.trim());
  appendReviewItem("Email", form.elements.email.value.trim());
  appendReviewItem("Role", form.elements.role.value);
  appendReviewItem("Organisation or school", form.elements.organisation.value.trim());
  appendReviewItem("Primary goal", form.elements.primaryGoal.value);
  appendReviewItem("Success outcome", form.elements.outcome.value.trim());
  appendReviewItem("Setup pace", form.querySelector('input[name="pace"]:checked')?.value ?? "");
  appendReviewItem("Progress reminders", form.elements.updates.checked ? "Included" : "Not included");
}

function renderStep(options = {}) {
  completed = false;
  completionPanel.hidden = true;
  formActions.hidden = false;
  document.querySelector(".required-note").hidden = false;

  panels.forEach((panel, index) => {
    panel.hidden = index + 1 !== currentStep;
  });

  progressItems.forEach((item, index) => {
    const step = index + 1;
    item.toggleAttribute("aria-current", step === currentStep);
    if (step === currentStep) item.setAttribute("aria-current", "step");
    item.dataset.status = step < currentStep ? "complete" : step === currentStep ? "current" : "upcoming";
  });

  stepCounter.textContent = `Step ${currentStep} of ${STEP_META.length}`;
  formTitle.textContent = STEP_META[currentStep - 1].title;
  orientationText.textContent = stepName();
  backButton.disabled = currentStep === 1;
  continueButton.textContent = currentStep === STEP_META.length ? "Complete onboarding" : "Save and continue";

  if (currentStep === STEP_META.length) renderReview();
  if (options.focus !== false) {
    panels[currentStep - 1].querySelector("h3")?.focus();
  }
}

function showCompletion() {
  completed = true;
  panels.forEach((panel) => {
    panel.hidden = true;
  });
  formActions.hidden = true;
  document.querySelector(".required-note").hidden = true;
  completionPanel.hidden = false;
  stepCounter.textContent = "Completed";
  formTitle.textContent = "Onboarding complete";
  orientationText.textContent = "All 5 steps completed";
  supportTitle.textContent = "Onboarding complete";
  supportText.textContent = "All required steps were completed and additional adaptive guidance was withdrawn.";
  stateBadge.textContent = "Standard support";
  mobileStateBadge.textContent = "Standard support";
  mobileSupportTitle.textContent = "Onboarding complete";
  mobileSupportText.textContent = supportText.textContent;
  progressItems.forEach((item) => {
    item.removeAttribute("aria-current");
    item.dataset.status = "complete";
  });
  completionPanel.focus();
}

function resetApplication(options = {}) {
  form.reset();
  monitor.reset();
  metrics.splice(0, metrics.length);
  decisionHistory.splice(0, decisionHistory.length);
  recordedValidFields.clear();
  currentStep = 1;
  completed = false;
  currentReport = null;
  lastAnnouncedCode = null;
  document.body.dataset.interactionState = "stable";
  document.body.dataset.supportState = "stable";
  stateBadge.dataset.state = "stable";
  stateBadge.textContent = "Standard support";
  supportMessage.dataset.state = "stable";
  supportTitle.textContent = "Standard guidance is active";
  supportText.textContent = "Complete the current step when you are ready.";
  mobileStateBadge.dataset.state = "stable";
  mobileStateBadge.textContent = "Standard support";
  mobileSupportTitle.textContent = "Standard guidance is active";
  mobileSupportText.textContent = "Complete the current step when you are ready.";
  errorSummary.hidden = true;
  errorSummaryText.textContent = "";
  adaptiveAnnouncer.textContent = "";
  sessionReportPanel.hidden = true;
  closeDetailedHelp();
  panels.forEach((_, index) => clearStepErrors(index + 1));
  renderInitialTrace();
  renderStep({ focus: options.focus !== false });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (completed) return;

  const invalid = validateCurrentStep();
  if (invalid) {
    processInteraction(
      {
        type: EVENT_TYPES.INPUT_ERROR,
        direction: "none",
        validationCode: invalid.validationCode
      },
      {
        fieldLabel: invalid.fieldLabel,
        validationMessage: invalid.validationMessage,
        stepName: stepName()
      }
    );
    invalid.field.focus();
    return;
  }

  const isNewProgress = currentStep > engine.session.max_completed_step;
  const destinationStep = Math.min(currentStep + 1, STEP_META.length);
  processInteraction(
    {
      type:
        currentStep === STEP_META.length
          ? EVENT_TYPES.COMPLETION
          : isNewProgress
            ? EVENT_TYPES.STEP_PROGRESS
            : EVENT_TYPES.NAVIGATION_MOVE,
      destinationStep,
      direction: currentStep === STEP_META.length ? "none" : "forward"
    },
    { stepName: stepName(destinationStep) },
    { terminal: currentStep === STEP_META.length }
  );

  if (currentStep === STEP_META.length) {
    showCompletion();
  } else {
    currentStep += 1;
    renderStep();
  }
});

backButton.addEventListener("click", () => {
  if (currentStep <= 1 || completed) return;
  const destinationStep = currentStep - 1;
  processInteraction(
    {
      type: EVENT_TYPES.NAVIGATION_MOVE,
      destinationStep,
      direction: "backward"
    },
    { stepName: stepName(destinationStep) }
  );
  currentStep = destinationStep;
  errorSummary.hidden = true;
  renderStep();
});

form.addEventListener("input", (event) => {
  if (event.target.matches('input[type="text"], input[type="email"], textarea')) {
    handleFieldResolution(event.target);
  }
});

form.addEventListener("change", (event) => {
  if (event.target.matches("select, input[type='radio'], input[type='checkbox']")) {
    handleFieldResolution(event.target);
  }
});

resetButton.addEventListener("click", () => resetApplication());
startAgainButton.addEventListener("click", () => resetApplication());

[supportHelpToggle, mobileSupportHelpToggle].forEach((toggle) => {
  toggle.addEventListener("click", () => setDetailedHelp(toggle.getAttribute("aria-expanded") !== "true"));
});

function addReportSummary(term, value) {
  const wrapper = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = term;
  dd.textContent = String(value);
  wrapper.append(dt, dd);
  reportSummary.append(wrapper);
}

function eventLabel(event) {
  if (event.loop_detected) return `Confirmed loop (${event.loop_route?.join(" -> ") ?? "route"})`;
  return event.type.replaceAll("_", " ");
}

function renderSessionReport() {
  currentReport = createSessionReport({
    session: engine.snapshot().session,
    decisions: decisionHistory,
    steps: STEP_META,
    outcome: completed ? "completed" : "incomplete"
  });
  reportSummary.replaceChildren();
  reportEvents.replaceChildren();
  addReportSummary("Outcome", currentReport.session.outcome);
  addReportSummary("Furthest step", `${currentReport.session.furthest_step} of ${currentReport.session.total_steps}`);
  addReportSummary("Maximum state", currentReport.session.maximum_state);
  addReportSummary("Final state", currentReport.session.final_state);
  addReportSummary("Events", currentReport.summary.total_events);
  addReportSummary("Input errors", currentReport.summary.input_errors);
  addReportSummary("Confirmed loops", currentReport.summary.confirmed_navigation_loops);
  addReportSummary("Recovery events", currentReport.summary.recovery_events);
  currentReport.events.forEach((event) => {
    const row = document.createElement("tr");
    [
      event.sequence,
      eventLabel(event),
      event.destination_step == null ? event.step : `${event.step} to ${event.destination_step}`,
      `${event.previous_state} to ${event.accepted_state}`,
      event.decision_score === event.evidence_score
        ? event.evidence_score.toFixed(1)
        : `${event.evidence_score.toFixed(1)}; decision ${event.decision_score.toFixed(1)}`,
      event.matched_rule,
      event.assistance_level
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      row.append(cell);
    });
    reportEvents.append(row);
  });
  sessionReportPanel.hidden = false;
  sessionReportTitle.focus();
  sessionReportPanel.scrollIntoView({ block: "start" });
  return currentReport;
}

function downloadReport(report) {
  const content = JSON.stringify(report, null, 2);
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `pathfinder-session-${report.session.session_id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

generateReportButton.addEventListener("click", renderSessionReport);
closeReportButton.addEventListener("click", () => {
  sessionReportPanel.hidden = true;
  generateReportButton.focus();
});
printReportButton.addEventListener("click", () => window.print());
exportReportButton.addEventListener("click", () => downloadReport(currentReport ?? renderSessionReport()));

window.__fypPrototype = Object.freeze({
  getSnapshot: () => engine.snapshot(),
  getMetrics: () => metrics.map((metric) => ({ ...metric })),
  getDecisionHistory: () => decisionHistory.map((decision) => structuredClone(decision)),
  generateSessionReport: () =>
    createSessionReport({
      session: engine.snapshot().session,
      decisions: decisionHistory,
      steps: STEP_META,
      outcome: completed ? "completed" : "incomplete"
    }),
  getCurrentStep: () => currentStep,
  isCompleted: () => completed,
  reset: () => resetApplication({ focus: false }),
  processSyntheticEvent: (input, context = {}, engineContext = {}) =>
    processInteraction(input, context, engineContext)
});

renderStep({ focus: false });
renderInitialTrace();
