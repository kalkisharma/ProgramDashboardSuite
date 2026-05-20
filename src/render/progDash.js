import { state } from '../state.js';
import { esc, daysBetween, TODAY } from '../utils.js';
import { phaseColor } from '../colors.js';
import { PHASE_NAMES_FALLBACK } from '../constants.js';

export function getPhaseNames() {
  const names = {};
  for (let i = 1; i <= 20; i++) {
    const v = state.ProjectData.info['Phase ' + i + ' Name'];
    if (v) names[i] = String(v);
  }
  return names;
}

function toggleTeamRow(el) {
  const dd    = el.nextElementSibling;
  const arrow = el.querySelector('.team-row-arrow');
  const open  = dd.style.display !== 'none';
  dd.style.display       = open ? 'none' : 'block';
  arrow.style.transform  = open ? ''     : 'rotate(90deg)';
}

export function renderProgDash() {
  const body = document.getElementById('prog-body');
  if (!body) return;

  const totalTasks = state.ProjectData.tasks.length;
  const overallPct = totalTasks
    ? Math.round(state.ProjectData.tasks.reduce((s, t) => s + (t.pct || 0), 0) / totalTasks)
    : 0;
  const doneTasks = state.ProjectData.tasks.filter(t => t.pct >= 100).length;

  const milestones = state.ProjectData.tasks.filter(t => t.milestone);
  const milestoneDone = milestones.filter(t => t.pct >= 100).length;
  const nextMs = milestones
    .filter(t => t.pct < 100)
    .sort((a, b) => (a.start||a.end) - (b.start||b.end))[0];
  const daysToNext = nextMs ? daysBetween(TODAY, nextMs.start) : null;

  const finalMs = milestones.slice().sort((a, b) => (b.end || b.start) - (a.end || a.start))[0];
  const finalMsDate = finalMs ? (finalMs.end || finalMs.start) : null;
  const finalMsDateStr = finalMsDate
    ? finalMsDate.toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' })
    : 'TBD';
  const daysToFinal = finalMsDate ? daysBetween(TODAY, finalMsDate) : null;
  const daysToFinalStr = daysToFinal === null ? '' :
    daysToFinal > 0 ? `${daysToFinal} days remaining` :
    daysToFinal === 0 ? 'Today' : 'Completed';

  const overdueTasks = state.ProjectData.tasks.filter(t => t.end && t.end < TODAY && (t.pct || 0) < 100 && !t.milestone).length;

  const specAchieved = state.ProjectData.specs.filter(s => s.status === 'Achieved').length;
  const specTarget   = state.ProjectData.specs.filter(s => s.status === 'Target').length;
  const specTBD      = state.ProjectData.specs.filter(s => s.status === 'TBD').length;

  const phaseMap = {};
  state.ProjectData.tasks.forEach(t => {
    const ph = parseInt(String(t.wbs).split('.')[0]) || 1;
    if (!phaseMap[ph]) phaseMap[ph] = [];
    phaseMap[ph].push(t);
  });
  const phaseNums = Object.keys(phaseMap).map(Number).sort((a, b) => a - b);

  const teamTaskMap = {};
  state.ProjectData.tasks.forEach(t => {
    const team = t.team || 'Unassigned';
    if (!teamTaskMap[team]) teamTaskMap[team] = [];
    teamTaskMap[team].push(t);
  });
  const maxTeamCount = Math.max(...Object.values(teamTaskMap).map(v => v.length), 1);

  const pctColor = overallPct >= 75 ? '#3fb950' : overallPct >= 40 ? '#58a6ff' : '#d29922';

  let nextMsCard = '';
  if (nextMs) {
    const dLabel = daysToNext > 0 ? daysToNext + ' days away' : daysToNext === 0 ? 'Today' : Math.abs(daysToNext) + ' days ago';
    nextMsCard = `<div class="kpi-card">
      <div class="kpi-label">Next Milestone</div>
      <div class="kpi-value" style="font-size:1rem;font-weight:700;line-height:1.2">${esc(nextMs.name)}</div>
      <div class="kpi-sub">${dLabel}</div>
    </div>`;
  }

  const teamRows = Object.entries(teamTaskMap).sort((a, b) => b[1].length - a[1].length).map(([team, tasks]) => {
    const count = tasks.length;
    const barW  = Math.round(count / maxTeamCount * 100);
    const taskItems = tasks.map(t => {
      const pct = t.pct || 0;
      const [cls, label] = pct >= 100 ? ['tts-done','Done'] : pct > 0 ? ['tts-progress', pct + '%'] : ['tts-pending','Not Started'];
      const msIcon = t.milestone ? ' <span title="Milestone" style="color:#d29922">◆</span>' : '';
      const dateStr = t.end ? t.end.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }) : '';
      return `<div class="team-task-item">
        <span class="tts ${cls}">${label}</span>
        <span style="flex:1">${esc(t.wbs)} &nbsp;${esc(t.name)}${msIcon}</span>
        <span style="color:var(--muted);font-size:0.72rem;flex-shrink:0">${dateStr}</span>
      </div>`;
    }).join('');
    return `
      <div class="team-row">
        <div class="prog-bar-label" title="${esc(team)}">${esc(team)}</div>
        <div class="prog-bar-track"><div class="prog-bar-fill" style="width:${barW}%;background:var(--accent)"></div></div>
        <div class="prog-bar-pct">${count}</div>
        <div class="team-row-arrow">▶</div>
      </div>
      <div class="team-dropdown">${taskItems}</div>`;
  }).join('');

  body.innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-label">Overall Complete</div>
        <div class="kpi-value" style="color:${pctColor}">${overallPct}%</div>
        <div class="kpi-sub">${totalTasks} tasks · ${doneTasks} done</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Milestones</div>
        <div class="kpi-value">${milestoneDone}<span style="font-size:1rem;font-weight:400;color:var(--muted)"> / ${milestones.length}</span></div>
        <div class="kpi-sub">${milestones.length - milestoneDone} remaining</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Overdue</div>
        <div class="kpi-value" style="${overdueTasks > 0 ? 'color:#f85149' : ''}">${overdueTasks}</div>
        <div class="kpi-sub">tasks past due</div>
      </div>
      ${nextMsCard}
      <div class="kpi-card">
        <div class="kpi-label">Final Milestone</div>
        <div class="kpi-value" style="font-size:1rem;font-weight:700;line-height:1.3">${finalMs ? esc(finalMs.name) : 'None'}</div>
        <div class="kpi-sub">${finalMsDateStr}</div>
        <div class="kpi-sub" style="margin-top:2px">${daysToFinalStr}</div>
      </div>
    </div>

    <div class="two-col">
      <div class="dash-section">
        <div class="dash-section-title">Phase Progress</div>
        ${phaseNums.map(ph => {
          const pts  = phaseMap[ph];
          const avg  = Math.round(pts.reduce((s, t) => s + (t.pct || 0), 0) / pts.length);
          const phaseNames = getPhaseNames();
          const name = phaseNames[ph] || PHASE_NAMES_FALLBACK[ph - 1] || ('Phase ' + ph);
          const color = phaseColor(ph + '.0');
          return `<div class="prog-bar-row">
            <div class="prog-bar-label" title="${ph}. ${esc(name)}">${ph}. ${esc(name)}</div>
            <div class="prog-bar-track"><div class="prog-bar-fill" style="width:${avg}%;background:${color}"></div></div>
            <div class="prog-bar-pct">${avg}%</div>
          </div>`;
        }).join('')}
      </div>

      <div class="dash-section">
        <div class="dash-section-title">Specification Status</div>
        <div class="spec-pill-row">
          <div class="spec-pill achieved"><div class="pill-count">${specAchieved}</div>Achieved</div>
          <div class="spec-pill target"><div class="pill-count">${specTarget}</div>Target</div>
          <div class="spec-pill tbd"><div class="pill-count">${specTBD}</div>TBD</div>
        </div>
        <div style="margin-top:14px;font-size:0.8rem;color:var(--muted)">${state.ProjectData.specs.length} specifications total</div>
      </div>
    </div>

    <div class="dash-section">
      <div class="dash-section-title">Team Workload — click a team to see tasks</div>
      ${teamRows}
    </div>
  `;
  body.querySelectorAll('.team-row').forEach(row => {
    row.addEventListener('click', () => toggleTeamRow(row));
  });
}
