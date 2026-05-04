# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
