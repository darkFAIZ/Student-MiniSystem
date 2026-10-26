"use strict";

const STORAGE_KEY = "studywell-prototype-v1";
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const COURSE_DOTS = ["", "dot-lilac", "dot-amber", "dot-blue"];
const DEFAULT_STATE = { assignments: [], commitments: [], sessions: [], reflections: [], notifications: [] };
let state;
let activeView = "overview";
let selectedDuration = 25;
let timerRemaining = 25 * 60;
let timerInterval = null;
let timerRunning = false;
let timerAssignmentId = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, amount) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + amount);
  return result;
}

function parseDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function dayDifference(dateString) {
  const date = parseDate(dateString);
  if (!date) return null;
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((date - todayMidnight) / 86400000);
}

function dateLabel(value, options = { month: "short", day: "numeric" }) {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat("en", options).format(date) : "No date";
}

function formatDaysUntil(value) {
  const days = dayDifference(value);
  if (days === null) return "No due date";
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days <= 7) return `Due in ${days} days`;
  return `Due ${dateLabel(value)}`;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeMilestones(releaseDate, dueDate) {
  const start = parseDate(releaseDate);
  const end = parseDate(dueDate);
  if (!start || !end || end <= start) return [];
  const totalDays = Math.round((end - start) / 86400000);
  return [25, 50, 75].map((percent, index) => ({
    id: makeId(),
    title: ["Review the instructions", "Work on the main task", "Check and prepare to submit"][index],
    date: localDateString(addDays(start, Math.round(totalDays * percent / 100))),
    completed: false
  }));
}

function sampleState() {
  const today = new Date();
  const date = days => localDateString(addDays(today, days));
  const makeAssignment = (title, course, release, due, effort, instructions, contact, completedSteps = []) => ({
    id: makeId(),
    title,
    course,
    releaseDate: date(release),
    dueDate: date(due),
    effort,
    instructions,
    deliverables: instructions.split(/\r?\n/).map(text => ({ id: makeId(), text, completed: false })),
    contact,
    unclear: false,
    completedAt: null,
    milestones: makeMilestones(date(release), date(due)).map((milestone, index) => ({ ...milestone, completed: completedSteps.includes(index) }))
  });
  return {
    assignments: [
      makeAssignment("Literature review outline", "Research Methods", -8, 2, 5, "Read the brief and identify a focused topic\nCollect and compare at least five relevant sources\nDraft an outline with a clear research question\nCheck the required citation style", "lecturer@example.edu", [0]),
      makeAssignment("Database design exercise", "Information Systems", -5, 3, 3, "Review the case study\nDraw an entity relationship diagram\nCheck keys and relationships\nSubmit the final diagram", "", [0]),
      makeAssignment("Learning journal: week 4", "Learning Strategies", -9, 4, 2, "Review this week’s learning materials\nWrite a short reflection\nProofread and submit", "lecturer@example.edu", [0, 1]),
      makeAssignment("Statistics problem set", "Applied Statistics", -4, 9, 4, "Complete the assigned problems\nShow your working\nCheck your answers before submission", "", [])
    ],
    commitments: [
      { id: makeId(), name: "Part-time shift", day: 6, hours: 6 },
      { id: makeId(), name: "Family responsibilities", day: 0, hours: 3 }
    ],
    sessions: [],
    reflections: [],
    notifications: []
  };
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return sampleState();
  const parsed = JSON.parse(saved);
  if (!parsed || !Array.isArray(parsed.assignments) || !Array.isArray(parsed.commitments) ||
      !Array.isArray(parsed.sessions) || !Array.isArray(parsed.reflections) || !Array.isArray(parsed.notifications)) {
    throw new Error("Saved prototype data is invalid. Use “Reset sample data” to start again.");
  }
  return {
    ...DEFAULT_STATE,
    ...parsed,
    assignments: parsed.assignments.map(assignment => ({
      ...assignment,
      milestones: Array.isArray(assignment.milestones) ? assignment.milestones : [],
      deliverables: Array.isArray(assignment.deliverables)
        ? assignment.deliverables
        : String(assignment.instructions || "").split(/\r?\n/).map(text => text.trim()).filter(Boolean).map(text => ({ id: makeId(), text, completed: false }))
    }))
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll();
}

function showToast(message) {
  const region = $("#toast-region");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 3300);
}

function sortedPendingAssignments() {
  return state.assignments
    .filter(assignment => !assignment.completedAt)
    .sort((first, second) => {
      const byDate = (parseDate(first.dueDate)?.getTime() ?? Infinity) - (parseDate(second.dueDate)?.getTime() ?? Infinity);
      return byDate || Number(second.effort) - Number(first.effort);
    });
}

function progressFor(assignment) {
  const milestones = Array.isArray(assignment.milestones) ? assignment.milestones : [];
  return milestones.length ? Math.round(milestones.filter(item => item.completed).length / milestones.length * 100) : 0;
}

function daysSince(value) {
  const date = parseDate(value);
  if (!date) return null;
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((todayMidnight - date) / 86400000);
}

