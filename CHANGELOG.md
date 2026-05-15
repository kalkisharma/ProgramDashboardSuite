# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.7.0] — 2026-05-15

### Added
- Gantt name-column resize: `#gantt-name-col-handle` (6px drag zone) on the right edge of the Task Name header cell; dragging sets CSS variable `--gantt-name-col-w` shared by `#gantt-left-header` and `.gantt-row` grid layouts; width clamped 80–400px and persisted to `vh-gantt-name-col-width`; defaults to `1fr` (fills remaining panel width)
- Export reminder toast: after 15 minutes of continuous unsaved edits (`isDirty === true`), a 10-second toast appears nudging the user to Export to Excel; the timer starts once per dirty session and is not reset by subsequent edits; cleared on export or file import

---

## [2.6.0] — 2026-05-15

### Changed
- All inline `onclick` HTML attributes eliminated from the codebase — including dynamically-generated HTML
- `clearGanttFilters()` and `clearSpecsFilters()` extracted as named functions; empty-state "Clear filters" buttons wired via `querySelector` after `innerHTML` is set
- Calendar nav (‹/›) and close (×) buttons: replaced `onclick` attributes with `data-nav` / `data-close-cal` attributes; wired via `querySelectorAll` after each `cal.innerHTML` rebuild, consistent with the existing `data-date` day-cell pattern
- Empty-state "Open help guide" buttons: class `empty-help-btn` + `addEventListener('click', toggleHelp)` after `innerHTML`
- Browser compat dismiss button: rebuilt via `createElement` + `addEventListener` instead of `innerHTML` with inline `onclick`

---

## [2.5.0] — 2026-05-15

### Added
- Inline date picker: double-clicking any Gantt bar or milestone diamond opens a floating `#gantt-date-picker` panel near the cursor; milestones show a single date field, tasks show Start + End; Apply snaps dates to configured work days and calls `pushUndo('edit dates')`; Enter applies, Escape or clicking outside dismisses

### Fixed *(v2.4.0, bundled)*
- **Critical:** `safeSetItem()` was calling itself recursively instead of `localStorage.setItem()` — every preference write (theme, zoom, filters, work days, collapse state, column width) had silently no-op'd since v1.23.0; the fix is a single-character correction
- Auto-save draft: `isDirty` flag set by `pushUndo()`, cleared by `parseWorkbook()` and `saveToExcel()`; `scheduleDraftSave()` debounces 3 s then writes `fullSnapshot()` + project title + timestamp to `vh-draft`
- Draft restore banner (`#draft-banner`) shown on page load when `vh-draft` exists: displays project title and save time; "Restore" re-parses Date strings and calls `renderDashboard()`; "Dismiss" removes the draft
- `window.beforeunload` fires when `isDirty === true` to warn before navigating away
- Draft cleared on Excel export and on file import

---

## [2.3.0] — 2026-05-15

### Added
- Draggable resize handle (`#gantt-resize-handle`) between the Gantt task list (`#gantt-left`) and the timeline (`#gantt-right-col`); mousedown drag clamps list width 150–700 px; width persisted to `vh-gantt-left-width`; no re-render needed — the `1fr` name column reflows automatically

---

## [2.2.0] — 2026-05-15

### Added
- Phase collapse/expand on Gantt: each phase header row shows a ▼/▶ toggle; `togglePhaseCollapse(phaseNum)` adds/removes the phase number from `collapsedPhases` (a `Set`) and re-renders; collapsed sub-tasks are hidden from `visibleTasks` and the header row gets `.phase-collapsed` opacity styling; only active when `ganttPhaseFilter === 'all'`; state persisted to `vh-collapsed-phases`; resets on file load

---

## [2.1.0] — 2026-05-15

