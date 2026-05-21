# Code Flow Diagrams

Key data flows through the app. Rendered as Mermaid diagrams (GitHub, VS Code, Obsidian all render these natively).

---

## 1. File load

How an Excel file becomes a rendered dashboard.

```mermaid
flowchart TD
    A([User drops .xlsx file\nor clicks file input]) --> B[FileReader.readAsArrayBuffer]
    B --> C[XLSX.read → workbook object]
    C --> D[parseInfoSheet\nparseScheduleSheet\nparseSpecsSheet\nparseOrgSheet\nparseWeightSheet]
    D --> E[state.ProjectData populated\nstate.originalTasks deep-copied\nstate.ganttWorkDays set]
    E --> F[clearDraft\nresetState partial\nisDirty = false]
    F --> G[renderDashboard]
    G --> H[safeRender × 5]
    H --> I[renderGantt]
    H --> J[renderSpecs]
    H --> K[renderProgDash]
    H --> L[renderWeightBudget]
    H --> M[renderOrgChart]
```

---

## 2. Gantt bar drag

How moving a bar updates the schedule.

```mermaid
sequenceDiagram
    participant User
    participant gantt.js
    participant state
    participant undo.js

    User->>gantt.js: mousedown on bar hit area
    gantt.js->>state: barDragPreSnapshot = fullSnapshot()
    gantt.js->>state: barDrag.active = true, mode, taskId

    loop mousemove
        User->>gantt.js: mousemove
        gantt.js->>gantt.js: compute new dates (snapToWorkDay)
        gantt.js->>state: update barEls SVG elements directly
        gantt.js->>gantt.js: update #gantt-drag-label
    end

    User->>gantt.js: mouseup
    gantt.js->>undo.js: pushUndo('bar move') using pre-snapshot
    gantt.js->>state: task.start / task.end updated
    gantt.js->>gantt.js: renderGantt() — full re-render
```

---

## 3. Side panel open

How clicking a task row opens the task panel without a circular import.

```mermaid
flowchart LR
    A([User clicks\nGantt row]) --> B[gantt.js click handler]
    B --> C{state.handlers\n.openTaskPanel?}
    C -- registered --> D[main.js: openTaskPanel id]
    C -- not yet registered --> E[no-op]
    D --> F[state.spCurrentType = 'task'\nstate.spCurrentId = id]
    F --> G[render task HTML\ninto #sp-body]
    G --> H[showSidePanel]
    H --> I[panel slides in\nfocus trapped inside]

    style E fill:#555,color:#fff
```

**Why `state.handlers`?** `gantt.js` imports from `main.js` would create a circular dependency. Instead, `main.js` writes `state.handlers.openTaskPanel = openTaskPanel` at init time, and `gantt.js` reads it at call time — by then the function is registered.

---

## 4. Inline field edit (spec panel)

The pattern used by all seven `startSpec*Edit` functions.

```mermaid
sequenceDiagram
    participant User
    participant specEdits.js
    participant state
    participant undo.js
    participant specs.js

    User->>specEdits.js: click on spec name cell
    specEdits.js->>specEdits.js: replace <span> with <input>\nfocus + select all
    User->>specEdits.js: types new name, presses Enter
    specEdits.js->>undo.js: pushUndo('spec name change')
    specEdits.js->>state: spec.name = newValue
    specEdits.js->>specs.js: renderSpecTable()
    specEdits.js->>state: spCurrentType = null
    specEdits.js->>state.handlers: openSpecPanel(spec.id)
    Note over specEdits.js: Panel re-renders with updated value.\nspCurrentType nulled so it's a fresh\nopen, not a toggle-close.
```

---

## 5. Undo / redo

```mermaid
flowchart TD
    subgraph Every edit
        A[pushUndo label] --> B[fullSnapshot → deep copy of\ntasks, specs, org, weights, info]
        B --> C[undoStack.push snapshot + label\nredoStack cleared\nisDirty = true\nscheduleDraftSave debounced 3s]
    end

    subgraph Undo
        D([User presses Ctrl+Z]) --> E[currentSnapshot = fullSnapshot]
        E --> F[redoStack.push currentSnapshot]
        F --> G[entry = undoStack.pop]
        G --> H[_restoreSnapshot entry.snapshot]
        H --> I[safeRender all tabs]
    end

    subgraph Redo
        J([User presses Ctrl+Y]) --> K[currentSnapshot = fullSnapshot]
        K --> L[undoStack.push currentSnapshot]
        L --> M[entry = redoStack.pop]
        M --> N[_restoreSnapshot entry.snapshot]
        N --> O[safeRender all tabs]
    end
```

---

## 6. Module dependency graph

Who imports from whom. Arrows point from importer → imported.

```mermaid
flowchart TD
    main["main.js\n(init + side panels)"]

    subgraph render
        gantt["render/gantt.js"]
        specs["render/specs.js"]
        prog["render/progDash.js"]
        wt["render/weightBudget.js"]
        org["render/orgChart.js"]
    end

    subgraph ui
        panelBase["ui/panelBase.js"]
        tooltip["ui/tooltip.js"]
        toast["ui/toast.js"]
        rowReorder["ui/rowReorder.js"]
        specEdits["ui/specEdits.js"]
        taskOps["ui/taskOps.js"]
    end

    subgraph core
        undo["core/undo.js"]
    end

    subgraph compute
        cp["compute/criticalPath.js"]
        cf["compute/conflicts.js"]
        wbs["compute/wbs.js"]
    end

    state["state.js"]
    utils["utils.js"]
    colors["colors.js"]
    constants["constants.js"]
    parseJs["parse.js"]
    excelJs["excel.js"]

    main --> gantt & specs & prog & wt & org
    main --> panelBase & tooltip & toast & specEdits & taskOps
    main --> undo & state & utils & colors & constants & parseJs & excelJs

    gantt --> state & utils & colors & constants & cp & cf & wbs & prog & tooltip & toast & undo & rowReorder
    specs --> state & utils & colors & toast
    prog --> state & utils & colors & constants
    wt --> state & colors & toast
    org --> state & colors

    rowReorder --> state & constants & gantt & undo & wbs & toast
    specEdits --> state & colors & specs & undo & toast
    taskOps --> state & colors & utils & gantt & specs & prog & undo & toast & panelBase & wbs & specEdits

    undo --> state
    panelBase --> state
    tooltip --> state & utils & colors
    toast --> state
```

> **Note on rowReorder ↔ gantt circular edge:** `rowReorder.js` imports `renderGantt` from `gantt.js`, and `gantt.js` imports `startRowDrag/doRowDragMove/endRowDrag` from `rowReorder.js`. Vite/Rollup resolves this safely because neither module reads the other's exports at module-init time — they only call them inside event handlers (runtime, not import time).

---

## 7. Draft auto-save and restore

```mermaid
flowchart TD
    A[pushUndo called] --> B[scheduleDraftSave\ndebounce 3 000 ms]
    B --> C{3s elapsed\nwithout another edit?}
    C -- yes --> D[fullSnapshot serialised\nto localStorage 'vh-draft']
    C -- no --> B

    E([Page load]) --> F{vh-draft exists\nin localStorage?}
    F -- yes --> G[show #draft-banner\nproject title + save time]
    F -- no --> H[normal empty state]

    G --> I{User clicks Restore}
    G --> J{User clicks Dismiss}
    I --> K[parse snapshot\nreconstruct Date objects\nrenderDashboard]
    J --> L[clearDraft\nremove vh-draft]
```
