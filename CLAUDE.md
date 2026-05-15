# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

No build system. Open `dashboard.html` directly in any modern browser, or:

```
python -m http.server
# then open localhost:8000/dashboard.html
```

## Architecture

**Single-file vanilla JS app** (`dashboard.html`, ~5550 lines). All HTML, CSS, and JavaScript are in one file. SheetJS is vendored locally as `xlsx.full.min.js` (no CDN).

### Global State

```javascript
const ProjectData = { info: {}, tasks: [], specs: [], org: [], weights: [] };
let originalTasks = [];            // deep-copy at parse time; used by resetGanttToImported()
let ganttWorkDays = [1,2,3,4,5];  // Mon–Fri default; overridden by Work Days UI or Project Info "Work Days" key
let spCurrentType = null; // 'spec' | 'task' | 'org' | 'weight' | 'info' — tracks what the side panel is showing
let spCurrentId   = null; // specId string, taskId number, person name string, weight array index, or null (info)
let spOpener      = null; // element that opened the side panel (focus restored on close)
let undoStack = []; // max 50 entries, LIFO; each: { label, snapshot }
let redoStack = []; // max 50 entries; populated by applyUndo(), cleared by pushUndo()
let barDrag = { active: false, taskId: null, mode: null, ... }; // Gantt bar drag state
let barEls  = {};    // taskId → { bgRect, progRect, outlineRect, midY } (or { diamond, midY })
let rowDrag = { active: false, srcIdx: null, dropIdx: null, rowCount: 0, lb: null, ghost: null, indicator: null };
let calDisplayMonth = null; // { year, month } — month shown in the mini calendar; null when calendar was never opened
let collapsedPhases = new Set(); // phase numbers (ints) whose sub-tasks are hidden in the Gantt; reset on file load
let isDirty      = false;  // true when ProjectData has unsaved edits since last load/export
let _draftTimer  = null;   // debounce handle for scheduleDraftSave()
```

- `ProjectData.info` — key/value pairs from the "Project Info" sheet
- `ProjectData.tasks[]` — `{ id, wbs, name, category, start, end, pct, deps, team, milestone, notes }`
- `ProjectData.specs[]` — `{ id, category, name, value, units, status, group, notes, depIds[] }`
- `ProjectData.org[]` — `{ name, title, team, reportsTo: string[], email }` — `reportsTo` is always an array; `[0]` is the primary manager (determines tree position); `slice(1)` are secondary managers (dashed lines)
- `ProjectData.weights[]` — `{ subsystem, group, target, estimated, status, notes }`

`parseWorkbook(wb)` resets all five arrays, then populates them from the corresponding sheets, deep-copies `ProjectData.tasks` into `originalTasks`, and applies the `Work Days` Project Info key. `renderDashboard()` is called after every load and re-renders all tabs.

### Undo/Redo

- `fullSnapshot()` → `{ tasks, specs, org, weights, info }` — deep copy of all five collections
- `pushUndo(label)` — saves snapshot + label to `undoStack[]`, clears `redoStack[]`
- `applyUndo()` / `applyRedo()` — pops from one stack, pushes current state to the other, calls `_restoreSnapshot()`
- `_restoreSnapshot(snapshot)` — restores all five collections, calls `safeRender()` for each tab
- `safeRender(fn, label)` — wraps render calls in try-catch, shows toast on error
- `safeSetItem(key, val)` — wraps `localStorage.setItem`, catches `QuotaExceededError`

### Auto-save / Draft Restore

- `isDirty` — set `true` by `pushUndo()`; cleared by `parseWorkbook()` and `saveToExcel()`
- `scheduleDraftSave()` — debounces 3s, then serializes `fullSnapshot()` + project title + timestamp to `localStorage` as `vh-draft`
- `scheduleExportReminder()` — called by `pushUndo()`; sets a 15-minute one-shot timer (not reset on subsequent edits); on fire shows a 10s toast nudging Export to Excel; cleared by `clearDraft()`
- `clearDraft()` — removes `vh-draft` from localStorage, cancels both timers, resets `isDirty = false`
- On page load an IIFE calls `checkForDraft()`: if `vh-draft` exists, shows `#draft-banner` with project title and save time. "Restore" button re-parses Date strings and calls `renderDashboard()`; "Dismiss" calls `clearDraft()`
- `window.beforeunload` fires when `isDirty === true` to warn before navigating away
- Date objects in snapshots are stored as ISO strings by JSON.stringify; restore must explicitly `new Date(t.start)` etc.