### Added
- Weight Budget rows are now click-to-edit: clicking any row opens a side panel form (`openWeightPanel(idx)`) with all fields editable; `saveWeightRow(idx)` and `deleteWeightRow(idx)` (two-tap confirm) push undo; `addWeightRow()` appended to array and panel opens immediately
- Org Chart persons are now click-to-edit: person card shows an "Edit Person" button opening `openOrgEditPanel(name)`; `saveOrgPerson(oldName)` cascades renames to all `reportsTo` arrays; `deleteOrgPerson(name)` uses two-tap confirm; `openOrgEditPanel(null)` creates a new person via `+ Add Person` toolbar button
- Project Info is now editable: `#proj-info-btn` in topbar opens `openInfoPanel()`; all key/value fields are editable; `saveInfoPanel()` updates title, subtitle, work days, and re-renders Gantt + Program Dashboard

---

## [2.0.0] — 2026-05-14

### Changed
- Milestone gate release; all v1.22.0–v1.26.0 gate items verified:
  - Undo/redo works for all five data collections
  - All panels keyboard-navigable; side panel traps focus
  - No XSS gaps; import validation catches duplicate IDs and bad dates
  - Delete task and delete spec both work with undo
  - Browser compatibility warning for old browsers
  - localStorage failure handled; render errors show inline error card
  - Print stylesheet renders active tab legibly
- `APP_VERSION` and HTML comment set to `v2.0.0`; tagged in git

---

## [1.26.0] — 2026-05-14

### Changed
- Code quality pass: all remaining inline `onclick` attributes in static HTML replaced with `addEventListener` calls wired in the "WIRE STATIC UI EVENT HANDLERS" block
- Global state object renamed `S` → `ProjectData` throughout; all call sites updated; CLAUDE.md updated
- Function naming audit: Gantt render helpers consistently prefixed `renderGantt*`; side panel helpers consistently prefixed `sp*`
- JSDoc one-liners added to all public functions called from HTML or from more than two other functions

---

## [1.25.0] — 2026-05-14

### Added
- Focus trap in side panel: Tab/Shift+Tab cycle within the open panel; focus returns to the opener element on close (`spOpener`)
- Keyboard navigation for spec table rows: ↑/↓ move focus, Enter opens spec side panel
- ARIA: `role="grid"` on spec table; `role="row"` + `aria-selected` + `aria-label` on Gantt left-panel rows; descriptive `aria-label` on SVG bar elements
- Non-color status indicators: "DONE / ACTIVE / FUTURE" text labels alongside color-coded task card colors in side panel
- `@media print` stylesheet: hides sidebar, topbar, and toolbars; expands active tab to full width; scales Gantt SVG to fit page
- Mobile-responsive topbar: collapses to hamburger menu at viewport < 768 px

### Fixed
- Side panel `showSidePanel()` auto-focuses first focusable element via `requestAnimationFrame`; `closeSidePanel()` restores focus to `spOpener`

---

## [1.24.0] — 2026-05-14

### Added
- Delete Task: "Delete Task" button in task side panel uses two-tap confirm (`btn.dataset.confirming` + 3 s auto-revert); `pushUndo('task deleted')` before removal; dangling `deps[]` references in all other tasks and specs cleaned up; `recalcWBS()` + `renderGantt()` called; panel closes
- Delete Spec: "Delete Spec" button in spec side panel; same two-tap confirm pattern; `pushUndo('spec deleted')` before removal; `renderSpecs()` called

---

## [1.23.0] — 2026-05-14

### Added
- Import validation: after `parseWorkbook()`, a validation pass checks for duplicate task IDs, duplicate spec IDs, swapped/missing date columns, and missing required column headers; a summary toast shows row counts and any warnings
- Browser compatibility check: IIFE on page load shows a dismissible banner on IE or very-old browsers that lack `Promise`
- Conflict detection at mutation time: `endBarDrag()`, name-edit commit, and pct-edit commit run a lightweight conflict check immediately after the change and flash a warning inline on the affected task

