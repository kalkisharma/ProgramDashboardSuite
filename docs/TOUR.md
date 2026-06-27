# Codebase Tour

A guided walkthrough for developers new to this codebase. Read this before CLAUDE.md; CLAUDE.md is the reference, this is the orientation.

---

## What the app does

Program Dashboard Suite is a single-page web app for managing aerospace/vehicle development programs. A user uploads an Excel workbook; the app parses it into an in-memory data model and renders several views: a drag-and-drop Gantt chart, a specifications table, a program dashboard, a weight budget, an org chart, and a status report (with PowerPoint export). A separate Requirements tab is a standalone CSV viewer, independent of the Excel workbook. All edits happen in-browser with undo/redo, and the user can export back to Excel.

There is no server. All logic is client-side JavaScript (ES modules, built with Vite into a single `dist/ProgramDashboardSuite.html`).

---

## How to run it

```
npm install
npm run dev     # dev server at http://localhost:5173
npm run build   # outputs dist/ProgramDashboardSuite.html (single self-contained file)
npm test        # Vitest unit tests
```

Load sample data with the "Generate Sample" button to see the Excel-driven tabs populated.

---

## Module map

```
src/
  main.js               ← app entry point: init, side panels, event wiring
  state.js              ← single mutable state object shared by all modules
  styles.css            ← all CSS

  parse.js              ← Excel → ProjectData (pure, no side effects)
  excel.js              ← ProjectData → Excel workbook (pure, no side effects)

  constants.js          ← shared constants (zoom steps, row height, etc.)
  colors.js             ← color palettes and per-category/team color functions
  utils.js              ← date math, escaping, work-day utilities

  compute/
    criticalPath.js     ← Kahn's topological sort → Set of critical task IDs
    conflicts.js        ← detects tasks starting before predecessors finish
    wbs.js              ← WBS renumbering + cycle detection

  render/
    gantt.js            ← Gantt chart SVG rendering + all inline edits
    specs.js            ← Specifications table rendering
    progDash.js         ← Program Dashboard KPIs and phase/team bars
    weightBudget.js     ← Weight Budget chart and group collapse
    orgChart.js         ← Org chart SVG layout (tree algorithm)
    statusReport.js     ← RAG open-task table + PowerPoint export (pptxgenjs)
    requirements.js     ← standalone requirements CSV viewer

  ui/
    panelBase.js        ← showSidePanel / closeSidePanel (shared shell)
    tooltip.js          ← shared tooltip element (show/hide/position)
    toast.js            ← toast notifications + safeRender + safeSetItem
    rowReorder.js       ← Gantt row drag-and-drop reorder
    taskOps.js          ← add/delete tasks and specs

  core/
    undo.js             ← pushUndo, fullSnapshot, applyUndo/Redo, draft auto-save
```

---

## The data model

Everything lives in `state.ProjectData`:

```js
ProjectData: {
  info:    {},        // key/value pairs from "Project Info" sheet
  tasks:   [],        // schedule rows — { id, wbs, name, start, end, pct, deps, team, milestone, notes }
  specs:   [],        // specifications — { id, category, name, value, units, status, group, notes, depIds[] }
  org:     [],        // org chart people — { name, title, team, reportsTo[], email }
  weights: [],        // weight budget rows — { subsystem, group, target, estimated, status, notes }
}
```

`state.originalTasks` is a deep copy taken at parse time; it's used by "Reset to Imported" to restore the schedule.

All other app state (zoom levels, filters, drag state, undo stacks, side panel identity) lives in the same `state` object in `state.js`. **Never introduce module-level mutable variables elsewhere** — put them in `state.js`.

---

## The rendering pattern

Every mutation triggers a **full re-render** of the affected view. There is no virtual DOM or incremental update. The render functions (`renderGantt`, `renderSpecs`, etc.) rebuild the entire SVG or table from scratch each time.

This is intentional: the data set is small (hundreds of tasks, not millions), so full re-render is fast enough and eliminates an entire class of stale-view bugs.

The entry point for a full re-render of all tabs is `renderDashboard()` in `main.js`, which calls each render function via `safeRender(fn, label)` (a thin try/catch wrapper that shows a toast on error instead of crashing).

---

## The `state.handlers` pattern

