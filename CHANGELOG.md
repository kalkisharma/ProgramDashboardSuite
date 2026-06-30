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

For releases prior to v6.0.0, see the [Release History table in CLAUDE.md](CLAUDE.md#release-history).
