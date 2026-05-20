import { state } from '../state.js';
import { teamColor } from '../colors.js';

// Card dimensions and spacing constants (px).
const NW = 180, NH = 72, HG = 28, VG = 80;

// Pan state is module-level because the listeners are attached once and must
// survive re-renders (the SVG is replaced but the container scroll listeners are not).
let orgPanListenersAttached = false;
let oDragging = false, oDragX = 0, oDragY = 0, oDragSL = 0, oDragST = 0;

// Returns the total pixel width needed to lay out this node and all its descendants.
// A leaf needs exactly NW; a parent needs its children's widths plus gaps between them,
// but never less than NW (a node can't be narrower than one card).
function calcSubW(node) {
  if (!node.children.length) return NW;
  const total = node.children.reduce((s, c) => s + calcSubW(c), 0);
  return Math.max(NW, total + HG * (node.children.length - 1));
}

// Assigns x/y pixel coordinates to every node in the subtree rooted at `node`.
// `left` is the left edge of the horizontal slot allocated to this subtree.
// The node card is centered within its slot: x = left + (slotWidth - cardWidth) / 2.
// Children are placed left-to-right, each within their own sub-slot.
function assignPos(node, left, depth) {
  node.y = depth * (NH + VG);
  const sw = calcSubW(node);
  node.x = left + (sw - NW) / 2;
  if (node.children.length) {
    let childLeft = left;
    node.children.forEach(c => {
      const csw = calcSubW(c);
      assignPos(c, childLeft, depth + 1);
      childLeft += csw + HG;
    });
  }
}