**The problem:** `render/gantt.js` needs to call `openTaskPanel()` when the user clicks a bar. But `openTaskPanel` is defined in `main.js`. If `gantt.js` imports from `main.js`, and `main.js` imports from `gantt.js`, that's a circular dependency.

**The solution:** `state.handlers` is a registry of function references. `main.js` registers its functions into it at startup:

```js
state.handlers.openTaskPanel = openTaskPanel;
state.handlers.openSpecPanel = openSpecPanel;
// etc.
```

Render modules call `state.handlers.openTaskPanel(id)` instead of importing directly. The render module depends on `state.js`; `main.js` depends on the render module. No cycle.

Any function that render modules need to call back into `main.js` must go through `state.handlers`.

---

## The undo/redo pattern

`fullSnapshot()` takes a deep copy of all five `ProjectData` collections. `pushUndo(label)` saves a snapshot to `state.undoStack` (max 50 entries). Undo pops from the stack, pushes the current state to `redoStack`, and restores via `_restoreSnapshot()`.

**Rule:** call `pushUndo(label)` *before* mutating `ProjectData`. If you forget, undo will capture the already-mutated state and restore to it — the user loses one step.

Draft auto-save (`scheduleDraftSave`) debounces 3 seconds after each `pushUndo` and writes a full snapshot to `localStorage` under `vh-draft`. The draft banner on load offers to restore it.

---

## The side panel pattern

The side panel (`#side-panel`) is a fixed 420px drawer on the right edge. It has a single `#sp-body` div that each opener function renders into.

Opening the same item a second time closes the panel (toggle). This is managed by `state.spCurrentType` and `state.spCurrentId`.

`showSidePanel()` / `closeSidePanel()` in `ui/panelBase.js` handle the DOM transitions, focus trapping, and focus restoration. Every opener function calls `showSidePanel()` after populating `#sp-body`.

---

## The inline-edit pattern

Gantt inline edits (bar drag, and click-to-edit on the task name / team / % cells) all follow this shape:

1. User interaction replaces a DOM element with an `<input>` or `<select>`
2. A `commit()` closure captures the original value for cancel/escape
3. On commit: call `pushUndo(label)`, mutate the data object, call the render function
4. The render function rebuilds the element from the updated data, replacing the input

Tab/Enter confirms; Escape restores the original and re-renders without pushing undo.

Task and spec *detail* editing (notes, dependencies, spec value/status, etc.) instead uses explicit edit forms in the side panel: the static detail view has an **Edit Task** / **Edit Spec** button that swaps `#sp-body` for a form, and a **Save Changes** button commits via `pushUndo` → mutate → re-render → reopen the panel. See `openSpecEditPanel` / `saveSpecEdits` and `openTaskEditPanel` / `saveTaskEdits` in `main.js`.

---

## Suggested reading order

1. **`src/state.js`** — understand the full shape of app state before touching anything else
2. **`src/main.js` lines 1–80** — imports, function index, APP_VERSION, DOMContentLoaded
3. **`src/parse.js`** — how Excel data becomes `ProjectData` (pure functions, easy to read)
4. **`src/render/specs.js`** — the simplest render module; shows the full render → event-wire → handler pattern without SVG complexity
5. **`src/render/gantt.js` — `renderGantt()`** — the most complex render; read after you're comfortable with the pattern
6. **`src/core/undo.js`** — understand undo before making any edits that mutate `ProjectData`

---

## Common gotchas

**Dates are `Date` objects, not strings.** `JSON.stringify` converts them to ISO strings; after `JSON.parse` you must `new Date(t.start)` to restore them. This is why `_restoreSnapshot` explicitly reconstructs dates.

**`TODAY` is module-level and set once at import time.** It does not update if the browser tab stays open past midnight. This is intentional for consistency within a session.

**`recalcWBS` mutates the array in place.** Call it after any reorder or delete that changes task positions, or WBS numbers will drift.

**Side panel openers are toggling.** If your code calls `openTaskPanel(id)` when that panel is already open for `id`, it closes instead. Guard against this if you're opening panels programmatically.

**`safeRender` swallows errors.** If a render function throws, the user sees a toast but the tab shows stale content. Check the console during development.

**`localStorage` writes use `safeSetItem`.** Never call `localStorage.setItem` directly — it can throw `QuotaExceededError` on Safari private mode and some mobile browsers.