function makeNotification(title, message, key) {
  if (state.notifications.some(item => item.key === key)) return;
  state.notifications.unshift({ id: makeId(), key, title, message, createdAt: new Date().toISOString() });
}

function checkNotifications() {
  for (const assignment of state.assignments) {
    if (assignment.completedAt) continue;
    const dueIn = dayDifference(assignment.dueDate);
    if ([3, 1, 0].includes(dueIn)) {
      const stage = dueIn === 0 ? "today" : `in-${dueIn}-days`;
      makeNotification(
        dueIn === 0 ? "Due today" : `Due in ${dueIn} day${dueIn === 1 ? "" : "s"}`,
        `${assignment.title} · ${assignment.course}`,
        `reminder:${assignment.id}:${assignment.dueDate}:${stage}`
      );
    }
    const releasedFor = daysSince(assignment.releaseDate);
    const hasCompletedStep = (assignment.milestones || []).some(item => item.completed);
    if (releasedFor >= 2 && !hasCompletedStep) {
      makeNotification("A gentle nudge", `${assignment.title} has no completed milestone yet. Choose one small first step.`, `nudge:${assignment.id}:${assignment.releaseDate}`);
    }
  }
  if (state.notifications.length > 30) state.notifications.length = 30;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function renderHeader() {
  $("#today-label").textContent = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(new Date());
  $("#nav-assignment-count").textContent = String(state.assignments.filter(item => !item.completedAt).length);
  const unread = state.notifications.length;
  $("#notification-dot").hidden = unread === 0;
  $("#notification-count").textContent = `${unread} update${unread === 1 ? "" : "s"}`;
  $("#notification-list").innerHTML = unread
    ? state.notifications.slice(0, 8).map(item => `<article class="notification-item"><strong>${escapeHTML(item.title)}</strong><p>${escapeHTML(item.message)}</p></article>`).join("")
    : '<div class="notification-empty">You’re all caught up. We’ll show deadline reminders here when they’re relevant.</div>';
}

function renderStats() {
  const pending = state.assignments.filter(item => !item.completedAt);
  const dueSoon = pending.filter(item => {
    const days = dayDifference(item.dueDate);
    return days !== null && days >= 0 && days <= 3;
  }).length;
  const weekStart = startOfWeek(new Date());
  const weekEnd = addDays(weekStart, 7);
  const milestones = state.assignments.flatMap(item => item.milestones || []);
  const completedThisWeek = milestones.filter(item => item.completed && item.completedAt && new Date(item.completedAt) >= weekStart && new Date(item.completedAt) < weekEnd).length;
  const focusMinutes = state.sessions
    .filter(item => new Date(item.completedAt) >= weekStart && new Date(item.completedAt) < weekEnd)
    .reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  $("#stat-active").textContent = String(pending.length);
  $("#stat-due-soon").textContent = String(dueSoon);
  $("#stat-completed").textContent = String(completedThisWeek);
  $("#stat-completed-note").textContent = completedThisWeek ? "nice steady progress" : "one step at a time";
  $("#stat-focus").innerHTML = `${focusMinutes}<span class="value-unit">m</span>`;
  $("#stat-focus-note").textContent = focusMinutes ? "well done showing up" : "make time to focus";
}

function startOfWeek(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  return start;
}

function dueClass(dueDate) {
  const days = dayDifference(dueDate);
  if (days !== null && days < 0) return "is-overdue";
  if (days !== null && days <= 3) return "is-soon";
  return "";
}

function courseDot(index) {
  return COURSE_DOTS[index % COURSE_DOTS.length];
}

function renderNextList() {
  const pending = sortedPendingAssignments().slice(0, 4);
  $("#next-empty").hidden = state.assignments.some(item => !item.completedAt);
  if (!pending.length) {
    $("#next-list").innerHTML = "";
    return;
  }
  $("#next-list").innerHTML = pending.map((item, index) => `
    <article class="next-item">
      <button class="next-main detail-trigger" type="button" data-id="${escapeHTML(item.id)}" aria-label="Open ${escapeHTML(item.title)}">
        <span class="course-dot ${courseDot(index)}"></span>
        <span class="next-copy"><span class="next-title">${escapeHTML(item.title)}</span><span class="next-subtitle">${escapeHTML(item.course)} · ${progressFor(item)}% planned</span></span>
      </button>
      <span class="due-badge ${dueClass(item.dueDate)}">${escapeHTML(formatDaysUntil(item.dueDate))}</span>
    </article>`).join("");
}

function renderAssignments() {
  const pending = sortedPendingAssignments();
  const completed = state.assignments.filter(item => item.completedAt).sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  const ordered = [...pending, ...completed];
  $("#assignment-empty").hidden = ordered.length > 0;
  $("#assignment-list").innerHTML = ordered.map((item, index) => {
    const done = Boolean(item.completedAt);
    const progress = done ? 100 : progressFor(item);
    return `<article class="assignment-row">
      <div class="assignment-cell-title"><span class="assignment-symbol">${done ? "✓" : "✳"}</span><span><span class="assignment-name">${escapeHTML(item.title)}</span><span class="assignment-meta">${done ? "Completed" : item.unclear ? "Question flagged" : "Assignment"}</span></span></div>
      <span class="table-course">${escapeHTML(item.course)}</span>
      <span class="table-due ${done ? "" : dueClass(item.dueDate)}">${done ? "Completed" : escapeHTML(formatDaysUntil(item.dueDate))}</span>
      <span class="progress-wrap"><span class="progress-mini"><span style="width:${progress}%"></span></span><span class="progress-percent">${progress}%</span></span>
      <span class="table-effort">${escapeHTML(String(item.effort))} hrs</span>
      <button class="table-open detail-trigger" type="button" data-id="${escapeHTML(item.id)}" aria-label="Open ${escapeHTML(item.title)}">↗</button>
    </article>`;
  }).join("");
}

function renderWorkload() {
  const total = state.commitments.reduce((sum, item) => sum + Number(item.hours || 0), 0);
  $("#workload-hours").textContent = total % 1 ? total.toFixed(1) : String(total);
  $("#workload-bar-fill").style.width = `${Math.min(total / 35 * 100, 100)}%`;
  $("#commitment-count").textContent = `${state.commitments.length} commitment${state.commitments.length === 1 ? "" : "s"}`;
  const preview = $("#commitment-preview");
  preview.innerHTML = state.commitments.length
    ? state.commitments.slice(0, 3).map(item => `<div class="commitment-preview-row"><span>${escapeHTML(item.name)}</span><span>${DAY_LABELS[item.day]} · ${escapeHTML(String(item.hours))}h</span></div>`).join("")
    : '<div class="empty-commitment-note">No recurring commitments yet. Add any regular commitments to plan around them.</div>';
}

function findDeadlineCluster() {
  const deadlines = state.assignments
    .filter(item => !item.completedAt)
    .map(item => ({ item, date: parseDate(item.dueDate) }))
    .filter(entry => entry.date)
    .sort((a, b) => a.date - b.date);
  for (let start = 0; start < deadlines.length; start++) {
    const endWindow = addDays(deadlines[start].date, 2);
    const cluster = deadlines.slice(start).filter(entry => entry.date <= endWindow);
    if (cluster.length >= 3) return cluster;
  }
  return [];
}

function renderDeadlineAlert() {
  const alert = $("#deadline-alert");
  const cluster = findDeadlineCluster();
  alert.hidden = cluster.length === 0;
  if (!cluster.length) return;
  const labels = cluster.slice(0, 4).map(entry => escapeHTML(entry.item.title)).join(", ");
  alert.innerHTML = `<span class="alert-symbol" aria-hidden="true">◷</span><div><strong>A busy deadline window is coming up.</strong><p>${cluster.length} assignments fall within three consecutive days: ${labels}. Take a look at your plan and commitments, and choose a manageable next step.</p></div>`;
}

function renderWeek() {
  const upcoming = sortedPendingAssignments();
  $("#week-deadline-empty").hidden = upcoming.length > 0;
  $("#week-deadline-list").innerHTML = upcoming.map((item, index) => {
    const due = parseDate(item.dueDate);
    return `<article class="week-deadline-row">
      <div class="date-block"><strong>${due ? due.getDate() : "—"}</strong><span>${due ? new Intl.DateTimeFormat("en", { month: "short" }).format(due) : "date"}</span></div>
      <button class="next-main detail-trigger" type="button" data-id="${escapeHTML(item.id)}"><span class="course-dot ${courseDot(index)}"></span><span class="next-copy"><span class="next-title">${escapeHTML(item.title)}</span><span class="next-subtitle">${escapeHTML(item.course)} · ${escapeHTML(String(item.effort))} estimated hours</span></span></button>
      <span class="due-badge ${dueClass(item.dueDate)}">${escapeHTML(formatDaysUntil(item.dueDate))}</span>
    </article>`;
  }).join("");

  const commitments = [...state.commitments].sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
  $("#commitment-list").innerHTML = commitments.map(item => `
    <article class="commitment-row">
      <span class="commitment-day">${escapeHTML(DAY_LABELS[item.day] || "Day")}</span>
      <span class="commitment-name">${escapeHTML(item.name)}</span>
      <span class="commitment-hours">${escapeHTML(String(item.hours))} hrs</span>
      <button type="button" class="remove-commitment" data-remove-commitment="${escapeHTML(item.id)}" aria-label="Remove ${escapeHTML(item.name)}">×</button>
    </article>`).join("");
  const total = commitments.reduce((sum, item) => sum + Number(item.hours || 0), 0);
  $("#weekly-commitment-total").textContent = `${Number.isInteger(total) ? total : total.toFixed(1)} ${total === 1 ? "hour" : "hours"}`;
}

function renderFocus() {
  const select = $("#focus-assignment");
  const previous = select.value;
  const choices = sortedPendingAssignments();
  select.innerHTML = choices.length
    ? choices.map(item => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.title)} · ${escapeHTML(item.course)}</option>`).join("")
    : '<option value="">Add an assignment to start a focus session</option>';
  if (choices.some(item => item.id === previous)) select.value = previous;
  select.disabled = choices.length === 0 || timerRunning;
  const sessions = [...state.sessions].sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 5);
  $("#focus-history-empty").hidden = sessions.length > 0;
  $("#focus-history-list").innerHTML = sessions.map(item => {
    const date = new Date(item.completedAt);
    const label = Number.isNaN(date.getTime()) ? "Completed" : new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(date);
    return `<div class="focus-history-row"><div><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(label)}</span></div><span class="history-duration">${escapeHTML(String(item.minutes))} min</span></div>`;
  }).join("");
}

function currentWeekKey() {
  return localDateString(startOfWeek(new Date()));
}

function renderReflection() {
  const key = currentWeekKey();
  const date = parseDate(key);
  const end = date ? addDays(date, 6) : new Date();
  $("#reflection-week-label").textContent = `Week of ${dateLabel(key, { month: "long", day: "numeric" })} – ${dateLabel(localDateString(end), { month: "long", day: "numeric" })}`;
  const entry = state.reflections.find(item => item.weekOf === key);
  const form = $("#reflection-form");
  for (const field of ["wentWell", "gotInWay", "nextStep"]) {
    form.elements[field].value = entry?.[field] || "";
  }
  $("#reflection-saved").textContent = entry ? "Saved for this week" : "";
  const prompt = $("#reflection-prompt");
  if (prompt) prompt.hidden = Boolean(entry);
}

function renderAll() {
  renderHeader();
  renderStats();
  renderNextList();
  renderAssignments();
  renderWorkload();
  renderDeadlineAlert();
  renderWeek();
  renderFocus();
  renderReflection();
}

function showView(viewName) {
  if (!$("#view-" + viewName)) return;
  activeView = viewName;
  $$(".view").forEach(view => {
    const isActive = view.id === `view-${viewName}`;
    view.classList.toggle("is-visible", isActive);
    view.hidden = !isActive;
  });
  $$(".nav-link").forEach(link => link.classList.toggle("is-active", link.dataset.view === viewName));
  $("#breadcrumb-current").textContent = ({
    overview: "Overview", assignments: "Assignments", week: "Weekly plan", focus: "Focus session", reflection: "Weekly reflection"
  })[viewName];
  $("#sidebar").classList.remove("is-open");
  $("#mobile-menu").setAttribute("aria-expanded", "false");
  if (viewName === "reflection") renderReflection();
}

function openAssignmentForm(assignment = null) {
  const form = $("#assignment-form");
  form.reset();
  form.elements.id.value = assignment?.id || "";
  form.elements.title.value = assignment?.title || "";
  form.elements.course.value = assignment?.course || "";
  form.elements.effort.value = String(assignment?.effort || 1);
  form.elements.releaseDate.value = assignment?.releaseDate || localDateString(new Date());
  form.elements.dueDate.value = assignment?.dueDate || localDateString(addDays(new Date(), 7));
  form.elements.instructions.value = assignment?.instructions || "";
  form.elements.contact.value = assignment?.contact || "";
  $("#assignment-dialog-title").textContent = assignment ? "Edit assignment" : "Add an assignment";
  $("#assignment-error").hidden = true;
  $("#assignment-dialog").showModal();
}

function validateContact(value) {
  const contact = value.trim();
  if (!contact) return "";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return `mailto:${contact}`;
  try {
    const parsed = new URL(contact);
    return ["https:", "http:", "mailto:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function handleAssignmentSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const releaseDate = String(data.get("releaseDate"));
  const dueDate = String(data.get("dueDate"));
  const release = parseDate(releaseDate);
  const due = parseDate(dueDate);
  const error = $("#assignment-error");
  const contact = validateContact(String(data.get("contact") || ""));
  let message = "";
  if (!release || !due || due <= release) message = "Choose a due date that is at least one day after the release date.";
  else if (contact === null) message = "Enter a valid email address or a link beginning with http:// or https://.";
  if (message) {
    error.textContent = message;
    error.hidden = false;
    return;
  }
  const id = String(data.get("id") || "");
  const existing = state.assignments.find(item => item.id === id);
  const title = String(data.get("title")).trim();
  const dueDateChanged = existing && existing.dueDate !== dueDate;
  const instructionText = String(data.get("instructions") || "").trim();
  const deliverableTexts = instructionText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const oldDeliverables = [...(existing?.deliverables || [])];
  const deliverables = deliverableTexts.map(text => {
    const oldIndex = oldDeliverables.findIndex(item => item.text === text);
    const old = oldIndex >= 0 ? oldDeliverables.splice(oldIndex, 1)[0] : null;
    return { id: old?.id || makeId(), text, completed: old?.text === text ? Boolean(old.completed) : false };
  });
  let milestones = existing?.milestones || [];
  if (!existing || existing.releaseDate !== releaseDate || existing.dueDate !== dueDate) {
    const suggestions = makeMilestones(releaseDate, dueDate);
    milestones = suggestions.map((suggestion, index) => ({
      ...suggestion,
      completed: Boolean(existing?.milestones?.[index]?.completed),
      completedAt: existing?.milestones?.[index]?.completedAt || null
    }));
  }
  const assignment = {
    id: existing?.id || makeId(),
    title,
    course: String(data.get("course")).trim(),
    releaseDate,
    dueDate,
    effort: Number(data.get("effort")),
    instructions: instructionText,
    deliverables,
    contact: String(data.get("contact") || "").trim(),
    unclear: existing?.unclear || false,
    completedAt: existing?.completedAt || null,
    milestones
  };
  if (existing) {
    state.assignments = state.assignments.map(item => item.id === id ? assignment : item);
    if (dueDateChanged) makeNotification("Due date updated", `${title} is now due ${dateLabel(dueDate, { month: "short", day: "numeric", year: "numeric" })}.`, `changed:${id}:${new Date().toISOString()}`);
  } else {
    state.assignments.push(assignment);
  }
  checkNotifications();
  saveState();
  $("#assignment-dialog").close();
  showToast(existing ? "Assignment updated." : "Assignment added with three suggested milestones.");
  if (existing) openAssignmentDetail(assignment.id);
}

function dueDateStatus(assignment) {
  if (assignment.completedAt) return "Completed";
  return formatDaysUntil(assignment.dueDate);
}

function safeContactHref(contact) {
  const value = validateContact(contact || "");
  return value || "";
}

function openAssignmentDetail(id) {
  const assignment = state.assignments.find(item => item.id === id);
  if (!assignment) return;
  const done = Boolean(assignment.completedAt);
  const milestones = assignment.milestones || [];
  const progress = done ? 100 : progressFor(assignment);
  const contactHref = safeContactHref(assignment.contact);
  const detail = $("#detail-content");
  detail.innerHTML = `
    <header class="detail-header">
      <div><span class="detail-course">${escapeHTML(assignment.course)}</span><h2 id="detail-title">${escapeHTML(assignment.title)}</h2></div>
      <div class="detail-header-actions"><button class="detail-icon-button" type="button" data-edit-assignment="${escapeHTML(assignment.id)}" aria-label="Edit assignment">✎</button><button class="detail-icon-button detail-close" type="button" data-close-detail aria-label="Close">×</button></div>
    </header>
    <div class="detail-stats">
      <div class="detail-stat"><span>DUE DATE</span><strong>${escapeHTML(dateLabel(assignment.dueDate, { month: "short", day: "numeric", year: "numeric" }))}</strong></div>
      <div class="detail-stat"><span>EFFORT ESTIMATE</span><strong>${escapeHTML(String(assignment.effort))} hours</strong></div>
      <div class="detail-stat"><span>PROGRESS</span><strong>${progress}% · ${escapeHTML(dueDateStatus(assignment))}</strong></div>
    </div>
    ${assignment.instructions ? `<section class="detail-section"><h3>Instructions &amp; deliverables</h3><div class="deliverable-list">${(assignment.deliverables || []).map(item => `<label class="deliverable-item ${item.completed ? "is-done" : ""}"><input type="checkbox" data-deliverable="${escapeHTML(item.id)}" data-assignment="${escapeHTML(assignment.id)}" ${item.completed ? "checked" : ""} ${done ? "disabled" : ""}><span>${escapeHTML(item.text)}</span></label>`).join("")}</div></section>` : ""}
    <section class="detail-section"><h3>Suggested milestones <span class="label-hint">· ${milestones.filter(item => item.completed).length} of ${milestones.length} complete</span></h3>
      <div class="checklist">${milestones.length ? milestones.map(item => `<div class="milestone-row ${item.completed ? "is-done" : ""}">
        <input type="checkbox" data-milestone="${escapeHTML(item.id)}" data-assignment="${escapeHTML(assignment.id)}" aria-label="Mark ${escapeHTML(item.title)} complete" ${item.completed ? "checked" : ""} ${done ? "disabled" : ""}>
        <input class="milestone-title-input" type="text" value="${escapeHTML(item.title)}" maxlength="120" data-milestone-title="${escapeHTML(item.id)}" data-assignment="${escapeHTML(assignment.id)}" aria-label="Milestone name" ${done ? "disabled" : ""}>
        <input class="milestone-date-input" type="date" value="${escapeHTML(item.date)}" data-milestone-date="${escapeHTML(item.id)}" data-assignment="${escapeHTML(assignment.id)}" aria-label="Milestone date" ${done ? "disabled" : ""}>
        <button class="milestone-remove" type="button" data-remove-milestone="${escapeHTML(item.id)}" data-assignment="${escapeHTML(assignment.id)}" aria-label="Remove ${escapeHTML(item.title)}" ${done ? "disabled" : ""}>×</button>
      </div>`).join("") : '<span class="label-hint">No milestones yet. Add a small step to get started.</span>'}</div>
      ${done ? "" : `<button class="add-milestone-button" type="button" data-add-milestone="${escapeHTML(assignment.id)}">+ Add a step</button>`}
    </section>
    <section class="detail-section"><div class="unclear-control"><span>Need clarification on these instructions?</span><button class="unclear-button ${assignment.unclear ? "is-flagged" : ""}" type="button" data-toggle-unclear="${escapeHTML(assignment.id)}">${assignment.unclear ? "Question flagged" : "Flag as unclear"}</button></div></section>
    ${contactHref ? `<section class="detail-section"><h3>Ask for help</h3><a class="contact-link" href="${escapeHTML(contactHref)}" ${contactHref.startsWith("http") ? 'target="_blank" rel="noopener noreferrer"' : ""}>Open contact link <span aria-hidden="true">↗</span></a></section>` : ""}
    <footer class="detail-footer">
      <div class="detail-footer-left"><button class="danger-button" type="button" data-delete-assignment="${escapeHTML(assignment.id)}">Delete</button>${done ? "" : `<button class="button button-secondary button-small" type="button" data-complete-assignment="${escapeHTML(assignment.id)}">Mark submitted</button>`}</div>
      <div class="detail-footer-right">${done ? `<button class="button button-secondary button-small" type="button" data-reopen-assignment="${escapeHTML(assignment.id)}">Reopen</button>` : ""}<button class="button button-primary button-small" type="button" data-start-focus="${escapeHTML(assignment.id)}">Focus on this</button></div>
    </footer>`;
  $("#detail-dialog").showModal();
}

function markAssignmentDone(id) {
  state.assignments = state.assignments.map(item => item.id === id ? { ...item, completedAt: new Date().toISOString() } : item);
  saveState();
  $("#detail-dialog").close();
  showToast("Assignment marked as submitted. Nice work.");
}

function markAssignmentOpen(id) {
  state.assignments = state.assignments.map(item => item.id === id ? { ...item, completedAt: null } : item);
  saveState();
  openAssignmentDetail(id);
}

function toggleMilestone(assignmentId, milestoneId, completed) {
  state.assignments = state.assignments.map(assignment => {
    if (assignment.id !== assignmentId) return assignment;
    return { ...assignment, milestones: (assignment.milestones || []).map(item => item.id === milestoneId ? { ...item, completed, completedAt: completed ? new Date().toISOString() : null } : item) };
  });
  saveState();
  openAssignmentDetail(assignmentId);
}

function toggleDeliverable(assignmentId, deliverableId, completed) {
  state.assignments = state.assignments.map(assignment => {
    if (assignment.id !== assignmentId) return assignment;
    return { ...assignment, deliverables: (assignment.deliverables || []).map(item => item.id === deliverableId ? { ...item, completed } : item) };
  });
  saveState();
  openAssignmentDetail(assignmentId);
}

function updateMilestone(assignmentId, milestoneId, updates) {
  state.assignments = state.assignments.map(assignment => {
    if (assignment.id !== assignmentId) return assignment;
    return { ...assignment, milestones: (assignment.milestones || []).map(item => item.id === milestoneId ? { ...item, ...updates } : item) };
  });
  saveState();
  openAssignmentDetail(assignmentId);
}

function addMilestone(assignmentId) {
  const assignment = state.assignments.find(item => item.id === assignmentId);
  if (!assignment || assignment.completedAt) return;
  const milestone = { id: makeId(), title: "New task", date: assignment.dueDate, completed: false, completedAt: null };
  state.assignments = state.assignments.map(item => item.id === assignmentId ? { ...item, milestones: [...(item.milestones || []), milestone] } : item);
  saveState();
  openAssignmentDetail(assignmentId);
}

function removeMilestone(assignmentId, milestoneId) {
  const assignment = state.assignments.find(item => item.id === assignmentId);
  const milestone = assignment?.milestones?.find(item => item.id === milestoneId);
  if (!assignment || !milestone || !window.confirm(`Remove “${milestone.title}” from this plan?`)) return;
  state.assignments = state.assignments.map(item => item.id === assignmentId ? { ...item, milestones: item.milestones.filter(step => step.id !== milestoneId) } : item);
  saveState();
  openAssignmentDetail(assignmentId);
}

function updateMilestoneDate(assignmentId, milestoneId, value) {
  const assignment = state.assignments.find(item => item.id === assignmentId);
  const date = parseDate(value);
  const release = parseDate(assignment?.releaseDate);
  const due = parseDate(assignment?.dueDate);
  if (!date || !release || !due || date < release || date > due) {
    showToast("Choose a milestone date between the release date and the due date.");
    openAssignmentDetail(assignmentId);
    return;
  }
  updateMilestone(assignmentId, milestoneId, { date: value });
}

function updateMilestoneTitle(assignmentId, milestoneId, value) {
  const title = value.trim();
  if (!title) {
    showToast("A milestone needs a name.");
    openAssignmentDetail(assignmentId);
    return;
  }
  updateMilestone(assignmentId, milestoneId, { title });
}

function deleteAssignment(id) {
  const assignment = state.assignments.find(item => item.id === id);
  if (!assignment || !window.confirm(`Delete “${assignment.title}” and its milestones?`)) return;
  state.assignments = state.assignments.filter(item => item.id !== id);
  saveState();
  $("#detail-dialog").close();
  showToast("Assignment deleted.");
}

function toggleCommitmentForm(show) {
  const form = $("#commitment-form");
  form.hidden = !show;
  $("#add-commitment-button").hidden = show;
  if (show) form.elements.name.focus();
}

function handleCommitmentSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.commitments.push({
    id: makeId(),
    name: String(data.get("name")).trim(),
    day: Number(data.get("day")),
    hours: Number(data.get("hours"))
  });
  saveState();
  event.currentTarget.reset();
  toggleCommitmentForm(false);
  showToast("Recurring commitment saved.");
}

function completeFocusSession() {
  const assignment = state.assignments.find(item => item.id === timerAssignmentId);
  if (!assignment) {
    showToast("Choose an assignment before starting a focus session.");
    resetTimer();
    return;
  }
  state.sessions.push({ id: makeId(), assignmentId: assignment.id, title: assignment.title, minutes: selectedDuration, completedAt: new Date().toISOString() });
  saveState();
  showToast(`${selectedDuration}-minute focus session completed. Well done.`);
  timerRunning = false;
  clearInterval(timerInterval);
  timerInterval = null;
  timerRemaining = 0;
  timerAssignmentId = null;
  renderFocus();
  updateTimerUI();
}

function updateTimerUI() {
  const minutes = Math.floor(timerRemaining / 60);
  const seconds = timerRemaining % 60;
  $("#timer-display").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  const elapsed = selectedDuration * 60 - timerRemaining;
  const degrees = selectedDuration ? Math.max(0, Math.min(360, elapsed / (selectedDuration * 60) * 360)) : 0;
  $("#timer-ring").style.background = `conic-gradient(#84ad97 ${degrees}deg, #eaf1eb ${degrees}deg)`;
  $("#timer-caption").textContent = timerRunning ? "YOU’RE IN A FOCUS SESSION" : timerRemaining === 0 ? "SESSION COMPLETE" : "READY WHEN YOU ARE";
  $("#timer-start").innerHTML = timerRunning
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12"/></svg> Pause session'
    : timerRemaining < selectedDuration * 60 ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 10 6-10 6V6Z"/></svg> Resume focus'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 10 6-10 6V6Z"/></svg> Start focus';
  $("#timer-reset").hidden = timerRemaining === selectedDuration * 60;
}

