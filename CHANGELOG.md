# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.5.0] — 2026-05-04

### Added
- Undo toast for Reset: clicking "Reset to Imported" now executes immediately and shows a 15-second toast with an Undo button — restores the pre-reset task list on click; replaces the blocking `confirm()` dialog
- Toast notification system: shared `showToast(msg, undoFn, duration)` infrastructure used by Reset, row reorder, and Add Task; slides in from bottom-right, auto-dismisses, respects `prefers-reduced-motion`
- Row reorder toast: after dragging a task to a new position a toast reads "Tasks renumbered — check spec dependency links."
- Add Task toast: after adding a task a toast reads "Task added to [Phase Name]."
- Specifications table: click any column header to sort — flat sorted view replaces category grouping when a sort is active; Status column uses domain-natural order (At Risk → TBD → Target → Achieved); click again to reverse; active column shows ↑/↓ indicator, inactive columns show ↕

### Changed
- "💾 Save to Excel" renamed to "Export to Excel" (topbar button + help modal reference) — removes the anachronistic floppy disk emoji and uses standard terminology
- Gantt toolbar action-zone divider margin balanced (`0 2px 0 6px` → `0 8px`) — clearer separation between view controls and action controls
- Help modal Gantt Chart description updated: "click any task name, team, or % to edit inline" — surfaces the inline-edit interaction model that was previously undiscoverable
- Light mode palette reverted to v1.4.3 values (`--bg #edecea`) — v1.4.4 darkening reversed per user decision

---

## [1.4.4] — 2026-05-04