export function renderOrgChart() {
  const empty = document.getElementById('org-empty');
  const container = document.getElementById('org-container');

  if (!state.ProjectData.org.length) {
    empty.style.display = 'flex';
    container.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  container.style.display = 'block';

  const q = state.orgSearchQuery.toLowerCase();
  let orgData = state.ProjectData.org;
  const matchedNames = new Set();
  if (q) {
    const matched = state.ProjectData.org.filter(p =>
      [p.name, p.title, p.team, p.email].some(v => v && v.toLowerCase().includes(q)));
    const ancestorSet = new Set();
    matched.forEach(p => {
      matchedNames.add(p.name);
      ancestorSet.add(p.name);
      // Walk up the primary reporting chain so matched nodes are shown in context —
      // a result card with no parent visible would appear as a disconnected root.
      let cur = p;
      while (cur.reportsTo && cur.reportsTo[0]) {
        const parent = state.ProjectData.org.find(x => x.name === cur.reportsTo[0]);
        if (!parent || ancestorSet.has(parent.name)) break;
        ancestorSet.add(parent.name);
        cur = parent;
      }
    });
    orgData = state.ProjectData.org.filter(p => ancestorSet.has(p.name));
  }
  const nodeMap = {};
  orgData.forEach(p => { nodeMap[p.name] = { ...p, children: [] }; });
  const roots = [];
  orgData.forEach(p => {
    // reportsTo[0] is the primary manager and determines tree position.
    // reportsTo[1..] are secondary managers rendered as dashed lines (matrix reporting).
    const primary = p.reportsTo[0];
    if (primary && nodeMap[primary]) nodeMap[primary].children.push(nodeMap[p.name]);
    else roots.push(nodeMap[p.name]);
  });

  let offsetX = 20;
  roots.forEach(r => {
    const sw = calcSubW(r);
    assignPos(r, offsetX, 0);
    offsetX += sw + HG * 2;
  });

  const allNodes = Object.values(nodeMap);
  const svgW = Math.max(...allNodes.map(n => n.x + NW)) + 40;
  const svgH = Math.max(...allNodes.map(n => n.y + NH)) + 40;

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', svgW);
  svg.setAttribute('height', svgH);
  svg.style.display = 'block';

  const isLightOrg = document.body.classList.contains('light-mode');
  const cardBg      = isLightOrg ? '#f4f2ef'           : '#161b22';
  const cardBorder  = isLightOrg ? 'rgba(0,0,0,0.08)'  : 'rgba(88,166,255,0.25)';
  const nameFill    = isLightOrg ? '#1f2328'            : '#e6edf3';
  const titleFill   = isLightOrg ? '#636c76'            : '#8b949e';

  const defs = document.createElementNS(NS, 'defs');
  if (isLightOrg) {
    const filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', 'card-shadow');
    filter.setAttribute('x', '-10%'); filter.setAttribute('y', '-10%');
    filter.setAttribute('width', '120%'); filter.setAttribute('height', '130%');
    const shadow = document.createElementNS(NS, 'feDropShadow');
    shadow.setAttribute('dx', '0'); shadow.setAttribute('dy', '1');
    shadow.setAttribute('stdDeviation', '2.5');
    shadow.setAttribute('flood-color', 'rgba(0,0,0,0.10)');
    filter.appendChild(shadow);
    defs.appendChild(filter);
  }
  svg.appendChild(defs);

  allNodes.forEach(node => {
    node.children.forEach(child => {
      const x1 = node.x + NW/2, y1 = node.y + NH;
      const x2 = child.x + NW/2, y2 = child.y;
      const midY = (y1 + y2) / 2;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', cardBorder);
      path.setAttribute('stroke-width', '1.5');
      svg.appendChild(path);
    });
  });

  allNodes.forEach(node => {
    node.reportsTo.slice(1).forEach(secName => {
      const parent = nodeMap[secName];
      if (!parent) return;
      const x1 = parent.x + NW/2, y1 = parent.y + NH;
      const x2 = node.x + NW/2,   y2 = node.y;
      const midY = (y1 + y2) / 2;
      const sec = document.createElementNS(NS, 'path');
      sec.setAttribute('d', `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
      sec.setAttribute('fill', 'none');
      sec.setAttribute('stroke', isLightOrg ? 'rgba(0,0,0,0.22)' : 'rgba(139,148,158,0.45)');
      sec.setAttribute('stroke-width', '1.5');
      sec.setAttribute('stroke-dasharray', '5,3');
      svg.appendChild(sec);
    });
  });

  allNodes.forEach(node => {
    const nx = node.x, ny = node.y;
    const col = teamColor(node.team);

    const card = document.createElementNS(NS, 'g');
    card.style.cursor = 'pointer';
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${node.name}${node.title ? ', ' + node.title : ''}${node.team ? ', ' + node.team + ' team' : ''}`);
    card.addEventListener('click', () => { if (state.handlers.openOrgPanel) state.handlers.openOrgPanel(node.name); });
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (state.handlers.openOrgPanel) state.handlers.openOrgPanel(node.name); } });

    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', nx); rect.setAttribute('y', ny);
    rect.setAttribute('width', NW); rect.setAttribute('height', NH);
    rect.setAttribute('rx', 8); rect.setAttribute('fill', cardBg);
    rect.setAttribute('stroke', col); rect.setAttribute('stroke-width', '1.5');
    if (isLightOrg) rect.setAttribute('filter', 'url(#card-shadow)');
    card.appendChild(rect);

    const cardBgHover = isLightOrg ? col + '14' : '#1c2128';
    card.addEventListener('mouseenter', () => rect.setAttribute('fill', cardBgHover));
    card.addEventListener('mouseleave', () => rect.setAttribute('fill', cardBg));

    const isMatch = matchedNames.has(node.name);
    const nameEl = document.createElementNS(NS, 'text');
    nameEl.setAttribute('x', nx + NW/2); nameEl.setAttribute('y', ny + 24);
    nameEl.setAttribute('text-anchor', 'middle');
    nameEl.setAttribute('fill', isMatch ? 'var(--accent)' : nameFill);
    nameEl.setAttribute('font-size', '12');
    nameEl.setAttribute('font-weight', '700');
    nameEl.setAttribute('font-family', 'Segoe UI, system-ui, sans-serif');
    nameEl.textContent = node.name.length > 22 ? node.name.slice(0,21)+'…' : node.name;
    card.appendChild(nameEl);

    const titleEl = document.createElementNS(NS, 'text');
    titleEl.setAttribute('x', nx + NW/2); titleEl.setAttribute('y', ny + 40);
    titleEl.setAttribute('text-anchor', 'middle');
    titleEl.setAttribute('fill', titleFill); titleEl.setAttribute('font-size', '10');
    titleEl.setAttribute('font-family', 'Segoe UI, system-ui, sans-serif');
    titleEl.textContent = node.title.length > 26 ? node.title.slice(0,25)+'…' : node.title;
    card.appendChild(titleEl);

    if (node.team) {
      const label = node.team.length > 14 ? node.team.slice(0,13)+'…' : node.team;
      const badgeW = label.length * 6.5 + 14;
      const bx = nx + NW/2 - badgeW/2, by2 = ny + NH - 20;
      const badgeBg = document.createElementNS(NS, 'rect');
      badgeBg.setAttribute('x', bx); badgeBg.setAttribute('y', by2);
      badgeBg.setAttribute('width', badgeW); badgeBg.setAttribute('height', 14);
      badgeBg.setAttribute('rx', 3);
      badgeBg.setAttribute('fill', col + '28');
      card.appendChild(badgeBg);
      const badgeT = document.createElementNS(NS, 'text');
      badgeT.setAttribute('x', nx + NW/2); badgeT.setAttribute('y', by2 + 10);
      badgeT.setAttribute('text-anchor', 'middle');
      badgeT.setAttribute('fill', col); badgeT.setAttribute('font-size', '8.5');
      badgeT.setAttribute('font-weight', '700');
      badgeT.setAttribute('font-family', 'Segoe UI, system-ui, sans-serif');
      badgeT.setAttribute('letter-spacing', '0.05em');
      badgeT.textContent = label.toUpperCase();
      card.appendChild(badgeT);
    }

    svg.appendChild(card);
  });

  document.getElementById('org-svg-wrap').innerHTML = '';
  document.getElementById('org-svg-wrap').appendChild(svg);

  if (!orgPanListenersAttached) {
    orgPanListenersAttached = true;
    container.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      oDragging = true;
      oDragX = e.pageX; oDragY = e.pageY;
      oDragSL = container.scrollLeft; oDragST = container.scrollTop;
      container.classList.add('dragging');
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!oDragging) return;
      container.scrollLeft = oDragSL - (e.pageX - oDragX);
      container.scrollTop  = oDragST - (e.pageY - oDragY);
    });
    document.addEventListener('mouseup', () => {
      if (!oDragging) return;
      oDragging = false;
      container.classList.remove('dragging');
    });
  }
}