### Excel Input Format

| Sheet | Required | Key columns |
|---|---|---|
| Project Info | Yes | Field, Value (key/value pairs) |
| Schedule | Yes | Task ID, WBS, Task Name, Category, Start Date, End Date, % Complete, Dependencies, Responsible Team, Milestone, Notes |
| Specifications | Yes | Spec ID, Category, Specification Name, Value, Units, Status, Responsible Group, Notes, Dependent Task IDs |
| Org Chart | Optional | Name, Title, Team, Reports To, Email |
| Weight Budget | Optional | Subsystem, Group, Target Weight (lb), Estimated Weight (lb), Status, Notes |

Missing optional sheets are silently skipped; their tabs are hidden. Missing required sheets render partial data.

**Project Info recognized keys:**

| Field | Purpose |
|---|---|
| `Project Title` | Header title |
| `Project Subtitle` | Shown next to title (formerly `Vehicle Program`) |
| `File Administrator` | Shown in subtitle (formerly `Project Manager`) |
| `Program Start` | Informational |
| `Program End` | Informational (formerly `Target FAA Type Certificate`) |
| `Phase N Name` | Names each WBS phase (e.g. `Phase 1 Name`, `Phase 2 Name`, …up to 20) |
| `Work Days` | Comma-separated work days (e.g. `"Mon,Tue,Wed,Thu,Fri"`); default Mon–Fri if absent; also settable via Work Days button in Gantt toolbar (persisted to `localStorage` as `vh-workdays`) |

Phase names from `Phase N Name` rows override the built-in `PHASE_NAMES_FALLBACK` array everywhere they appear (Gantt filter labels, Program Dashboard phase bars).

### Tabs

| Tab | Panel ID | Visibility | Render function |
|---|---|---|---|
| Gantt Chart | `#gantt-panel` | Always | `renderGantt()` |
| Vehicle Specifications | `#specs-panel` | Always | `renderSpecs()` / `renderSpecTable()` |
| Program Dashboard | `#prog-panel` | Always | `renderProgDash()` |
| Weight Budget | `#weight-panel` | Only if `ProjectData.weights.length` | `renderWeightBudget()` |
| Org Chart | `#org-panel` | Only if `ProjectData.org.length` | `renderOrgChart()` |

`switchTab(btn, id)` toggles `.active` on both `.tab-btn` and `.tab-panel` elements, and closes the side panel.

### Color Systems

Two separate color systems coexist:

- **`phaseColor(wbs)`** — colors Gantt bars and Program Dashboard phase bars by top-level WBS number (1.x → index 0, 2.x → index 1, …) using the 12-color `PHASE_COLORS` array. This is the primary coloring used for rendering.
- **`ganttColor(category)`** — colors by category name string using `GANTT_COLORS` map with a dynamic fallback pool (`_colorCache`). Used in tooltips and side panel task cards.

### Gantt Chart

Drawn entirely with raw SVG via `document.createElementNS` — no charting library. Key constants:

- `ZOOM_STEPS = [1,2,3,4,6,8,12,16]` px/day; `ganttZoom` (default 4) is the active value
- `RH = 36` px/row, `HH = 60` px header height
- `adjustZoom(dir)` steps through `ZOOM_STEPS` and scales `scrollLeft` proportionally to keep the view anchored
- Ctrl+scroll also triggers zoom; drag-pan is initialized once in `initGanttPan()`
- `#gantt-left` (task list) and `#gantt-right` (SVG body) scroll vertically in sync via paired `scroll` listeners
- The Gantt timeline is split into two SVGs: a sticky `#gantt-header-svg-wrap` (60px, contains month/week labels and Today marker) inside `#gantt-header-wrap`, and a scrollable `#gantt-svg-wrap` (body rows, bars, arrows) inside `#gantt-right`. Both live inside `#gantt-right-col`. The header SVG follows horizontal scroll via `translateX` set on each scroll event.