### Changed
- Light mode background darkened to L\*84 warm stone gray: `--bg #d8d5cf`, `--surface #cec9c3`, `--border #b5b0aa` — previous value (#edecea, L\*92) was still perceived as near-white; this commit commits to a specific ergonomic target rather than nudging
- Light mode `--muted` darkened: `#5a6370` → `#4e5760` — maintains ≥5.2:1 contrast ratio against the new darker background
- Gantt header month labels and org chart node title text updated to the new muted value in light mode

---

## [1.4.3] — 2026-05-04

### Added
- Dim mode — a third theme between dark and light: `--bg #22272e`, `--surface #2d333b`, `--border #444c56`, `--text #adbac7` — targets ~35% luminance for comfortable sustained-focus work in mixed-light environments; SVG renders with dark-mode colors
- Theme now cycles dark → dim → light → dark; button icon reflects current state (`🌙` dark · `🌓` dim · `☀` light); tooltip reads "Theme: Dark / Dim / Light"

### Fixed
- Mini calendar no longer closes when clicking the theme toggle button — the click-outside-to-dismiss listener now correctly excludes the theme toggle

### Changed
- Theme transition CSS wrapped in `@media (prefers-reduced-motion: no-preference)` — users with reduced-motion OS preference no longer receive the background-color transition

---

## [1.4.2] — 2026-05-04

### Changed
- Light mode palette shifted to a warmer, softer neutral: `--bg #edecea`, `--surface #e2e0dc`, `--border #cac7c2` — reduces eye strain vs. the previous near-white; surfaces now clearly distinct from the background
- Light mode `--muted` darkened: `#636c76` → `#5a6370` — improves small-text contrast from ~5.1:1 to ~5.8:1
- Org chart node cards in light mode: fill changed from pure `#ffffff` to `#f4f2ef` — warm elevated tone, no longer a harsh white hole against the soft page background
- Theme toggle now re-renders the org chart (same pattern as Gantt) so node card colors update immediately without a tab switch
- Dark ↔ light transition smoothed: a `theme-changing` class applies a 220ms `background-color`/`color`/`border-color` transition on key structural elements during the toggle only — hover states are unaffected
- Reset button renamed "Reset to Imported" for clarity; now requires confirmation: *"Reset to imported state? All edits will be lost."*
- Gantt bar drag: minimum 4px movement threshold before drag activates — prevents accidental bar moves when clicking a bar to inspect it; click-only interactions no longer trigger a re-render

### Fixed
- Calendar badge font size raised from `0.65rem` (10.4px) to `0.72rem` (11.5px) — was below the 11px accessibility minimum
- Calendar day cells converted from `<div onclick>` to `<button type="button">` — keyboard-focusable and correctly announced as interactive by screen readers (WCAG 2.1 Level A)

---

## [1.4.1] — 2026-05-03

### Security
- Apply `esc()` to task WBS, name (×2: `title` attribute + text), and team (×2: `title` attribute + text) in Gantt row `innerHTML` — same pattern as the v1.2.1 XSS sweep; these five injection points were missed in that pass

### Fixed
- Org chart drag-pan: `mousemove`/`mouseup` document listeners were re-added on every `renderOrgChart()` call, causing ghost-drag stutter after loading multiple files; listeners are now guarded with a module-level flag and attached once only

---

## [1.4] — 2026-05-03

### Added
- Mini calendar widget in Gantt toolbar (📅 toggle button): shows current month with colored diamond markers for milestones and 2px phase-color top-borders on phase-start days; count badge when multiple milestones fall on the same date. Click any date to scroll the Gantt to that date and auto-collapse the calendar. Navigate with ‹/› arrows; empty months display with no filler markers.

### Changed
- Program Dashboard team workload rows: click handler converted from inline `onclick` to `addEventListener` — consistent with the rest of the event model
- Weight Budget hover tooltip: `onmouseenter`/`onmousemove`/`onmouseleave` attributes removed from bar template; replaced with `addEventListener` after DOM insertion
- Calendar widget converted from in-flow layout to `position: absolute` overlay — no longer displaces the Gantt chart when opened; floats over it with a drop shadow and rounded corners; click outside to dismiss
- Calendar typography increased: day numbers `0.82rem`, day headers `0.72rem`, legend and badge `0.72rem`/`0.65rem`; width fixed at `308px`
- Calendar day columns shaded by work-day status: non-work-day headers and cells are visually muted, matching the project's configured work days
- Calendar hover tooltip: hovering a milestone or phase-start day shows a tooltip with the task name(s) or phase name — reuses the shared `#tooltip` element
- Calendar row height normalized: every day cell always renders the marker slot so rows are uniform height regardless of whether a milestone or phase marker is present

### Fixed
- Browse for File: file input value now reset after each load so the same file can be re-selected without reloading the page

---

## [1.3] — 2026-05-03

### Added
- Org chart matrix reporting: `Reports To` column now accepts comma-separated names (`Primary, Secondary`). The first name determines tree position; additional names render as dashed lines. Existing single-manager files are unaffected.

### Fixed
- Org chart node cards in light mode now have a drop shadow for visual depth; hover state changed from flat grey to a team-color tint (correct interaction feedback direction)
- Weight budget target line (│) now renders as a dark line in light mode — was white-on-light and nearly invisible

---

## [1.2.1] — 2026-05-03

### Security
- Apply `esc()` to phase name labels in Gantt phase filter dropdown — values come from `S.info` (Excel)
- Apply `esc()` to team names in Gantt team filter dropdown (both `value` attribute and display text) — values come from `S.tasks[].team` (Excel)
- Apply `esc()` to subsystem name in weight budget tooltip `innerHTML` — value comes from `w.subsystem` (Excel)
- Apply `esc()` to `w.subsystem` and `w.group` in weight budget bar `title` and `data-name` HTML attributes — unescaped `"` in either could break the surrounding attribute

---

## [1.2] — 2026-05-03

### Changed
- Light mode background softened: `--bg` changed from pure white `#ffffff` to `#f0f2f5`; `--surface` from `#f6f8fa` to `#e8eaed` — reduces glare for long reading sessions
- Gantt timeline split into a sticky header SVG (month/week labels, Today marker) and a scrollable body SVG — header remains visible while scrolling through long task lists
- Theme toggle now immediately re-renders the Gantt SVG so header colors update without requiring a page reload
- Non-work-day column shading removed — visual noise reduction; work-day snap and WD column counts are unaffected
- Vertical week sub-lines extended into the task body area at zoom ≥ 5 (previously header-only); month boundary lines remain the primary full-height grid

---

## [1.1] — 2026-05-03

### Security
- Vendor SheetJS 0.20.3 locally as `xlsx.full.min.js` — eliminates CDN dependency, enables fully offline use, and removes trust in a remote script host
- Add `esc()` HTML-escaping helper applied at every `innerHTML` injection point — prevents XSS from malicious Excel cell content
- Replace all inline `onclick` handlers in side panels with `data-attribute` + `addEventListener` delegation — removes script injection surface in dynamically generated HTML

### Fixed
- Gantt scroll position no longer resets to today on every edit or drag — auto-scroll fires once per file load only
- Side panel no longer covers Gantt bars — timeline viewport adjusts when panel opens
- Light mode: org chart cards, hover states, and text now use theme-aware colors (previously rendered dark cards on white background)
- Light mode: Gantt header month/week labels now readable
- Phase header rows no longer fade WBS text on hover (no drag handle is ever shown for phase headers)
- `nextMs` (Next Milestone KPI) now sorts by `end || start`, consistent with the Final Milestone card
- Phantom `depIds: []` property no longer added to tasks in the reset snapshot
- `Duration` column removed from sample Excel — it was never parsed and caused column misalignment on re-import

### Added
- In-app `?` help modal covering tab guide, full Excel schema reference, and troubleshooting steps
- Warning shown when Schedule or Specifications sheets are absent or empty
- Browser tab title updates to the loaded project name
- `WD` column header renamed to `WD Left` with tooltip
- Version comment at top of file (`v1.1, 2026-05-03`)

---

## [1.0] — 2026-04-29

### Added
- Drag-and-drop Excel file loading (`.xlsx`)
- Gantt Chart tab: SVG timeline with WBS phases, dependency arrows, today line, milestones, zoom, pan, phase/team filters
- Interactive Gantt editing: bar drag (resize/move), row reorder, inline name/team/% edits, Add Task, Reset, Save to Excel
- Work-day awareness: configurable work days, WD column, non-work-day shading, drag snapping
- Vehicle Specifications tab: filterable table with status badges and risk detection
- Program Dashboard tab: KPI cards, phase progress bars, spec status pills, team workload with collapsible rows
- Weight Budget tab: subsystem bar chart with target lines and hover tooltips (optional sheet)
- Org Chart tab: recursive SVG hierarchy, drag-pan, zoom (optional sheet)
- Side panel: spec ↔ task cross-linking with risk flags; org person → team tasks
- Light/dark mode toggle with `localStorage` persistence
- Sample Excel generator (TW-2 Hybrid-Electric Tilt-Wing UAM program)