function startTimer() {
  if (timerRunning) {
    timerRunning = false;
    clearInterval(timerInterval);
    timerInterval = null;
    updateTimerUI();
    return;
  }
  if (timerRemaining === 0) resetTimer();
  if (!$("#focus-assignment").value) {
    showToast("Add an assignment before starting a focus session.");
    return;
  }
  timerRunning = true;
  timerAssignmentId = $("#focus-assignment").value;
  updateTimerUI();
  timerInterval = window.setInterval(() => {
    timerRemaining -= 1;
    if (timerRemaining <= 0) {
      timerRemaining = 0;
      updateTimerUI();
      completeFocusSession();
    } else {
      updateTimerUI();
    }
  }, 1000);
}

function resetTimer() {
  timerRunning = false;
  clearInterval(timerInterval);
  timerInterval = null;
  timerAssignmentId = null;
  timerRemaining = selectedDuration * 60;
  updateTimerUI();
}

function setDuration(minutes) {
  if (timerRunning) return;
  selectedDuration = minutes;
  $$(".duration-button").forEach(button => button.classList.toggle("is-selected", Number(button.dataset.minutes) === minutes));
  resetTimer();
}

function handleReflectionSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const entry = {
    weekOf: currentWeekKey(),
    wentWell: form.elements.wentWell.value.trim(),
    gotInWay: form.elements.gotInWay.value.trim(),
    nextStep: form.elements.nextStep.value.trim(),
    savedAt: new Date().toISOString()
  };
  const existing = state.reflections.some(item => item.weekOf === entry.weekOf);
  state.reflections = [...state.reflections.filter(item => item.weekOf !== entry.weekOf), entry];
  saveState();
  $("#reflection-saved").textContent = "Saved for this week";
  showToast(existing ? "Reflection updated." : "Reflection saved. Thanks for checking in.");
}