**Gantt Filters:** The toolbar contains two `<select>` dropdowns (Phase and Team). State is held in `ganttPhaseFilter` / `ganttTeamFilter` (default `'all'`). `setGanttPhaseFilter()` / `setGanttTeamFilter()` update state and call `renderGantt()`. The filter builds a `visibleTasks` subset; the SVG date axis always spans the full `ProjectData.tasks` date range so the timeline doesn't shift when filtering. Dependency arrows are only drawn between tasks that are both visible.

**Mini calendar (D1):** `#gantt-calendar` div is the last child of `#gantt-toolbar` (which is `position: relative`). The calendar is `position: absolute; top: 100%; left: 0; z-index: 200` so it floats over the Gantt without displacing it. Toggled by the 📅 button via `toggleGanttCalendar()` (adds/removes `.open` class). A document-level `click` listener dismisses it when clicking outside the panel or button; ✕ button in the nav bar is the explicit close control. `renderGanttCalendar()` builds a 7-column CSS grid: non-work-day columns (per `ganttWorkDays`) get `.cal-dh-off`/`.cal-off` classes for visual dimming. Milestone days show a phase-color diamond (`.cal-dot`), count badge if ≥2 on same date. Phase-start days get a 2px phase-color `border-top`. Phase-start tasks identified by `!wbs.includes('.') || wbs.endsWith('.0')`. Every day cell always renders a `.cal-marker` slot (consistent height). Hovering a day with markers shows the shared `#tooltip` via a delegated `mouseover` listener on `#gantt-calendar`; tooltip content built from `data-cal-tip` attribute (phase name and/or milestone task names). `jumpToGanttDate(dateStr)` sets `gantt-right.scrollLeft`; calendar stays open. `navigateCalendar(delta)` mutates `calDisplayMonth` and re-renders.

**Interactive editing (Gantt):** All edits operate on `ProjectData.tasks` directly and call `renderGantt()` to commit.

- **Bar drag** — `mousedown` on a bar hit area (`data-taskid`) routes to `startBarDrag()`. Zone is determined by cursor position within 8px of left/right edge (`resize-left`/`resize-right`) or center (`move`). During drag, SVG elements are updated directly via `barEls[id]` (no full re-render). `snapToWorkDay()` keeps start/end on configured work days. A floating `#gantt-drag-label` shows new dates + work day counts. Full re-render fires on `mouseup`. Milestone bars use a diamond element stored as `barEls[id].diamond`.
- **Row reorder** — Hover a sub-task WBS cell to reveal the `⠿` affordance and a `grab` cursor. The entire `.g-wbs-wrap` div (class `g-wbs-draggable`) is the mousedown target — not the tiny `⠿` span, which has `pointer-events:none`. `startRowDrag()` sets `rowDrag.active = true`, stores `rowDrag.lb`, and appends a `position:fixed` ghost + indicator to `document.body`. The existing document-level listeners in `initGanttPan` call `doRowDragMove()` on mousemove and `endRowDrag()` on mouseup, which commit the splice and call `recalcWBS()` to renumber sequentially within phases. Phase headers (no dot, or ending `.0`) never get `g-wbs-draggable`. Disabled when either filter is active.
- **Inline name edit** — Click `.g-name` → `startTaskNameEdit()` replaces span with `<input>`; Enter/blur confirms (non-empty only), Escape cancels.
- **Team dropdown** — Click `.g-team` → `startTaskTeamEdit()` replaces span with `<select>` populated from unique sorted teams; change commits, Escape/blur-without-change restores.
- **% complete edit** — Click `.g-pct` → `startTaskPctEdit()` replaces span with `<input type="number">`; value is clamped 0–100 and rounded; Escape cancels.
- **Add Task** — `addGanttTask()` appends a new task to the last phase with name `"New Task N"`, first-alpha team, 0%, and start = first program work day.
- **Reset** — `resetGanttToImported()` deep-copies `originalTasks` back into `ProjectData.tasks` and re-renders.
- **Save to Excel** — `saveToExcel()` rebuilds all 5 sheets from current `ProjectData.*` state using SheetJS and downloads `"[Project Title] - YYYY-MM-DD.xlsx"`. The column layout matches what `parseWorkbook()` expects, so the file can be re-imported.
- **Delete task/spec** — `deleteTask(taskId)` / `deleteSpec(specId)` use a two-tap confirm pattern (`btn.dataset.confirming`). Pushes undo before removing. `deleteTask` also cleans up dangling deps in all other tasks and specs.
- **Phase collapse** — Phase header rows show a ▼/▶ button in the WBS cell. `togglePhaseCollapse(phaseNum)` toggles the phase number in `collapsedPhases` and re-renders. Collapsed phases hide all sub-tasks from `visibleTasks`; the header row remains with `.phase-collapsed` opacity styling. Only active when `ganttPhaseFilter === 'all'`. State persisted to `localStorage` as `vh-collapsed-phases`.
- **Column resize** — `#gantt-resize-handle` (5px, between `#gantt-left` and `#gantt-right-col`) is a draggable divider. `initGanttColumnResize()` wires `mousedown` → tracks delta from `startX`, clamps width 150–700px, saves to `localStorage` as `vh-gantt-left-width`. No re-render needed; the name column reflows automatically.
- **Name-column resize** — `#gantt-name-col-handle` (6px) sits on the right edge of the Task Name header cell. `initGanttNameColResize()` sets CSS variable `--gantt-name-col-w` (default `1fr`), shared by `#gantt-left-header` and `.gantt-row` grid-template-columns. Drag clamps 80–400px, persisted to `vh-gantt-name-col-width`.
- **Inline date picker** — Double-clicking a Gantt bar or milestone diamond opens `#gantt-date-picker` (fixed, 210px wide) via `openGanttDatePicker(t, clientX, clientY)`. Single date input for milestones; Start + End inputs for tasks. Apply snaps to work days via `snapToWorkDay`, calls `pushUndo('edit dates')`, then `renderGantt()`. Enter = apply, Escape = cancel, outside-click dismisses. Positioned near cursor, clamped to viewport.

