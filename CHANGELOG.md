# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.11.0] — 2026-05-04

### Added
- Overdue task highlighting: bars whose end date has passed and are less than 100% complete now show a dashed red ring (`#f85149`, `stroke-dasharray="3 2"`) distinct from the solid coral CP ring; works for both bar types (filled and outline)
- Overdue KPI card: "Overdue" card added to Program Dashboard KPI row showing count of non-milestone tasks past due; count text turns red when > 0
- Phase color legend: "Legend" button in Gantt toolbar opens a floating popup showing phase color swatches with names, plus a symbol key (milestone diamond, dependency arrow, overdue ring, CP ring); click-outside or Esc to dismiss
- SVG viewBox attribute: `viewBox` now set on Gantt header SVG, body SVG, and both exported SVGs (Export SVG / Export PNG); print CSS adds `max-width:100%;height:auto` so Gantt SVGs scale proportionally to fit the print page width
- Dependency arrow hover tooltip: hovering a Gantt dependency arrow shows a tooltip with predecessor name → successor name; uses `esc()` for XSS safety; reuses shared `#tooltip` element and `positionTooltip()`
- Filter persistence: Gantt phase filter, Gantt team filter, Specifications category filter, and Specifications text search are now saved to `localStorage` and restored across page reloads; filters reset when a new file is loaded; localStorage keys: `vh-filter-phase`, `vh-filter-team`, `vh-filter-specs-cat`, `vh-filter-specs-search`
- Weight group collapse persistence: collapsed/expanded state of Weight Budget group headers is saved to `localStorage` (`vh-wt-collapsed` JSON array of group names); state is restored on next render; resets when a new file is loaded

---

## [1.10.0] — 2026-05-04

### Added
- Export Gantt as PNG: "Export PNG" button in Gantt toolbar downloads a rasterized version of the merged Gantt (header + body SVGs) as a dated `.png` file; canvas background fills with the current theme color (`#0d1117` dark / `#22272e` dim / `#edecea` light) so the PNG renders cleanly without transparency artifacts
- Org chart person search: text input in Org Chart toolbar filters the tree by name, title, team, or email (case-insensitive substring, debounced 200 ms); clear (×) button when active; resets on file load
- Critical path hover highlight: when CP mode is active, hovering a critical-path task bar dims all non-critical bars (to 0.15 opacity) and arrows (to 0.08 opacity), focusing attention on the critical chain; moving away restores all elements instantly

### Fixed
- Dependency arrow keyboard access: arrows now have `tabindex="0"`, `role="button"`, and descriptive `aria-label`; Enter/Space opens the dependent task's side panel; CSS `:focus-visible` stroke ring added — resolves WCAG 2.1 SC 2.1.1 violation
- Weight Budget group headers: clicking a group header now collapses/expands its subsystem rows (`toggleWtGroup()`); header shows ▼/▶ indicator; `aria-expanded` and `aria-controls` attributes maintained — consistent with team workload rows in Program Dashboard

### Changed
- Print stylesheet: added `@page { size: landscape; margin: 10mm; }` — Gantt prints in landscape orientation; task list column font reduced to 0.72rem for print; `#gantt-container` wraps for better multi-column layout

---

## [1.9.0] — 2026-05-04

### Added
- Critical path highlighting: new `CP` toggle button in Gantt toolbar computes critical path via forward/backward CPM pass (topological sort, slack = 0); critical bars get a coral `#e06c75` ring; critical arrows are solid coral at 2.5px; non-critical arrows become dashed `stroke-dasharray="5 3"` — non-color cue for accessibility; CP state persists to `localStorage` (`vh-show-cp`); cycle detection falls back gracefully to no highlight
- Dependency arrow click: clicking any Gantt dependency arrow opens the side panel for the dependent (successor) task; cursor changes to pointer on hover; note added to keyboard shortcuts table in help modal
- Export Gantt SVG: new "Export SVG" button in Gantt toolbar downloads the current Gantt (header + body SVGs merged into one) as a dated `.svg` file; `<defs>` block (arrowhead marker) included; button is disabled until a file is loaded
- Weight Budget group subtotals: subsystem rows are now grouped by the `Group` field; each group shows a bold header row with subtotal estimated, target, and margin; a "Total" row appears at the bottom of the table
- Print stylesheet: `@media print` block hides UI chrome (topbar, toolbars, side panel, dropzone), forces white background regardless of current theme, and makes only the active tab panel visible; strips all CSS transitions during print

---

## [1.8.0] — 2026-05-04

### Added
- Floating "Today" label: when the Gantt is scrolled horizontally past the Today line, a small red pill label appears anchored at the top of the viewport — always visible regardless of scroll position; disappears when the Today line is in view. Today's date also included in the body SVG `aria-label` for screen readers.
- Gantt empty state: loading a file with no tasks now shows a centered card ("No tasks found") with guidance and a link to the help modal, instead of a blank panel
- Specs empty state: loading a file with no specs now shows a centered card ("No specifications found") with guidance
- Spec text search: text input in the Specifications toolbar filters across spec ID, name, responsible group, and notes simultaneously; debounced 200 ms; shows a × clear button when active; count updates to reflect filtered results
- Inline spec status editing: clicking (or pressing Enter/Space) on a status badge in the Specifications table cycles Achieved → Target → TBD → Achieved; the side panel updates immediately if open for that spec; status is exported with the next "Export to Excel"

