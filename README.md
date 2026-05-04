# Program Dashboard Suite

A client-side program dashboard for aerospace and vehicle development programs. Drop an Excel file into a browser and get an interactive Gantt chart, specifications tracker, program dashboard, weight budget, and org chart — no server, no install, no login.

**Intended audiences:** Program managers, engineers, and leadership stakeholders.

<!-- Add a screenshot here once available: ![Dashboard screenshot](docs/screenshot.png) -->

---

## Getting Started

**Both files must stay in the same folder:**

```
dashboard.html
xlsx.full.min.js
```

### Option A — Open directly (recommended)

Double-click `dashboard.html` or drag it into any modern browser. No web server needed.

### Option B — Local server

```bash
python -m http.server
# then open http://localhost:8000/dashboard.html
```

### Load your data

Drag your `.xlsx` file anywhere onto the page, or click **Browse for File**. The dashboard auto-populates immediately.

To try the tool before building your own Excel file, click **Generate Sample Excel** on the landing page. This downloads a complete sample program (TW-2 Hybrid-Electric Tilt-Wing UAM) that exercises all five tabs.

---

## Excel File Format

Sheet names are **case-sensitive**. The tool silently skips unrecognized sheets — if a tab is missing, check the sheet name matches exactly.

| Sheet | Required | Key columns |
|---|---|---|
| `Project Info` | Yes | Field, Value |
| `Schedule` | Yes | Task ID, WBS, Task Name, Category, Start Date, End Date, % Complete, Dependencies, Responsible Team, Milestone (Y/N), Notes |
| `Specifications` | Yes | Spec ID, Category, Specification Name, Value, Units, Status, Responsible Group, Notes, Dependent Task IDs |
| `Org Chart` | Optional | Name, Title, Team, Reports To, Email |
| `Weight Budget` | Optional | Subsystem, Group, Target Weight (lb), Estimated Weight (lb), Status, Notes |

### Project Info recognized fields

| Field | Description |
|---|---|
| `Project Title` | Displayed in the top-left header |
| `Project Subtitle` | Short program identifier (e.g. `TW-2`) |
| `File Administrator` | Shown next to the subtitle |
| `Program Start` | Informational |
| `Program End` | Informational |
| `Work Days` | Comma-separated work days (e.g. `Mon,Tue,Wed,Thu`). Default: Mon–Thu |
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

Click the `?` button in the top-right for a built-in guide covering each tab, the full Excel schema, and troubleshooting steps.

---

## Gantt Editing

Changes are made directly in the browser and saved back to Excel with **💾 Save to Excel**.

| Action | How |
|---|---|
| Move a task bar | Drag the center of the bar |
| Resize a task | Drag the left or right edge of the bar |
| Reorder tasks | Hover the WBS column to reveal the drag handle; drag to new position |
| Edit task name | Click the name cell |
| Change team | Click the team cell |
| Edit % complete | Click the % cell |
| Add a task | Click **+ Add Task** in the toolbar |
| Reset all edits | Click **↺ Reset** — reverts to the last imported state |
| Save to Excel | Click **💾 Save to Excel** — exports a dated `.xlsx` re-importable into this tool |

Bar drags snap to configured work days. Dependency arrows redraw automatically on drop.

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

The tool runs entirely offline. `xlsx.full.min.js` is vendored locally — no internet connection is required or used after the files are on disk.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