**Work-day utilities:**
- `parseWorkDays(str)` — `"Mon,Tue,Wed,Thu"` → `[1,2,3,4]`
- `isWorkDay(date, wds)` — boolean
- `snapToWorkDay(date, wds, dir)` — steps to nearest work day in given direction
- `countWorkDays(start, end)` — inclusive count of work days in span
- `workDaysRemaining(endDate)` — work days from today to end, min 0
- `wdDisplay(t)` — returns `{ text, cls }`: `"✓"` (done, green), `"0 wd"` (overdue, red), or `"N wd"`

**WD column:** Left task list has columns `44px 1fr 68px 40px 44px 18px` (WBS | Name | Team | WD | % | conflict). The panel itself is resizable via `#gantt-resize-handle` (default 380px, persisted as `vh-gantt-left-width`).

**localStorage keys (full list):**
- `vh-theme` — light/dark
- `vh-workdays` — work day array (JSON)
- `vh-filter-phase` / `vh-filter-team` / `vh-filter-specs-cat` / `vh-filter-specs-search`
- `vh-wt-collapsed` — collapsed weight budget groups
- `vh-collapsed-phases` — collapsed Gantt phase numbers (JSON array of ints)
- `vh-gantt-left-width` — left panel pixel width (e.g. "380px")
- `vh-zoom-gantt` / `vh-zoom-specs` / `vh-zoom-org` — per-tab zoom index
- `vh-draft` — auto-saved draft JSON (fullSnapshot + title + timestamp); removed on export/import
- `vh-gantt-name-col-width` — Task Name column pixel width (e.g. "180px"); default `1fr`

**Body grid lines:** `renderBodyGrid(svg, NS, minD, maxD, W, bodyH)` draws month boundary vertical lines (full body height) and, when `ganttZoom >= 5`, week sub-lines at reduced opacity. Non-work-day column shading has been removed.

