# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

No build system. Open `dashboard.html` directly in any modern browser, or:

```
python -m http.server
# then open localhost:8000/dashboard.html
```

## Architecture

**Single-file vanilla JS app** (`dashboard.html`, ~2850 lines). All HTML, CSS, and JavaScript are in one file. SheetJS is vendored locally as `xlsx.full.min.js` (no CDN).

### Global State

```javascript
const S = { info: {}, tasks: [], specs: [], org: [], weights: [] };
let S_tasksOriginal = [];          // deep-copy at parse time; used by resetGanttToImported()
let ganttWorkDays   = [1,2,3,4];   // Mon–Thu; parsed from Project Info "Work Days" key
let spCurrentType = null; // 'spec' | 'task' | 'org' — tracks what the side panel is showing
let spCurrentId   = null; // specId string, taskId number, or person name string
let barDrag = { active: false, taskId: null, mode: null, ... }; // Gantt bar drag state
let barEls  = {};    // taskId → { bgRect, progRect, outlineRect, midY } (or { diamond, midY })
let rowDrag = { active: false, srcIdx: null, dropIdx: null, rowCount: 0, lb: null, ghost: null, indicator: null };
```

- `S.info` — key/value pairs from the "Project Info" sheet
- `S.tasks[]` — `{ id, wbs, name, category, start, end, pct, deps, team, milestone, notes }`
- `S.specs[]` — `{ id, category, name, value, units, status, group, notes, depIds[] }`
- `S.org[]` — `{ name, title, team, reportsTo: string[], email }` — `reportsTo` is always an array; `[0]` is the primary manager (determines tree position); `slice(1)` are secondary managers (dashed lines)
- `S.weights[]` — `{ subsystem, group, target, estimated, status, notes }`

`parseWorkbook(wb)` resets all five arrays, then populates them from the corresponding sheets, deep-copies `S.tasks` into `S_tasksOriginal`, and applies the `Work Days` Project Info key. `renderDashboard()` is called after every load and re-renders all tabs.

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
| `Work Days` | Comma-separated work days (e.g. `"Mon,Tue,Wed,Thu"`); default Mon–Thu if absent |

Phase names from `Phase N Name` rows override the built-in `PHASE_NAMES_FALLBACK` array everywhere they appear (Gantt filter labels, Program Dashboard phase bars).

### Tabs

| Tab | Panel ID | Visibility | Render function |
|---|---|---|---|
| Gantt Chart | `#gantt-panel` | Always | `renderGantt()` |
| Vehicle Specifications | `#specs-panel` | Always | `renderSpecs()` / `renderSpecTable()` |
| Program Dashboard | `#prog-panel` | Always | `renderProgDash()` |
| Weight Budget | `#weight-panel` | Only if `S.weights.length` | `renderWeightBudget()` |
| Org Chart | `#org-panel` | Only if `S.org.length` | `renderOrgChart()` |

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

**Gantt Filters:** The toolbar contains two `<select>` dropdowns (Phase and Team). State is held in `ganttPhaseFilter` / `ganttTeamFilter` (default `'all'`). `setGanttPhaseFilter()` / `setGanttTeamFilter()` update state and call `renderGantt()`. The filter builds a `visibleTasks` subset; the SVG date axis always spans the full `S.tasks` date range so the timeline doesn't shift when filtering. Dependency arrows are only drawn between tasks that are both visible.

**Interactive editing (Gantt):** All edits operate on `S.tasks` directly and call `renderGantt()` to commit.

- **Bar drag** — `mousedown` on a bar hit area (`data-taskid`) routes to `startBarDrag()`. Zone is determined by cursor position within 8px of left/right edge (`resize-left`/`resize-right`) or center (`move`). During drag, SVG elements are updated directly via `barEls[id]` (no full re-render). `snapToWorkDay()` keeps start/end on configured work days. A floating `#gantt-drag-label` shows new dates + work day counts. Full re-render fires on `mouseup`. Milestone bars use a diamond element stored as `barEls[id].diamond`.
- **Row reorder** — Hover a sub-task WBS cell to reveal the `⠿` affordance and a `grab` cursor. The entire `.g-wbs-wrap` div (class `g-wbs-draggable`) is the mousedown target — not the tiny `⠿` span, which has `pointer-events:none`. `startRowDrag()` sets `rowDrag.active = true`, stores `rowDrag.lb`, and appends a `position:fixed` ghost + indicator to `document.body`. The existing document-level listeners in `initGanttPan` call `doRowDragMove()` on mousemove and `endRowDrag()` on mouseup, which commit the splice and call `recalcWBS()` to renumber sequentially within phases. Phase headers (no dot, or ending `.0`) never get `g-wbs-draggable`. Disabled when either filter is active.
- **Inline name edit** — Click `.g-name` → `startNameEdit()` replaces span with `<input>`; Enter/blur confirms (non-empty only), Escape cancels.
- **Team dropdown** — Click `.g-team` → `startTeamEdit()` replaces span with `<select>` populated from unique sorted teams; change commits, Escape/blur-without-change restores.
- **% complete edit** — Click `.g-pct` → `startPctEdit()` replaces span with `<input type="number">`; value is clamped 0–100 and rounded; Escape cancels.
- **Add Task** — `addGanttTask()` appends a new task to the last phase with name `"New Task N"`, first-alpha team, 0%, and start = first program work day.
- **Reset** — `resetGanttToImported()` deep-copies `S_tasksOriginal` back into `S.tasks` and re-renders.
- **Save to Excel** — `saveToExcel()` rebuilds all 5 sheets from current `S.*` state using SheetJS and downloads `"[Project Title] - YYYY-MM-DD.xlsx"`. The column layout matches what `parseWorkbook()` expects, so the file can be re-imported.

