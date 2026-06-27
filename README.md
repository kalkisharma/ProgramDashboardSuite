# Program Dashboard Suite

A client-side program dashboard for aerospace and vehicle development programs. Drop an Excel file into a browser and get an interactive Gantt chart, specifications tracker, program dashboard, weight budget, org chart, and status report (with one-click PowerPoint export) — plus a standalone requirements (CSV) viewer. No server, no install, no login.

**Intended audiences:** Program managers, engineers, and leadership stakeholders.

<!-- Add a screenshot here once available: ![Dashboard screenshot](docs/screenshot.png) -->

---

## Getting Started

**Distributed as a single HTML file.** Download `dist/ProgramDashboardSuite.html` from the [latest release](https://github.com/kalkisharma/ProgramDashboardSuite/releases) and open it in any modern browser — no install, no server, no internet connection required.

### Load your data

Drag your `.xlsx` file anywhere onto the page, or click **Browse for File**. The dashboard auto-populates immediately.

To try the tool before building your own Excel file, click **Generate Sample Excel** on the landing page. This downloads a complete sample program (TW-2 Hybrid-Electric Tilt-Wing UAM) that populates every Excel-driven tab — Gantt, Specifications, Program Dashboard, Weight Budget, Org Chart, and Status Report. The Requirements tab is independent; it loads its own CSV (see below).

---

## Excel File Format

Sheet names are **case-sensitive**. The tool silently skips unrecognized sheets — if a tab is missing, check the sheet name matches exactly.

| Sheet | Required | Key columns |
|---|---|---|
| `Project Info` | Yes | Field, Value |
| `Schedule` | Yes | Task ID, WBS, Task Name, Category, Start Date, End Date, % Complete, Dependencies, Responsible Team, Milestone (Y/N), Notes |
| `Specifications` | Yes | Spec ID, Category, Specification Name, Value, Units, Status, Responsible Group, Notes, Dependent Task IDs |
| `Org Chart` | Optional | Name, Title, Team, Reports To, Email — `Reports To` accepts a single name or a comma-separated list for matrix reporting (e.g. `Primary Manager, Secondary Manager`); first name determines tree position, additional names render as dashed lines |
| `Weight Budget` | Optional | Subsystem, Group, Target Weight (lb), Estimated Weight (lb), Status, Notes |

### Project Info recognized fields

| Field | Description |
|---|---|
| `Project Title` | Displayed in the top-left header |
| `Project Subtitle` | Short program identifier (e.g. `TW-2`) |
| `File Administrator` | Shown next to the subtitle |
| `Program Start` | Informational |
| `Program End` | Informational |
| `Work Days` | Comma-separated work days (e.g. `Mon,Tue,Wed,Thu,Fri`). Default: Mon–Fri |
| `Phase 1 Name` … `Phase 20 Name` | Overrides built-in phase labels in the Gantt filter and Program Dashboard |

---

## Dashboard Tabs

| Tab | Best for | Description |
|---|---|---|
| **Gantt Chart** | Engineers, PMs | Full WBS schedule with dependency arrows, today line, milestones, zoom, and phase/team filters |
| **Specifications** | Engineers | Performance specs with Achieved/Target/TBD status and cross-linked tasks |
| **Program Dashboard** | Leadership, PMs | KPI cards, phase progress bars, spec status summary, and team workload |
| **Weight Budget** | Engineers | Subsystem mass budget bar chart vs. targets (shown only when sheet is present) |
| **Org Chart** | PMs, Leadership | Reporting hierarchy with team task lookup (shown only when sheet is present) |
| **Status Report** | Leadership, PMs | Open-task table with RAG status (Overdue / At Risk / On Track), sortable and filterable; one-click 3-slide PowerPoint export |
| **Requirements** | Engineers, Systems | Standalone CSV viewer with search, sort, per-column filters, and column visibility — works independently of your Excel file |

Click the `?` button in the top-right for a built-in guide covering each tab, the full Excel schema, and troubleshooting steps.

---

## Gantt Editing

Changes are made directly in the browser and exported back to Excel with **Export to Excel**.

| Action | How |
|---|---|
| Move a task bar | Drag the center of the bar (hold 300 ms to activate) |
| Resize a task | Drag the left or right edge of the bar |
| Edit task dates | Double-click any bar or milestone diamond to open the date picker |
| Reorder tasks | Hover the WBS column to reveal the drag handle; drag to new position |
| Edit task name | Click the name cell |
| Change team | Click the team cell |
| Edit % complete | Click the % cell |
| Edit task details / notes | Open a task in the side panel → click **Edit Task** → edit fields → **Save Changes** |
| Add a dependency | Open a task in the side panel → click **+ Add dependency**; search by name, WBS, or ID |
| Remove a dependency | Open a task in the side panel → click `×` on a "Depends On" card |
| Add a task | Click **+ Add Task** in the toolbar |
| Delete a task | Open a task in the side panel → click **Delete Task** (two-tap confirm) |
| Reset all edits | Click **↺ Reset to Imported** — reverts to the last imported state |
| Undo / Redo | Click ⟲/⟳ in the toolbar or use Ctrl+Z / Ctrl+Y |
| Export to Excel | Click **Export to Excel** — saves a dated `.xlsx` re-importable into this tool |

Bar drags snap to configured work days. Dependency arrows and status rings track the bar in real time during drag. The dependency picker prevents cycles — tasks that would create a circular dependency are shown greyed out.

All edits are tracked in an undo/redo stack (max 50 entries). An auto-save draft is written to `localStorage` every 3 seconds after any edit; if you close and reopen the page without exporting, a banner offers to restore the draft.

---

## Browser Support

| Browser | Support |
|---|---|
| Chrome / Edge (current) | Full |
| Firefox (current) | Full |
| Safari (current) | Full |
| Internet Explorer | Not supported |

---

## Offline Use

The tool runs entirely offline. The distributed `dist/ProgramDashboardSuite.html` is fully self-contained — all JS and CSS are inlined. No internet connection is required or used.

---

## For Developers

### Quick start

```bash
git clone https://github.com/kalkisharma/ProgramDashboardSuite.git
cd ProgramDashboardSuite
npm install
npm run dev       # dev server at http://localhost:5173
npm test          # run unit tests (170 tests, ~700ms)
npm run build     # outputs dist/ProgramDashboardSuite.html (single inlined file)
```

### Project structure

```
src/
  main.js                  # app init, side panels, event wiring (~1460 lines)
  state.js                 # single exported mutable state object
  styles.css               # all CSS
  constants.js             # ZOOM_STEPS, RH, HH, PHASE_NAMES_FALLBACK, …
  colors.js                # color maps + phaseColor(), ganttColor(), teamColor()
  utils.js                 # esc, parseDate, fmt, daysBetween, work-day utilities
  parse.js                 # pure sheet-parsing functions (no DOM)
  excel.js                 # pure workbook-building functions (no DOM)
  compute/
    criticalPath.js        # CPM (pure)
    conflicts.js           # dependency overlap detection (pure)
    wbs.js                 # WBS renumbering + cycle detection (pure)
  render/
    gantt.js               # Gantt SVG rendering + inline edits + bar drag
    specs.js               # Specifications table rendering
    progDash.js            # Program Dashboard KPIs and phase/team bars
    weightBudget.js        # Weight Budget chart
    orgChart.js            # Org chart SVG layout
    statusReport.js        # RAG open-task table + PowerPoint export (pptxgenjs)
    requirements.js        # standalone requirements CSV viewer
  ui/
    panelBase.js           # showSidePanel / closeSidePanel
    tooltip.js             # shared tooltip element
    toast.js               # toast notifications + safeRender
    rowReorder.js          # Gantt row drag-and-drop reorder
    taskOps.js             # add/delete tasks and specs
  core/
    undo.js                # pushUndo, applyUndo/Redo, draft auto-save
  __tests__/               # Vitest unit tests (170 tests across 7 files)
docs/
  TOUR.md                  # guided codebase walkthrough for new contributors
  FLOW.md                  # key data flows as Mermaid diagrams
index.html                 # HTML shell
dist/ProgramDashboardSuite.html            # build output — single self-contained file (git-ignored)
```

The build uses [vite-plugin-singlefile](https://github.com/richardtallent/vite-plugin-singlefile) to inline all JS and CSS into one `dist/ProgramDashboardSuite.html`. This is what gets distributed to end users.

### Architecture primer

Start with **[docs/TOUR.md](docs/TOUR.md)** for a guided walkthrough of the module layout, data model, rendering pattern, and common gotchas. Then read **[docs/FLOW.md](docs/FLOW.md)** for key data flows (file load, bar drag, undo/redo) as Mermaid diagrams.

**[CLAUDE.md](CLAUDE.md)** is the full developer reference — state model, localStorage keys, versioning convention, and the complete module API table. It is the authoritative source for release history.

### Versioning

Two sync points must be updated together on every release:
1. Line 1 of `index.html` — `<!-- Program Dashboard Suite vX.Y.Z — YYYY-MM-DD -->`
2. `APP_VERSION` constant in `src/main.js`

Then:
```bash
git tag vX.Y.Z <commit-sha>
git push origin vX.Y.Z
npm run build
gh release create vX.Y.Z dist/ProgramDashboardSuite.html --title "vX.Y.Z" --notes "..."
```

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