### Fixed
- Error handling around renders: `renderGantt()`, `renderSpecs()`, `renderOrgChart()`, `renderProgDash()`, `renderWeightBudget()` wrapped in `safeRender()` — on error an inline error card is shown rather than a blank panel
- `safeSetItem(key, val)` wraps all `localStorage.setItem()` calls; on `QuotaExceededError` shows a persistent warning toast
- XSS audit: all `innerHTML =` injection points audited; every user-controlled field (task name, spec name, team, notes, group, org name, title) verified to be wrapped in `esc()`

---

## [1.22.0] — 2026-05-14

### Added
- Redo stack (`redoStack[]`, max 50): `applyUndo()` pushes current state to `redoStack`; new `applyRedo()` pops from it and pushes to `undoStack`; redo stack cleared whenever a new edit is pushed
- `fullSnapshot()` replaces `taskSnapshot()`: captures all five collections (`tasks`, `specs`, `org`, `weights`, `info`); undo/redo now cover org chart, weight budget, and project info edits in addition to tasks/specs
- Undo (`⟲`) and Redo (`⟳`) toolbar buttons always visible in Gantt toolbar; greyed out when respective stack is empty; keyboard shortcuts Ctrl+Z / Ctrl+Y wired globally
- Undo stack limit raised from 20 to 50 entries

---

## [1.21.2] — 2026-05-14

### Changed
- Spec panel: spec name now appears as an editable field in the panel body (above the ID line), not just in the header; `startSpecNameEdit()` fires automatically when a new spec is created via `addNewSpec()`
- Value field shows "Add value…" placeholder italics when empty, consistent with the notes field

---

## [1.21.1] — 2026-05-14

### Added
- Spec ID is now click-to-edit (`startSpecIdEdit()`): validates non-empty and uniqueness; duplicate ID shows an error toast and reverts
- Spec notes field now click-to-edit (`startSpecNotesEdit()`): same textarea + Ctrl/Cmd+Enter / Esc pattern as task notes

---

## [1.21.0] — 2026-05-14

### Added
- `+ Add Spec` button in Specifications toolbar: auto-generates an ID from the active category prefix, appends to `ProjectData.specs`, and immediately opens the spec side panel for editing
- Spec side panel is now fully inline-editable: name (title area), category (dropdown), value, units, responsible group — same click-to-swap-with-input pattern as Gantt row edits
- Undo snapshot extended from tasks-only to cover `specs`; `applyUndo()` restores both arrays and re-renders both panels; all spec field edits push to `undoStack` with 5 s undo toast

---

## [1.20.0] — 2026-05-14

### Added
- Snapshot-based undo (max 20 entries) for task name, team, pct edits, bar drag, and row reorder; toast `[Undo]` button (5 s for inline edits, 12 s for bar drags)
- Input validation toasts: empty task name, pct out of range, bar drag with end ≤ start
- `computeConflicts()`: dependency conflict detection (successor starts before predecessor ends); ⚠ badge in Gantt row and dep card warning in task panel
- Gantt left-panel expanded to 6 columns (adds 18 px conflict icon column)

---

## [1.19.0] — 2026-05-14

### Changed
- Internal refactor only — no user-visible changes
- Extracted `wirePicker()` helper: three 145-line picker wiring blocks reduced to three one-liner calls
- Split 381-line `renderGantt()` into `prepareGanttData()`, `renderGanttLeft()`, `renderGanttSVG()`, and a coordinator function

---

## [1.18.0] — 2026-05-13

### Added
- Version label: `APP_VERSION` constant rendered as a small label in the topbar right cluster
- Spec side panel — dependent task dep add/remove: `×` button on each dep task card removes it; `+ Link task` button opens an inline searchable picker (`buildSpecDepPickerList` / `addSpecDep`)
- Task side panel — spec link add/remove: `×` button on each linked spec card unlinks it; `+ Link specification` opens a searchable picker (`buildSpecLinkPickerList` / `addSpecLink`); "Linked Specifications" section always visible even when empty
- Always-visible `×` remove buttons on dep/link cards (previously opacity 0 until hover)

