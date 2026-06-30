# Changelog

User-facing version history for **Program Dashboard Suite**. Newest first. Each release ships
a single-file `dist/ProgramDashboardSuite.html` attached to its
[GitHub release](https://github.com/kalkisharma/ProgramDashboardSuite/releases).

The full, granular per-release record (including pre-6.0 versions) lives in the
[Release History table in CLAUDE.md](CLAUDE.md#release-history). Versioning is semantic
(`MAJOR.MINOR.PATCH`).

---

## v6.8.0 — Uniform inline editing
- **Single-click opens the row's panel everywhere; double-click (or Enter) edits a cell in place.** Editable cells show a ✎ on hover; every edit is undoable.
- Inline editing on the **Gantt** (task name / %), **Vehicle Specs** (Name / Value / Units / Notes), and **Weight Budget** (Estimated / Target).
- **Status Report** and **Org Chart** stay panel-only by design; derived/rolled-up values are never inline-editable.
- Rejected Ctrl+Click (it's the macOS context-menu gesture and has no accessibility path) after a team review.

## v6.7.2 — Tab-switch fix
- Switching tabs with an edit panel open now only prompts when you've **actually changed** something; a panel you only opened switches freely and just closes.
- Importing no longer creates a stray `Field` entry from the Project Info header row.

## v6.7.1 — Docs & help refresh
- In-app Help and README updated to cover everything in the 6.1–6.7 series (variance, RAG thresholds, baseline, weight contingency, the new optional Excel sheets/columns).

## v6.7.0 — Editable at-risk thresholds
- Tune the RAG **At-Risk** rules directly in the **Project Info** panel (at-risk window, completion %, slip tolerance); values store in the project and round-trip in Excel.

## v6.6.1 — Status Report edit refresh
- Editing a task's dates/notes from a Status Report row now updates the table immediately (previously only the Gantt re-rendered).

## v6.6.0 — Performance + Weight Budget redesign
- Conflict and critical-path calculations are cached and only recomputed when the schedule changes (zoom/theme/pan/filter no longer re-run them).
- Weight Budget: a fixed target-reference line with bars showing over/under per row (green under, red over), unified over-budget color, and a **Contingency (%) / mass-growth-allowance** model (predicted = estimate + contingency).

## v6.5.0 — Critical-path rewrite
- Critical path now uses **work-day durations**, **anchors to actual scheduled dates**, resolves dependencies that point at a phase/summary task, evaluates each independent chain against its own end, and **excludes completed tasks** (a remaining-path view).

## v6.4.0 — Schedule baseline & variance
- **⚑ Set Baseline** freezes the current schedule. The Status Report then shows a **Variance** column (work-days vs baseline) and the Gantt draws a baseline overlay. Round-trips via an optional **Baseline** Excel sheet; survives undo and draft restore.

## v6.3.0 — Credible RAG status
- "At Risk" is now **progress-aware** (catches tasks behind where they should be for the time elapsed), **configurable**, and the PowerPoint Top Concerns list ranks **critical-path tasks first**.

## v6.2.0 — Onboarding
- **Load Sample Project** loads the demo instantly in-memory (no download/re-import). Subtask-discoverability hint on load; refreshed landing/help copy.

## v6.1.1 — Team-review quick-wins
- Bar-drag edits are now captured by autosave / the unsaved-changes warning; the Program Dashboard counts reconcile with the Status Report; date-picker off-by-one fixed.
- Accessibility: dim-mode contrast, larger minimum font sizes, keyboard-operable Status Report rows, depth filter works after sorting, visible focus rings.

## v6.1.0 — PowerPoint style & content overhaul
- Redesigned status deck: executive summary, KPI cards, a **Top Concerns** slide, a phase totals row, an indented WBS task table with a RAG legend, and WCAG contrast fixes.

## v6.0.3 — PowerPoint export fixes
- Long task/phase tables now **paginate** instead of running off the slide; KPI/phase metrics count leaf tasks only; correct local-date filename.

## v6.0.2 — Team color dedupe
- Fixed a duplicate team color and added 7 named teams; all team colors are now distinct.

## v6.0.1 — Resizable WBS column
- The Gantt WBS column is wider and draggable so nested (L3+) WBS codes aren't clipped.

## v6.0.0 — N-level WBS hierarchy (subtasks)
- Tasks nest to any depth (dotted WBS). Per-task collapse, a Depth ceiling, indented tree, and group drag on the Gantt; an indented tree (with flatten-on-sort) on the Status Report.
- Blank POC/Customer is inherited from the parent; parent dates and % roll up from children. Add subtask / Promote / Demote / Delete-parent operations. Critical path & conflict detection run at the leaf level. Fixed a timezone date off-by-one.

---

Older releases (condensed; newest first within each series).

## v5.x
- **v5.0.1** — Org Chart: every team gets its own distinct color.
- **v5.0.0** — **POC/Customer model.** The Schedule sheet now takes **POC** and **Customer** names (teams derived from the Org Chart) instead of a Category / Responsible Team. Major Status Report expansion (POC/Customer columns + teams, org validation, three task filters, Phase / POC-Team / Customer-Team multi-selects, toggleable columns). New **Reference Files** tab/sheet; Program Dashboard becomes the default tab. *(Changes the Excel input format.)*

## v4.x
- **v4.7.1** — Status Report / Requirements polish: help entry, sortable-header `aria-sort`, larger status badges, a listener-leak fix.
- **v4.7.0** — **Status Report tab** — open task table with Red/Amber/Green status, sort, and a concerns filter, plus a one-click 3-slide **PowerPoint** export.
- **v4.6.1** — Distinct phase-header rows; Requirements CSV remembered across reloads.
- **v4.6.0** — Full team UI review: scroll preservation, click/double-click disambiguation, an edit guard before switching tabs, filter-aware add-task, and more polish.
- **v4.5.4** — "Save Changes" flashes a green ✓ before returning to the detail view.
- **v4.5.3** — Fixes: help modal restored, side panel no longer opens after a bar drag, tooltip timing, reset-button label; user-guide pass.
- **v4.5.2** — Fixed the filter input losing focus after each keystroke.
- **v4.5.1** — Requirements tab fixes: accessible table semantics, a filter popover, ARIA labels, "Clear filters" also resets columns.
- **v4.5.0** — **Requirements tab** — load any CSV for search, sort, per-column filters, and column visibility (independent of your Excel file).
- **v4.4.0** — Duration-weighted progress %, overdue-milestone highlighting, Phase 1–20 naming in the info panel, plus motion + accessibility polish.
- **v4.3.2** — Renamed the build to `ProgramDashboardSuite.html`; compact dependency tooltip.
- **v4.3.1** — Dependency arrows, critical-path ring, and overdue ring update live while dragging a bar.
- **v4.3.0** — Header redesign: two-band topbar + tab navigation, underline tabs, version in the help footer.
- **v4.2.0** — Unified explicit "Edit Task / Edit Spec / Edit Person" forms in the side panel.
- **v4.1.0** — Org profiles editable directly in the panel (no separate "Edit Person" step).
- **v4.0.0** — Full module split, a 170-test suite, and Gantt screen-reader announcements *(internal; same app)*.

## v3.x
- **v3.2.1** — `resetState()` + fixed stale state when reloading a file.
- **v3.2.0** — Centralized app state into one injectable object *(internal refactor)*.
- **v3.1.0** — Extracted the Excel logic into its own module *(internal)*.
- **v3.0.0** — Rebuilt as a **Vite** project with ES modules and a **Vitest** unit-test suite *(internal; same app)*.

## v2.x
- **v2.7.0** — Resizable Gantt name column + an export-reminder toast.
- **v2.6.0** — Removed all inline `onclick` attributes *(internal cleanup)*.
- **v2.5.0** — Inline date picker on double-clicking a Gantt bar or milestone.
- **v2.4.0** — Auto-save draft to the browser + a warning before closing with unsaved edits; storage-quota fix.
- **v2.3.0** — Draggable handle to resize the Gantt's left panel.
- **v2.2.0** — Collapse / expand phases on the Gantt.
- **v2.1.0** — In-app editing for Weight Budget, Org Chart, and Project Info.
- **v2.0.0** — Milestone / quality-gate release.

## v1.x
- **v1.26.0** — Code-quality pass *(internal)*.
- **v1.25.0** — Keyboard accessibility across the app.
- **v1.24.0** — Delete operations (tasks, specs) with confirm + undo.
- **v1.23.0** — Safety & validation improvements.
- **v1.22.0** — Undo/redo completion.

*Versions before v1.22.0 predate the tracked history.*