function resetDemoData() {
  if (!window.confirm("Reset this browser’s prototype data to the sample workspace? Your assignments, notes, and sessions will be removed.")) return;
  state = sampleState();
  saveState();
  resetTimer();
  showView("overview");
  showToast("Sample workspace restored.");
}

function setupEvents() {
  document.addEventListener("click", event => {
    const viewControl = event.target.closest("[data-view]");
    if (viewControl) {
      showView(viewControl.dataset.view);
      return;
    }
    const newAssignment = event.target.closest('[data-action="new-assignment"]');
    if (newAssignment) {
      openAssignmentForm();
      return;
    }
    const detailTrigger = event.target.closest(".detail-trigger");
    if (detailTrigger) {
      openAssignmentDetail(detailTrigger.dataset.id);
      return;
    }
    const edit = event.target.closest("[data-edit-assignment]");
    if (edit) {
      const assignment = state.assignments.find(item => item.id === edit.dataset.editAssignment);
      if (assignment) {
        $("#detail-dialog").close();
        openAssignmentForm(assignment);
      }
      return;
    }
    const closeDialog = event.target.closest("[data-close-dialog]");
    if (closeDialog) {
      $("#assignment-dialog").close();
      return;
    }
    if (event.target.closest("[data-close-detail]")) {
      $("#detail-dialog").close();
      return;
    }
    const completed = event.target.closest("[data-complete-assignment]");
    if (completed) {
      markAssignmentDone(completed.dataset.completeAssignment);
      return;
    }
    const reopened = event.target.closest("[data-reopen-assignment]");
    if (reopened) {
      markAssignmentOpen(reopened.dataset.reopenAssignment);
      return;
    }
    const deleted = event.target.closest("[data-delete-assignment]");
    if (deleted) {
      deleteAssignment(deleted.dataset.deleteAssignment);
      return;
    }
    const unclear = event.target.closest("[data-toggle-unclear]");
    if (unclear) {
      const assignment = state.assignments.find(item => item.id === unclear.dataset.toggleUnclear);
      if (assignment) {
        state.assignments = state.assignments.map(item => item.id === assignment.id ? { ...item, unclear: !item.unclear } : item);
        saveState();
        openAssignmentDetail(assignment.id);
        showToast(assignment.unclear ? "Clarification flag removed." : "Question flagged so you can follow up.");
      }
      return;
    }
    const addStep = event.target.closest("[data-add-milestone]");
    if (addStep) {
      addMilestone(addStep.dataset.addMilestone);
      return;
    }
    const removeStep = event.target.closest("[data-remove-milestone]");
    if (removeStep) {
      removeMilestone(removeStep.dataset.assignment, removeStep.dataset.removeMilestone);
      return;
    }
    const focusFromDetail = event.target.closest("[data-start-focus]");
    if (focusFromDetail) {
      const id = focusFromDetail.dataset.startFocus;
      if (timerRunning && timerAssignmentId !== id) {
        showToast("Pause your current session before switching assignments.");
        return;
      }
      $("#detail-dialog").close();
      showView("focus");
      $("#focus-assignment").value = id;
      return;
    }
    const removeCommitment = event.target.closest("[data-remove-commitment]");
    if (removeCommitment) {
      state.commitments = state.commitments.filter(item => item.id !== removeCommitment.dataset.removeCommitment);
      saveState();
      showToast("Commitment removed.");
      return;
    }
    const duration = event.target.closest("[data-minutes]");
    if (duration) {
      setDuration(Number(duration.dataset.minutes));
      return;
    }
    if (event.target.closest("#timer-start")) {
      startTimer();
      return;
    }
    if (event.target.closest("#timer-reset")) {
      resetTimer();
      return;
    }
    if (event.target.closest("#notification-button")) {
      const panel = $("#notification-panel");
      panel.hidden = !panel.hidden;
      $("#notification-button").setAttribute("aria-expanded", String(!panel.hidden));
      return;
    }
    if (event.target.closest("#mobile-menu")) {
      const sidebar = $("#sidebar");
      sidebar.classList.toggle("is-open");
      $("#mobile-menu").setAttribute("aria-expanded", String(sidebar.classList.contains("is-open")));
      return;
    }
    if (event.target.closest("#open-commitment-form") || event.target.closest("#add-commitment-button")) {
      toggleCommitmentForm(true);
      return;
    }
    if (event.target.closest("#cancel-commitment")) {
      toggleCommitmentForm(false);
      return;
    }
    if (event.target.closest("#reset-demo")) resetDemoData();
  });

  $("#assignment-form").addEventListener("submit", handleAssignmentSubmit);
  $("#commitment-form").addEventListener("submit", handleCommitmentSubmit);
  $("#reflection-form").addEventListener("submit", handleReflectionSubmit);
  $("#focus-assignment").addEventListener("change", () => {
    if (!timerRunning) {
      timerRemaining = selectedDuration * 60;
      updateTimerUI();
    }
  });
  document.addEventListener("change", event => {
    const checkbox = event.target.closest("[data-milestone]");
    if (checkbox) {
      toggleMilestone(checkbox.dataset.assignment, checkbox.dataset.milestone, checkbox.checked);
      return;
    }
    const deliverable = event.target.closest("[data-deliverable]");
    if (deliverable) {
      toggleDeliverable(deliverable.dataset.assignment, deliverable.dataset.deliverable, deliverable.checked);
      return;
    }
    const dateInput = event.target.closest("[data-milestone-date]");
    if (dateInput) {
      updateMilestoneDate(dateInput.dataset.assignment, dateInput.dataset.milestoneDate, dateInput.value);
      return;
    }
    const titleInput = event.target.closest("[data-milestone-title]");
    if (titleInput) updateMilestoneTitle(titleInput.dataset.assignment, titleInput.dataset.milestoneTitle, titleInput.value);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      $("#notification-panel").hidden = true;
      $("#notification-button").setAttribute("aria-expanded", "false");
      $("#sidebar").classList.remove("is-open");
      $("#mobile-menu").setAttribute("aria-expanded", "false");
    }
  });
}

function initialize() {
  state = loadState();
  checkNotifications();
  setupEvents();
  renderAll();
  updateTimerUI();
  showView(activeView);
}

initialize();