---

## [1.17.0] — 2026-05-13

### Added
- `visibilitychange` + `window.blur` guards: clean up `rowDrag` and `barDrag` ghost elements when the window loses focus, preventing stuck drag states
- `saveToExcel` strips orphaned dependency IDs from both Schedule and Specifications sheets before writing

### Changed
- ARIA: `aria-label` on Gantt phase/team filter selects and Specs category filter; `role="status"` on toast
- Keyboard focus outline strengthened from 1 px semi-transparent to 2 px solid accent color
- CSS variables added: `--surface-overlay`, `--radius-sm/md/lg/xl`; tooltip and drag label use variables; four stale per-element overrides removed
- `.btn-sm` class added; inline style overrides removed from Legend, CP, and Work Days buttons
- Toolbar padding unified to `8px 16px`; toolbar select `font-size` and padding unified; scrollbar width standardized to 4 px; side panel header padding symmetrized

---

## [1.16.0] — 2026-05-12

### Added
- Task notes editing: the Notes area in the task side panel is now a click-to-edit field; clicking (or pressing Enter/Space) opens an inline textarea pre-filled with the current notes; `Ctrl+Enter` or clicking away saves; `Esc` cancels and restores the original text; empty-state shows "Click to add notes…" placeholder; changes are reflected in Gantt state and round-trip through Save to Excel
- Dependency editing in the task side panel: each "Depends On" card now shows a `×` removal button (hover-reveal) that removes that dependency link immediately; a `+ Add dependency` button below the list opens an inline searchable picker listing all other tasks, filterable by name, WBS, or task ID; tasks that would create a dependency cycle are shown greyed out with a `— cycle` label and cannot be selected; adding or removing a dependency redraws Gantt arrows instantly
- `wouldCreateCycle(taskId, candidateId)` — BFS successor traversal used to detect forward-chain cycles before allowing a new dependency to be added; prevents the CPM from encountering unresolvable graphs

### Fixed
- Notes textarea: Space and Enter keys now work inside the textarea without triggering Gantt keyboard shortcuts; Mac Cmd+Enter saves (in addition to Ctrl+Enter)

---

## [1.15.0] — 2026-05-06

### Changed
- CP mode: non-critical-path bars are now persistently dimmed to 0.35 opacity when CP is toggled on, making the critical chain continuously visible without needing to hover; hovering any bar in CP mode spotlights it (and on CP tasks highlights the whole chain) then restores the base 0.35/full dim on mouseleave
- Bar move drag now requires a 300ms click-and-hold before the drag activates; cursor changes to `grabbing` at 300ms as visual confirmation that the bar is "grabbed" and ready to move; resize-edge drags (left/right 8px zones) still activate on movement as before — only the whole-bar move requires a hold

---

## [1.14.0] — 2026-05-06

### Changed
- CP mode hover now dims all bars (not just when hovering a critical-path bar): hovering any bar dims all other bars to 0.2 opacity; hovering a CP bar still keeps the entire critical chain bright while dimming non-CP bars; dim transition is 60ms to feel intentional rather than abrupt
- Bar drag activation threshold increased from 4px to 8px, and now also requires 80ms hold time before a pending drag converts to active — eliminates accidental task shifts from confident clicks with slight hand movement

---

## [1.13.0] — 2026-05-04

### Changed
- File load errors (missing required sheets, unparseable file) now display as an inline error card inside the drop zone instead of blocking `alert()` dialogs; error card clears automatically on the next load attempt; includes explicit case-sensitivity guidance for sheet name mismatches
- Success toast: loading a valid Excel file now shows a summary toast ("Loaded: N tasks · N specs · N people · N weight rows") that auto-dismisses after 6 seconds; if any non-milestone tasks have missing Start or End dates the toast includes a warning count and stays visible for 10 seconds