### Fixed
- Work Days picker: checkboxes now wrapped in `<fieldset>/<legend>` — screen readers correctly announce the group context
- Work Days picker: pressing Esc while the picker is open now closes it and returns focus to the Work Days button
- Work Days picker: `renderGantt()` is now debounced 300 ms on checkbox changes — prevents up to 7 sequential re-renders when navigating checkboxes with the keyboard
- Work Days `localStorage` validation: values restored from `vh-workdays` are now filtered to valid day indices (integers 0–6); corrupt or manually-edited values silently fall back to Mon–Fri default
- Spec table: row click no longer fires when clicking a status badge (badge click is handled independently)

---

## [1.7.0] — 2026-05-04

### Added
- Work Days UI: new popup button in Gantt toolbar lets users configure work days directly in the app (7 labeled checkboxes, Mon–Sun); setting persists to `localStorage`; Excel `Work Days` Project Info key takes priority when present and syncs the button label on load
- Keyboard shortcuts table in Help modal: two-column layout listing all keyboard interactions (arrow nav, Enter/Space, zoom, inline edit, Esc)
- `aria-live="polite"` on `#app-toast` — screen readers now announce Reset undo, row renumbered, and task added messages
- Spec table keyboard access: all spec rows now have `tabindex="0"` and respond to both `Enter` and `Space` to open the side panel
- "Clear Filters" recovery link in Gantt no-results message and "Clear filter" link in Specs empty state
- Zoom indices now persist to `localStorage` (`vh-zoom-gantt`, `vh-zoom-specs`, `vh-zoom-org`) and restore on page reload; writes are debounced 500 ms to avoid thrashing; indices are validated against array bounds on restore
- Weight unit now read from `Project Info` `Weight Unit` key (default `lb`); shown in all Weight Budget KPI cards, column headers, and tooltips; Weight Budget column headers exported dynamically to match

### Changed
- Work day default changed from Mon–Thu to Mon–Fri; sample Excel `Work Days` row updated to `Mon,Tue,Wed,Thu,Fri`
- Toast undo window extended from 15 s to 30 s for the Reset action
- Toast `showToast()` now guards against a non-undoable toast replacing an active undo toast (`toastHasUndo` flag)
- `toLocaleDateString('en-US', …)` replaced with `toLocaleDateString(undefined, …)` in two Program Dashboard date strings — uses the browser's locale instead of hardcoding US
- Help modal: updated Work Days troubleshooting text to reference the toolbar button and Mon–Fri default
- Calendar day cells: `onclick` attribute replaced with `data-date` + `addEventListener` — no inline JS in generated HTML
- Drop-box border-radius reduced from 16 px to 10 px
- Toast slide travel increased from 6 px to 12 px for clearer entrance animation
- Help modal: `role="dialog"`, `aria-modal="true"`, `aria-labelledby="help-modal-title"` added; close button gets `aria-label="Close"`; help button `aria-label` updated to "Help and keyboard shortcuts"
- Focus trap added to help modal: Tab cycles within the modal; focus returns to the opener button on close; Esc closes the modal
- Tab widget: `.tabs` div gets `role="tablist"`; each tab button gets `role="tab"`, `aria-selected`, and `aria-controls`; `switchTab()` keeps `aria-selected` in sync
- All five tab panels get `role="tabpanel"` and `aria-labelledby`
- Eight icon-only toolbar buttons now have `aria-label` (zoom in/out ×3 tabs, calendar toggle, side panel close, help button, theme toggle)
- Calendar toggle button: `aria-expanded` toggled by `toggleGanttCalendar()`
- Theme toggle button: `aria-label` updated on every theme cycle to reflect the current theme
- All CSS transitions (`.tab-btn`, `.btn-secondary`, `.zoom-btn`, `#dropzone`, `.drop-box`, `#side-panel`, `.prog-bar-fill`, `.team-row-arrow`, `#theme-toggle`) moved inside `@media (prefers-reduced-motion: no-preference)` blocks — the existing toast and theme-change transitions were already guarded

---

## [1.6.0] — 2026-05-03

### Added
- Keyboard navigation for Gantt task list: ↑/↓ arrows move focus between task rows (highlighted with a subtle blue outline); Enter opens the side panel for the focused task; `+`/`-` adjust zoom — all guarded to the Gantt tab and suppressed when an input/select has focus
- Keyboard access for Gantt inline edits: task name, team, and % complete cells now have `tabindex="0"` and respond to Enter key — consistent with click behavior; `:focus-visible` outline applied via CSS for keyboard-only users

### Fixed
- Light mode Gantt bar visibility: bars now carry a 1.5px phase-color stroke border in light mode — ensures all 12 phase colors are delineated against the `#edecea` background regardless of fill brightness (cyan, lime, amber, and teal fills were below the 3:1 WCAG non-text contrast threshold)

### Changed
- Gantt header SVG: `role="img"` + `aria-label` + `<title>` element — announces as a labeled image to screen readers rather than an unmarked SVG
- Gantt body SVG: `role="application"` + `aria-label` — signals interactive content to assistive technology

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
