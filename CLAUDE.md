# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

No build system. Open `dashboard.html` directly in any modern browser, or:

```
python -m http.server
# then open localhost:8000/dashboard.html
```

## Architecture

**Single-file vanilla JS app** (`dashboard.html`, ~2000 lines). All HTML, CSS, and JavaScript are in one file. The only external dependency is SheetJS loaded from CDN for Excel parsing.

### Global State

```javascript
const S = { info: {}, tasks: [], specs: [], org: [], weights: [] };
```

- `S.info` — key/value pairs from the "Project Info" sheet
- `S.tasks[]` — `{ id, wbs, name, category, start, end, pct, deps, team, milestone, notes }`
- `S.specs[]` — `{ id, category, name, value, units, status, group, notes, depIds[] }`
- `S.org[]` — `{ name, title, team, reportsTo, email }`
- `S.weights[]` — `{ subsystem, group, target, estimated, status, notes }`

`parseWorkbook(wb)` resets all five arrays, then populates them from the corresponding sheets. `renderDashboard()` is called after every load and re-renders all tabs.

### Excel Input Format

| Sheet | Required | Key columns |
|---|---|---|
| Project Info | Yes | Field, Value (key/value pairs) |
| Schedule | Yes | Task ID, WBS, Task Name, Category, Start Date, End Date, % Complete, Dependencies, Responsible Team, Milestone, Notes |
| Specifications | Yes | Spec ID, Category, Specification Name, Value, Units, Status, Responsible Group, Notes, Dependent Task IDs |
| Org Chart | Optional | Name, Title, Team, Reports To, Email |
| Weight Budget | Optional | Subsystem, Group, Target Weight (lb), Estimated Weight (lb), Status, Notes |

Missing optional sheets are silently skipped; their tabs are hidden. Missing required sheets render partial data.

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
- `#gantt-left` (task list) and `#gantt-right` (SVG timeline) scroll vertically in sync via paired `scroll` listeners

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
- `openTaskPanel(id)` — task detail + linked specs
- `openOrgPersonPanel(name)` — person's profile + their team's tasks

`showSidePanel()` / `closeSidePanel()` are shared helpers. When the org tab is active, `showSidePanel()` adds `padding-right: 440px` to `#org-container` so tree nodes aren't hidden behind the panel.

### Program Dashboard

`renderProgDash()` computes everything from `S.tasks` and `S.specs` — no extra state needed. Team Workload rows use `toggleTeamRow(el)` (a global function) to expand/collapse a sibling `.team-dropdown` div. The dropdown is built into the innerHTML at render time.

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

`generateSampleExcel()` generates a complete **TW-2 Hybrid-Electric Tilt-Wing UAM** program workbook: 32 schedule tasks across 6 WBS phases, 27 specs across 6 categories, a 17-person org chart, and a 13-subsystem weight budget. Use this to test all tabs.

### Rendering Pattern

Every load triggers a full re-render of all tabs. There is no incremental update — the entire SVG or table is rebuilt on each render call. The tooltip (`#tooltip`) is shared across all tabs and positioned via `positionTooltip(e)`.