---

## [1.12.0] — 2026-05-04

### Fixed
- Program Dashboard "Next Milestone" KPI: was sorted by end date but displayed by start date — now sorts by start date, so the card always shows the milestone whose start date is nearest
- Gantt bar drag: extending a task bar to the right caused the progress fill to visually shrink during drag (stale pct × new width calculation) — progress rect x position is now the only live update; width is corrected on the post-drag re-render
- Org chart search: searching for a person whose manager did not match the query caused the person to appear as a root-level node, breaking the tree hierarchy — the search result now expands to include all ancestors up the reporting chain; matched nodes are highlighted in accent color while ancestor-only nodes render normally
- Side panel focus: closing the spec/task/org side panel (via ✕ button, Escape, or clicking the same item again) now restores keyboard focus to the element that originally opened it — consistent with the help modal behavior; resolves WCAG 2.4.3 focus management gap
- Specifications table "Dep. Tasks" column: count and risk warning (⚠) now have `aria-label` attributes — screen readers announce "N dependent tasks" and, when risk is present, "risk: dependent task already started" instead of bare numbers and symbol names
- Undo toast suppression: adding a task or making another non-undoable action during the Gantt reset undo window (30s) previously discarded the new notification silently — the new message is now appended to the active toast text for 3 seconds so users receive confirmation

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
- All CSS transitions moved inside `@media (prefers-reduced-motion: no-preference)` blocks

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
- "Save to Excel" renamed to "Export to Excel" (topbar button + help modal reference)
- Gantt toolbar action-zone divider margin balanced — clearer separation between view controls and action controls
- Help modal Gantt Chart description updated to surface the inline-edit interaction model
- Light mode palette reverted to v1.4.3 values (`--bg #edecea`)

---

## [1.4.4] — 2026-05-04

### Changed
- Light mode background darkened to L\*84 warm stone gray: `--bg #d8d5cf`, `--surface #cec9c3`, `--border #b5b0aa`
- Light mode `--muted` darkened: `#5a6370` → `#4e5760`

---

## [1.4.3] — 2026-05-04

### Added
- Dim mode — a third theme between dark and light: `--bg #22272e`, `--surface #2d333b`, `--border #444c56`, `--text #adbac7`; theme now cycles dark → dim → light → dark; button icon reflects current state

### Fixed
- Mini calendar no longer closes when clicking the theme toggle button

### Changed
- Theme transition CSS wrapped in `@media (prefers-reduced-motion: no-preference)`

---

## [1.4.2] — 2026-05-04

### Changed
- Light mode palette shifted to a warmer, softer neutral: `--bg #edecea`, `--surface #e2e0dc`, `--border #cac7c2`
- Org chart node cards in light mode: fill changed from `#ffffff` to `#f4f2ef`
- Theme toggle now re-renders the org chart so node card colors update immediately
- Reset button renamed "Reset to Imported"; requires confirmation dialog

### Fixed
- Calendar badge font size raised from `0.65rem` to `0.72rem` — was below the 11px accessibility minimum
- Calendar day cells converted from `<div onclick>` to `<button type="button">` — keyboard-focusable and announced as interactive by screen readers

---

## [1.4.1] — 2026-05-03

### Security
- Apply `esc()` to task WBS, name (×2: `title` attribute + text), and team (×2: `title` attribute + text) in Gantt row `innerHTML` — these five injection points were missed in the v1.2.1 XSS sweep

### Fixed
- Org chart drag-pan: `mousemove`/`mouseup` document listeners were re-added on every `renderOrgChart()` call; now guarded with a module-level flag and attached once only

---

## [1.4] — 2026-05-03

### Added
- Mini calendar widget in Gantt toolbar (📅 toggle button): shows current month with colored diamond markers for milestones and 2px phase-color top-borders on phase-start days; count badge when multiple milestones fall on the same date; click any date to scroll the Gantt to that date; navigate with ‹/› arrows

