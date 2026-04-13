# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

There is no build system. Open `dashboard.html` directly in any modern browser. No server, npm, or compilation required.

For a simple local server: `python -m http.server` then navigate to `localhost:8000/dashboard.html`

## Architecture

This is a **single-file vanilla JS app** (`dashboard.html`, ~930 lines). All HTML, CSS, and JavaScript live in one file with no external dependencies except SheetJS loaded from CDN.

### Data Flow

1. User uploads/drops an `.xlsx` file → SheetJS parses it → global state `S` is populated → `renderDashboard()` is called
2. `S` holds three sub-objects: `S.info` (project metadata), `S.tasks[]` (schedule items), `S.specs[]` (technical specs)
3. Two views are rendered from this state: a Gantt chart and a Specifications table

### Excel Input Format

The app expects an `.xlsx` with exactly three sheets:
- **"Project Info"** — key/value pairs for project metadata
- **"Schedule"** — task list with columns: Task ID, WBS, Name, Category, Start, End, % Complete, Dependencies, Team, Milestone, Notes
- **"Specifications"** — spec list with columns: Spec ID, Category, Name, Value, Units, Status, Responsible Group, Notes, Dependent Tasks

Malformed files or missing sheets fail silently or render partial data.

### Key Sections (line numbers approximate)

| Lines | Content |
|-------|---------|
| 6–322 | CSS (dark theme, CSS custom properties, layout) |
| 324–402 | HTML structure (topbar, dropzone, gantt panel, specs panel, side panel) |
| 406–435 | App init, tab switching |
| 436–526 | File loading (`loadFile`), SheetJS parsing, state population |
| 542–714 | Gantt chart rendering — custom SVG, no charting library |
| 734–787 | Specs table rendering with category filter |
| 789–842 | Side panel (spec detail + linked task risk analysis) |
| 844–925 | Sample Excel generator (downloads a pre-filled NX-1 EV program template) |

### Gantt Chart

Drawn entirely with raw SVG elements created via `document.createElementNS`. Scale is hardcoded at **4px/day, 36px/row**. Renders task bars (colored by category), milestone diamonds, dependency arrows (curved), and a "today" line. The left sidebar (`#gantt-left`) and SVG timeline (`#gantt-right`) scroll vertically in sync.

### Specs Panel

Filterable table. Clicking a row opens `#side-panel` (slides in from right) showing the spec's full detail and all dependent tasks. Risk warnings appear when a spec's status is TBD but a dependent task has already started.

### Task/Spec Categories

**Task categories** (5 phases): Concept, Engineering, Prototype, Validation, Launch — each with a distinct color.

**Spec categories** (6 domains): Powertrain, Chassis, Electrical, Body, Safety, Software.

### Cross-linking

Specs reference tasks via `dependentTaskIds[]`. The side panel resolves these IDs against `S.tasks` to show impact analysis. This is the core value proposition of the tool.

## Rendering Pattern

Every state change triggers a full re-render of the relevant view. There is no virtual DOM or incremental update — the entire Gantt SVG or specs table is redrawn on each render call.
