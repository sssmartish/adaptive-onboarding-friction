import { aggregateSessionReports, validateSessionReport } from "./session-report.js";

const fileInput = document.querySelector("#report-files");
const importStatus = document.querySelector("#import-status");
const aggregatePanel = document.querySelector("#aggregate-panel");
const aggregateTitle = document.querySelector("#aggregate-title");
const aggregateSummary = document.querySelector("#aggregate-summary");
const aggregateGrids = document.querySelector("#aggregate-grids");
const printButton = document.querySelector("#print-aggregate-button");
const exportButton = document.querySelector("#export-aggregate-button");
const clearButton = document.querySelector("#clear-aggregate-button");
let currentAggregate = null;

function addSummary(term, value) {
  const wrapper = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = term;
  dd.textContent = String(value);
  wrapper.append(dt, dd);
  aggregateSummary.append(wrapper);
}

function appendBreakdown(title, values) {
  const section = document.createElement("section");
  section.className = "aggregate-breakdown";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);
  const entries = Object.entries(values).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No matching evidence in the imported reports.";
    section.append(empty);
  } else {
    const list = document.createElement("ol");
    list.className = "evidence-ranking";
    entries.forEach(([label, count]) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      const value = document.createElement("strong");
      name.textContent = label;
      value.textContent = String(count);
      item.append(name, value);
      list.append(item);
    });
    section.append(list);
  }
  aggregateGrids.append(section);
}

function renderAggregate(aggregate) {
  currentAggregate = aggregate;
  aggregateSummary.replaceChildren();
  aggregateGrids.replaceChildren();
  addSummary("Sessions analysed", aggregate.sessions_analysed);
  addSummary("Completed", aggregate.completed_sessions);
  addSummary("Incomplete", aggregate.incomplete_sessions);
  addSummary("Sessions with recovery", aggregate.sessions_with_recovery);
  addSummary("Input errors", aggregate.total_input_errors);
  addSummary("Confirmed loops", aggregate.total_confirmed_loops);
  appendBreakdown("Maximum state reached", aggregate.maximum_state_distribution);
  appendBreakdown("Input errors by step", aggregate.input_errors_by_step);
  appendBreakdown("Validation categories", aggregate.validation_categories);
  appendBreakdown("Confirmed loop routes", aggregate.confirmed_loop_routes);
  appendBreakdown("Adaptive-support activations", aggregate.support_activations_by_step);
  aggregatePanel.hidden = false;
  aggregateTitle.focus();
}

async function readReports(files) {
  const reports = [];
  const failures = [];
  for (const file of files) {
    try {
      const report = JSON.parse(await file.text());
      const validation = validateSessionReport(report);
      if (!validation.valid) throw new TypeError(validation.errors.join(" "));
      reports.push(report);
    } catch (error) {
      failures.push(`${file.name}: ${error.message}`);
    }
  }
  return { reports, failures };
}

function downloadBlob(name, type, content) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([content], { type }));
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function toCsv(aggregate) {
  const rows = [["section", "item", "count"]];
  const sections = {
    maximum_state: aggregate.maximum_state_distribution,
    input_errors_by_step: aggregate.input_errors_by_step,
    validation_categories: aggregate.validation_categories,
    confirmed_loop_routes: aggregate.confirmed_loop_routes,
    support_activations_by_step: aggregate.support_activations_by_step
  };
  Object.entries(sections).forEach(([section, values]) => {
    Object.entries(values).forEach(([item, count]) => rows.push([section, item, count]));
  });
  return rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
}

fileInput.addEventListener("change", async () => {
  aggregatePanel.hidden = true;
  currentAggregate = null;
  const files = [...fileInput.files];
  if (files.length === 0) {
    importStatus.textContent = "No report was selected.";
    return;
  }
  const { reports, failures } = await readReports(files);
  const successMessage = `${reports.length} valid report${reports.length === 1 ? "" : "s"} imported.`;
  importStatus.textContent = failures.length ? `${successMessage} ${failures.join(" ")}` : successMessage;
  if (reports.length > 0) renderAggregate(aggregateSessionReports(reports));
});

printButton.addEventListener("click", () => window.print());
exportButton.addEventListener("click", () => {
  if (currentAggregate) downloadBlob("pathfinder-aggregate-analysis.csv", "text/csv", toCsv(currentAggregate));
});
clearButton.addEventListener("click", () => {
  fileInput.value = "";
  aggregatePanel.hidden = true;
  aggregateSummary.replaceChildren();
  aggregateGrids.replaceChildren();
  currentAggregate = null;
  importStatus.textContent = "Imported reports were cleared from this page.";
  fileInput.focus();
});