### Changed
- Calendar widget converted to `position: absolute` overlay — no longer displaces the Gantt chart when opened
- Program Dashboard team workload rows and Weight Budget hover tooltip: `onclick`/`onmouseenter` attributes replaced with `addEventListener`

### Fixed
- Browse for File: file input value now reset after each load so the same file can be re-selected without reloading the page

---

## [1.3] — 2026-05-03

### Added
- Org chart matrix reporting: `Reports To` column now accepts comma-separated names (`Primary, Secondary`); the first name determines tree position; additional names render as dashed lines

### Fixed
- Org chart node cards in light mode now have a drop shadow; hover state changed from flat grey to a team-color tint
- Weight budget target line (│) now renders as a dark line in light mode

---

## [1.2.1] — 2026-05-03

### Security
- Apply `esc()` to phase name labels in Gantt phase filter dropdown
- Apply `esc()` to team names in Gantt team filter dropdown
- Apply `esc()` to subsystem name in weight budget tooltip `innerHTML`
- Apply `esc()` to `w.subsystem` and `w.group` in weight budget bar `title` and `data-name` attributes

---

## [1.2] — 2026-05-03

### Changed
- Light mode background softened: `--bg #f0f2f5`, `--surface #e8eaed`
- Gantt timeline split into a sticky header SVG (month/week labels, Today marker) and a scrollable body SVG
- Theme toggle now immediately re-renders the Gantt SVG
- Non-work-day column shading removed
- Vertical week sub-lines extended into the task body area at zoom ≥ 5

---

## [1.1] — 2026-05-03

### Security
- Vendor SheetJS 0.20.3 locally as `xlsx.full.min.js` — eliminates CDN dependency, enables fully offline use
- Add `esc()` HTML-escaping helper applied at every `innerHTML` injection point
- Replace all inline `onclick` handlers in side panels with `data-attribute` + `addEventListener` delegation

### Fixed
- Gantt scroll position no longer resets to today on every edit or drag
- Side panel no longer covers Gantt bars — timeline viewport adjusts when panel opens
- Light mode: org chart cards, hover states, and text now use theme-aware colors
- Light mode: Gantt header month/week labels now readable
- Phase header rows no longer fade WBS text on hover
- `nextMs` (Next Milestone KPI) now sorts by `end || start`, consistent with the Final Milestone card
- Phantom `depIds: []` property no longer added to tasks in the reset snapshot
- `Duration` column removed from sample Excel — it was never parsed and caused column misalignment on re-import

### Added
- In-app `?` help modal covering tab guide, full Excel schema reference, and troubleshooting steps
- Warning shown when Schedule or Specifications sheets are absent or empty
- Browser tab title updates to the loaded project name
- `WD` column header renamed to `WD Left` with tooltip
- Version comment at top of file

---

## [1.0] — 2026-04-29

### Added
- Drag-and-drop Excel file loading (`.xlsx`)
- Gantt Chart tab: SVG timeline with WBS phases, dependency arrows, today line, milestones, zoom, pan, phase/team filters
- Interactive Gantt editing: bar drag (resize/move), row reorder, inline name/team/% edits, Add Task, Reset, Export to Excel
- Work-day awareness: configurable work days, WD column, drag snapping
- Vehicle Specifications tab: filterable table with status badges and risk detection
- Program Dashboard tab: KPI cards, phase progress bars, spec status pills, team workload with collapsible rows
- Weight Budget tab: subsystem bar chart with target lines and hover tooltips (optional sheet)
- Org Chart tab: recursive SVG hierarchy, drag-pan, zoom (optional sheet)
- Side panel: spec ↔ task cross-linking with risk flags; org person → team tasks
- Light/dark mode toggle with `localStorage` persistence
- Sample Excel generator (TW-2 Hybrid-Electric Tilt-Wing UAM program)