**Light/dark mode:** `toggleTheme()` toggles `.light-mode` on `<body>`, persists to `localStorage` under key `'vh-theme'`, and calls `renderGantt()` if tasks are loaded (so SVG colors update immediately). Applied by an IIFE on page load. The `☀/🌙` button is always visible in the topbar. CSS overrides live under `body.light-mode { ... }` in the `<style>` block. Light mode uses `--bg: #f0f2f5` and `--surface: #e8eaed` (soft off-white, not pure white).

**Topbar buttons (right group):**
- `#generate-sample-btn` — hidden after first file load
- `#save-excel-btn` — shown after first file load
- `#proj-info-btn` — shown after first file load; opens project info editor in side panel
- `#theme-toggle` — always visible (☀ / 🌙)

**Event handling pattern (v2.6.0+):** No `onclick` attributes anywhere in the codebase — including dynamically-generated HTML. After setting `innerHTML`, wire buttons immediately via `querySelector`/`querySelectorAll`. Named filter helpers (`clearGanttFilters()`, `clearSpecsFilters()`) and class-based selectors (`.empty-help-btn`, `.gantt-clear-filter-btn`, `.specs-clear-filter-btn`) are used for post-render wiring. Calendar nav/close use `data-nav` / `data-close-cal` attributes and are wired alongside `data-date` day cells after each `cal.innerHTML` rebuild. Exception: `.onclick` property assignment (not HTML attribute) is acceptable when a closure must be replaced on each call (e.g. date picker `apply` function, toast undo button).

### Zoom (all tabs)

Each tab has its own zoom state and `±` toolbar buttons:

| Tab | Steps array | Default index | Mechanism |
|---|---|---|---|
| Gantt | `ZOOM_STEPS` (px/day) | 3 | Re-renders SVG at new `ganttZoom` |
| Specs | `SPECS_ZOOM_STEPS` (rem) | 2 | Sets `font-size` on `.specs-table` |
| Org | `ORG_ZOOM_STEPS` (scale factor) | 4 | CSS `transform: scale()` on the SVG + manual wrapper resize |

### Side Panel

`#side-panel` slides in from the right (fixed, 420px). Has `role="dialog"` + `aria-modal="true"`. Entry points render into `#sp-body`:
- `openSpecPanel(id)` — spec detail + linked tasks with risk warnings; all fields inline-editable
- `openTaskPanel(id)` — task detail + linked specs; also shows work days total and remaining; all fields inline-editable
- `openOrgPanel(name)` — person's profile + their team's tasks; "Edit Person" button opens `openOrgEditPanel(name)`
- `openOrgEditPanel(name|null)` — edit form for org person fields; null = add new person; `saveOrgPerson(oldName)` / `deleteOrgPerson(name)`
- `openWeightPanel(idx)` — edit form for a weight budget row at array index; `saveWeightRow(idx)` / `deleteWeightRow(idx)` / `addWeightRow()`
- `openInfoPanel()` — edit all project info key/value fields; `saveInfoPanel()` updates title/subtitle/work-days and re-renders Gantt + Program Dashboard

**Toggle behavior:** `spCurrentType` and `spCurrentId` track what is currently open. Clicking the same item a second time calls `closeSidePanel()` instead of re-rendering (toggle). `closeSidePanel()` resets both to `null`.

`showSidePanel()` — opens panel, adjusts layout margins, auto-focuses first focusable element via `requestAnimationFrame`. Tab/Shift+Tab are trapped within the panel. Escape key closes it.

`closeSidePanel()` — closes panel, restores focus to `spOpener`.

### Program Dashboard

`renderProgDash()` computes everything from `ProjectData.tasks` and `ProjectData.specs` — no extra state needed. Phase labels call `getPhaseNames()` first, then fall back to `PHASE_NAMES_FALLBACK`. Team Workload rows use `toggleTeamRow(el)` (a global function) to expand/collapse a sibling `.team-dropdown` div. The dropdown is built into the innerHTML at render time.

### Phase Names

`getPhaseNames()` scans `ProjectData.info` for keys matching `Phase N Name` (N = 1–20) and returns a `{ [phaseNumber]: name }` map. The constant formerly named `PHASE_NAMES` is now `PHASE_NAMES_FALLBACK` — used only when no matching key exists in `ProjectData.info`. Both `renderGantt()` (filter dropdown labels) and `renderProgDash()` (phase bar labels) call `getPhaseNames()`.