**Work-day utilities:**
- `parseWorkDays(str)` — `"Mon,Tue,Wed,Thu"` → `[1,2,3,4]`
- `isWorkDay(date, wds)` — boolean
- `snapToWorkDay(date, wds, dir)` — steps to nearest work day in given direction
- `countWorkDays(start, end)` — inclusive count of work days in span
- `workDaysRemaining(endDate)` — work days from today to end, min 0
- `wdDisplay(t)` — returns `{ text, cls }`: `"✓"` (done, green), `"0 wd"` (overdue, red), or `"N wd"`

**WD column:** Left task list has a 5th column (WD) showing remaining work days. Grid is `44px 1fr 68px 40px 44px` (WBS | Name | Team | WD | %).

**Body grid lines:** `renderBodyGrid(svg, NS, minD, maxD, W, bodyH)` draws month boundary vertical lines (full body height) and, when `ganttZoom >= 5`, week sub-lines at reduced opacity. Non-work-day column shading has been removed.

**Light/dark mode:** `toggleTheme()` toggles `.light-mode` on `<body>`, persists to `localStorage` under key `'vh-theme'`, and calls `renderGantt()` if tasks are loaded (so SVG colors update immediately). Applied by an IIFE on page load. The `☀/🌙` button is always visible in the topbar. CSS overrides live under `body.light-mode { ... }` in the `<style>` block. Light mode uses `--bg: #f0f2f5` and `--surface: #e8eaed` (soft off-white, not pure white).

**Topbar buttons (right group):**
- `#generate-sample-btn` — hidden after first file load
- `#save-excel-btn` — shown after first file load
- `#theme-toggle` — always visible (☀ / 🌙)

### Zoom (all tabs)

Each tab has its own zoom state and `±` toolbar buttons:

| Tab | Steps array | Default index | Mechanism |
|---|---|---|---|
| Gantt | `ZOOM_STEPS` (px/day) | 3 | Re-renders SVG at new `ganttZoom` |
| Specs | `SPECS_ZOOM_STEPS` (rem) | 2 | Sets `font-size` on `.specs-table` |
| Org | `ORG_ZOOM_STEPS` (scale factor) | 4 | CSS `transform: scale()` on the SVG + manual wrapper resize |

### Side Panel

`#side-panel` slides in from the right (fixed, 420px). Three entry points each render different content into `#sp-body`:
- `openSpecPanel(id)` — spec detail + linked tasks with risk warnings
- `openTaskPanel(id)` — task detail + linked specs; also shows work days total and remaining
- `openOrgPanel(name)` — person's profile + their team's tasks

**Toggle behavior:** `spCurrentType` and `spCurrentId` track what is currently open. Clicking the same item a second time calls `closeSidePanel()` instead of re-rendering (toggle). `closeSidePanel()` resets both to `null`.

`showSidePanel()` / `closeSidePanel()` are shared helpers. When the org tab is active, `showSidePanel()` adds `padding-right: 440px` to `#org-container` so tree nodes aren't hidden behind the panel.

### Program Dashboard

`renderProgDash()` computes everything from `S.tasks` and `S.specs` — no extra state needed. Phase labels call `getPhaseNames()` first, then fall back to `PHASE_NAMES_FALLBACK`. Team Workload rows use `toggleTeamRow(el)` (a global function) to expand/collapse a sibling `.team-dropdown` div. The dropdown is built into the innerHTML at render time.

### Phase Names

`getPhaseNames()` scans `S.info` for keys matching `Phase N Name` (N = 1–20) and returns a `{ [phaseNumber]: name }` map. The constant formerly named `PHASE_NAMES` is now `PHASE_NAMES_FALLBACK` — used only when no matching key exists in `S.info`. Both `renderGantt()` (filter dropdown labels) and `renderProgDash()` (phase bar labels) call `getPhaseNames()`.

### Weight Budget

`renderWeightBudget()` renders a bar chart where each `.wt-bar-wrap` carries `data-est`, `data-tgt`, `data-total`, and `data-name` attributes. `showWtTooltip(e, el)` and `hideWtTooltip()` read those attributes and reuse the shared `#tooltip` element. Bar color: green = estimated ≤ target, yellow = over target.

### Org Chart

Built with a recursive SVG layout algorithm:
1. `buildTree(nodes)` → constructs parent/child links
2. `calcSubW(node)` → recursively computes subtree width for layout
3. `assignPos(node, x, depth)` → assigns x/y coordinates
4. SVG nodes and connector lines are appended to `#org-svg-wrap`

### Cross-linking (core value prop)

`S.specs[].depIds[]` references task IDs. The spec side panel resolves these against `S.tasks` to show impact analysis and risk warnings (TBD spec + already-started dependent task = risk flag).

### Sample Data

`generateSampleExcel()` generates a complete **TW-2 Hybrid-Electric Tilt-Wing UAM** program workbook: 32 schedule tasks across 6 WBS phases, 27 specs across 6 categories, a 17-person org chart, and a 13-subsystem weight budget. The Project Info sheet uses the current field names (`Project Subtitle`, `File Administrator`, `Program End`, `Phase N Name` rows, `Work Days = Mon,Tue,Wed,Thu`). Use this to test all tabs. The button is hidden after any file is loaded.

### Rendering Pattern

Every load triggers a full re-render of all tabs. There is no incremental update — the entire SVG or table is rebuilt on each render call. The tooltip (`#tooltip`) is shared across all tabs and positioned via `positionTooltip(e)`.