### Weight Budget

`renderWeightBudget()` renders a bar chart where each `.wt-bar-wrap` carries `data-est`, `data-tgt`, `data-total`, and `data-name` attributes. `showWtTooltip(e, el)` and `hideWtTooltip()` read those attributes and reuse the shared `#tooltip` element. Bar color: green = estimated ≤ target, yellow = over target.

Individual item rows carry `data-wt-idx` (array index). Clicking a row (not the bar) opens `openWeightPanel(idx)`. A `+ Add Row` button in `#wt-toolbar` calls `addWeightRow()`. Delete uses the two-tap confirm pattern with 3-second timeout.

### Org Chart

Built with a recursive SVG layout algorithm:
1. `buildTree(nodes)` → constructs parent/child links
2. `calcSubW(node)` → recursively computes subtree width for layout
3. `assignPos(node, x, depth)` → assigns x/y coordinates
4. SVG nodes and connector lines are appended to `#org-svg-wrap`

SVG `<g>` card nodes have `tabindex=0`, `role=button`, `aria-label`, and `keydown` handler for Enter/Space. A `+ Add Person` button in `#org-toolbar` opens `openOrgEditPanel(null)`. Renaming a person in `saveOrgPerson` cascades to all `reportsTo` arrays.

### Cross-linking (core value prop)

`ProjectData.specs[].depIds[]` references task IDs. The spec side panel resolves these against `ProjectData.tasks` to show impact analysis and risk warnings (TBD spec + already-started dependent task = risk flag).

### Sample Data

`generateSampleExcel()` generates a complete **TW-2 Hybrid-Electric Tilt-Wing UAM** program workbook: 32 schedule tasks across 6 WBS phases, 27 specs across 6 categories, a 17-person org chart, and a 13-subsystem weight budget. The Project Info sheet uses the current field names (`Project Subtitle`, `File Administrator`, `Program End`, `Phase N Name` rows, `Work Days = Mon,Tue,Wed,Thu,Fri`, `Weight Unit = lb`). Use this to test all tabs. The button is hidden after any file is loaded.

### Rendering Pattern

Every load triggers a full re-render of all tabs. There is no incremental update — the entire SVG or table is rebuilt on each render call. The tooltip (`#tooltip`) is shared across all tabs and positioned via `positionTooltip(e)`.

## Versioning

Format: `vMAJOR.MINOR.PATCH` (semantic versioning).

- **PATCH**: bug fixes, copy changes, CSS tweaks — no data/schema/layout changes
- **MINOR**: new features or interactions, backward-compatible
- **MAJOR**: localStorage schema break, full restructure, or v2.0.0 milestone gate

**Two sync points per release** (both must be updated):
1. Line 1 HTML comment: `<!-- Program Dashboard Suite vX.Y.Z — YYYY-MM-DD -->`
2. `APP_VERSION` JS constant (~line 1182): `const APP_VERSION = 'vX.Y.Z';`

**Git tag every release**: `git tag vX.Y.Z <commit-sha>` on the version-bump commit.

### Release History

| Version | Feature | Status |
|---|---|---|
| **v1.22.0** | Undo/Redo Completion | Done |
| **v1.23.0** | Safety & Validation | Done |
| **v1.24.0** | Delete Operations | Done |
| **v1.25.0** | Keyboard Accessibility | Done |
| **v1.26.0** | Code Quality Pass | Done |
| **v2.0.0** | Milestone Gate | Done |
| **v2.1.0** | In-app editing: Weight Budget, Org Chart, Project Info | Done |
| **v2.2.0** | Phase collapse/expand on Gantt | Done |
| **v2.3.0** | Draggable left-panel resize handle | Done |
| **v2.4.0** | Fix safeSetItem recursion bug; auto-save draft to localStorage; beforeunload warning | Done |
| **v2.5.0** | Inline date picker on double-click of Gantt bars / milestones | Done |
| **v2.6.0** | Code cleanup: eliminate all inline onclick attributes | Done |
| **v2.7.0** | Gantt name-column resize + export reminder toast | Done — current release |
