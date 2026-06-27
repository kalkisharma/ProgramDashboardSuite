import * as XLSX from 'xlsx';

/** Builds a SheetJS workbook from ProjectData. Pure — no side effects. */
export function buildWorkbook(projectData, weightUnit) {
  const wb = XLSX.utils.book_new();

  // Project Info
  const infoRows = [['Field', 'Value']];
  Object.entries(projectData.info).forEach(([k, v]) => infoRows.push([k, v]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(infoRows), 'Project Info');

  // Schedule
  const schRows = [['Task ID','WBS','Task Name','POC','Customer','Start Date','End Date','% Complete','Dependencies','Milestone','Notes']];
  projectData.tasks.forEach(t => {
    const fmtD = d => d ? d.toISOString().slice(0,10) : '';
    schRows.push([
      t.id, t.wbs, t.name, t.poc || '', t.customer || '',
      fmtD(t.start), fmtD(t.end), t.pct,
      t.deps.filter(id => projectData.tasks.some(x => x.id === id)).join(','),
      t.milestone ? 'Y' : 'N', t.notes,
    ]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(schRows), 'Schedule');

  // Specifications
  const spRows = [['Spec ID','Category','Specification Name','Value','Units','Status','Responsible Group','Notes','Dependent Task IDs']];
  projectData.specs.forEach(s => spRows.push([
    s.id, s.category, s.name, s.value, s.units, s.status, s.group, s.notes,
    s.depIds.filter(id => projectData.tasks.some(x => x.id === id)).join(','),
  ]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(spRows), 'Specifications');

  // Org Chart
  if (projectData.org.length) {
    const ogRows = [['Name','Title','Team','Reports To','Email']];
    projectData.org.forEach(p => ogRows.push([p.name, p.title, p.team, p.reportsTo.join(', '), p.email]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ogRows), 'Org Chart');
  }

  // Weight Budget
  if (projectData.weights.length) {
    const wu = weightUnit || 'lb';
    const wRows = [['Subsystem','Group',`Target Weight (${wu})`,`Estimated Weight (${wu})`,'Status','Notes']];
    projectData.weights.forEach(w => wRows.push([w.subsystem, w.group, w.target, w.estimated, w.status, w.notes]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wRows), 'Weight Budget');
  }

  return wb;
}

export function generateSampleExcel() {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Field','Value'],
    ['Project Title',     'TW-2 Hybrid-Electric Tilt-Wing UAM'],
    ['Project Subtitle',  'TW-2'],
    ['File Administrator','S. Torres'],
    ['Program Start',     '2025-03-03'],
    ['Program End',       '2027-12-19'],
    ['Work Days',         'Mon,Tue,Wed,Thu,Fri'],
    ['Weight Unit',       'lb'],
    ['Phase 1 Name',      'Concept'],
    ['Phase 2 Name',      'Preliminary Design'],
    ['Phase 3 Name',      'Detail Design'],
    ['Phase 4 Name',      'Prototype & Ground Test'],
    ['Phase 5 Name',      'Flight Test'],
    ['Phase 6 Name',      'Certification'],
  ]), 'Project Info');

  const sh = ['Task ID','WBS','Task Name','POC','Customer','Start Date','End Date','% Complete','Dependencies','Milestone','Notes'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([sh,
    // Phase 1: Concept
    [1, '1.0','Program Kickoff',                       'S. Torres',          'R. Nakamura', '2025-03-03','2025-03-07',100,'',          'Y','Program initiation milestone'],
    [2, '1.1','Mission Requirements & Regs Review',    'A. Singh',           'Y. Zhang',    '2025-03-10','2025-04-11',100,'1',         'N','FAA Part 23/27 applicability; AC 21.17-4'],
    [3, '1.2','Tilt-Wing Aero Concept Selection',      'L. Chen',            'R. Nakamura', '2025-03-17','2025-05-09',100,'1',         'N','Down-select rotor count and tilt axis configuration'],
    [4, '1.3','Hybrid Propulsion Architecture Trade',  'T. Walsh',           'R. Nakamura', '2025-03-24','2025-05-16',100,'1',         'N','Series vs parallel hybrid; turbine selection'],
    [5, '1.4','Concept Design Review (CDR-0)',         'S. Torres',          'R. Nakamura', '2025-05-19','2025-05-23',100,'2,3,4',     'Y','Gate review: concept freeze'],
    // Phase 2: Preliminary Design
    [6, '2.0','Rotor & Wing Aerodynamic Analysis',     'L. Chen',            'A. Singh',    '2025-05-26','2025-08-22',100,'5',         'N','CFD and blade element analysis for hover and cruise'],
    [7, '2.1','Hybrid Powertrain Preliminary Design',  'T. Walsh',           'A. Singh',    '2025-05-26','2025-08-01',100,'5',         'N','Turbine-generator sizing; battery pack architecture'],
    [8, '2.2','Airframe Structures Preliminary Design','K. Johansson',       'A. Singh',    '2025-06-02','2025-08-29',100,'5',         'N','Wing box; fuselage frames; primary load cases'],
    [9, '2.3','Tilt Mechanism Detailed Kinematics',    'K. Johansson',       'T. Walsh',    '2025-06-09','2025-09-05',100,'5',         'N','Actuator selection; transition trajectory analysis'],
    [10,'2.4','Flight Control System Architecture',    'H. Okonkwo',         'A. Singh',    '2025-06-02','2025-08-15',100,'5',         'N','Control law framework; actuator redundancy strategy'],
    [11,'2.5','Electrical & HV Bus Architecture',      'A. Singh',           'T. Walsh',    '2025-06-16','2025-08-22',100,'5',         'N','800V HV bus; LV secondary; emergency power routing'],
    [12,'2.6','Preliminary Design Review (PDR)',       'S. Torres',          'R. Nakamura', '2025-09-08','2025-09-12',100,'6,7,8,9,10,11','Y','Gate review: preliminary design freeze'],
    // Phase 3: Detail Design
    [13,'3.0','Rotor Blade Detail Design & Analysis',  'B. Osei',            'L. Chen',     '2025-09-15','2025-12-05',100,'12',        'N','Composite blade layup; aeroelastic analysis'],
    [14,'3.1','Hybrid Engine & Gearbox Integration',   'F. Diaz',            'T. Walsh',    '2025-09-15','2025-12-19',100,'12',        'N','Driveshaft routing; engine mount stress analysis'],
    [15,'3.2','Airframe Detail Design & FEA',          'P. Nguyen',          'K. Johansson','2025-09-22','2026-01-09',100,'12',        'N','Full FEM; fatigue analysis; tilt hinge detail'],
    [16,'3.3','Avionics Hardware & SW Development',    'D. Lee',             'H. Okonkwo',  '2025-10-06','2026-01-30', 95,'12',        'N','FCC hardware; flight software; DO-178C DAL-A'],
    [17,'3.4','Critical Design Review (CDR)',          'S. Torres',          'R. Nakamura', '2026-01-12','2026-01-16',100,'13,14,15,16','Y','Gate review: design freeze before prototype build'],
    // Phase 4: Prototype & Ground Test
    [18,'4.0','Prototype Aircraft Manufacturing',      'O. Brown',           'K. Johansson','2026-01-19','2026-05-29', 55,'17',        'N','Fabricate and assemble 2 prototype airframes'],
    [19,'4.1','Hybrid Powertrain Ground Run Testing',  'F. Diaz',            'T. Walsh',    '2026-04-20','2026-06-26', 15,'17,14',     'N','Engine-generator bench test; power management validation'],
    [20,'4.2','Structural Static & Fatigue Testing',   'P. Nguyen',          'K. Johansson','2026-04-06','2026-06-19', 10,'17,15',     'N','Ultimate load demonstration; tilt hinge fatigue test'],
    [21,'4.3','Tilt Mechanism Endurance Testing',      'K. Johansson',       'O. Brown',    '2026-05-04','2026-07-10',  0,'20',        'N','10,000 tilt cycles at limit loads; actuator endurance'],
    [22,'4.4','Avionics Integration & HIL Testing',    'D. Lee',             'H. Okonkwo',  '2026-05-11','2026-07-17',  0,'16',        'N','Hardware-in-the-loop simulation; fly-by-wire validation'],
    [23,'4.5','Ground Test Complete',                  'C. Martinez',        'S. Torres',   '2026-07-20','2026-07-24',  0,'19,20,21,22','Y','All ground test objectives met; cleared for flight'],
    // Phase 5: Flight Test
    [24,'5.0','First Flight – Hover Mode',             'J. Erikson',         'C. Martinez', '2026-07-27','2026-07-31',  0,'18,23',     'Y','Initial untethered hover; FCL Phase 1 objectives'],
    [25,'5.1','Hover & Low-Speed Envelope Expansion',  'J. Erikson',         'C. Martinez', '2026-08-03','2026-10-02',  0,'24',        'N','Expand to VNE hover; OGE hover; sideward flight'],
    [26,'5.2','Tilt Transition Flight Testing',        'J. Erikson, B. Osei','C. Martinez', '2026-09-28','2026-12-11',  0,'25',        'N','Hover-to-cruise transition; corridor mapping'],
    [27,'5.3','Cruise Performance & Range Testing',    'J. Erikson',         'L. Chen',     '2026-11-30','2027-02-26',  0,'26',        'N','Max range; endurance; climb performance validation'],
    [28,'5.4','Flight Test Program Complete',          'C. Martinez',        'S. Torres',   '2027-02-23','2027-02-27',  0,'25,26,27',  'Y','All FCL objectives closed; data package complete'],
    // Phase 6: Certification
    [29,'6.0','FAA Type Certificate Application',      'Y. Zhang',           'FAA ODA',     '2027-02-16','2027-03-28',  0,'28',        'N','Submit TC application; compliance checklist finalized'],
    [30,'6.1','Compliance Demonstration & Showing',    'Y. Zhang',           'FAA ODA',     '2027-03-03','2027-10-31',  0,'29',        'N','Ground and flight showing per FAA issue papers'],
    [31,'6.2','FAA Type Inspection Authorization',     'Y. Zhang',           'FAA ODA',     '2027-08-04','2027-09-12',  0,'30',        'N','TIA issued; FAA conducts independent flight evaluation'],
    [32,'6.3','Type Certificate Awarded',              'S. Torres',          'FAA ODA',     '2027-12-15','2027-12-19',  0,'30,31',     'Y','FAA Type Certificate for TW-2 – program complete'],
  ]), 'Schedule');

  const sp = ['Spec ID','Category','Specification Name','Value','Units','Status','Responsible Group','Notes','Dependent Task IDs'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([sp,
    ['AD-001','Aerodynamics','Max Cruise Speed',185,'kn','Target','Aerodynamics','At sea level ISA; J=0.8 advance ratio','6,7'],
    ['AD-002','Aerodynamics','Hover Disk Loading',12.5,'lb/ft²','Target','Aerodynamics','Per rotor; governs hover efficiency and downwash','6'],
    ['AD-003','Aerodynamics','Hover Figure of Merit',0.72,'—','Target','Aerodynamics','Rotor efficiency target; validated in whirl tower','6,13'],
    ['AD-004','Aerodynamics','Cruise Lift-to-Drag Ratio',9.5,'—','Target','Aerodynamics','Wing+fuselage at 150 kn cruise altitude','13'],
    ['AD-005','Aerodynamics','Stall Speed (wing-borne mode)',68,'kn','TBD','Aerodynamics','Clean config; critical for fixed-wing approach','13,15'],
    ['AD-006','Aerodynamics','Tilt Transition Corridor',55,'–90 kn','Target','Aerodynamics','Safe tilt transition envelope; upper/lower IAS bounds','9,13'],
    ['PR-001','Propulsion','Turbine Generator Continuous Power',450,'kW','Achieved','Propulsion','Honeywell HGT1700-derived; derated for reliability','7,14'],
    ['PR-002','Propulsion','Battery Pack Energy (Gross)',85,'kWh','Target','Propulsion','NMC pouch cells; 800V nominal bus','7,11'],
    ['PR-003','Propulsion','Rotor Tip Speed – Hover',620,'ft/s','Target','Propulsion','Acoustic noise constraint; community noise < 62 dBA','6,13'],
    ['PR-004','Propulsion','Rotor Tip Speed – Cruise',480,'ft/s','Target','Propulsion','Compressibility limit; Mtip < 0.65','13'],
    ['PR-005','Propulsion','Electric-Only Range (Turbine-Out)',45,'nm','Target','Propulsion','Emergency contingency at best-range speed','7,11'],
    ['PR-006','Propulsion','Full-Hybrid Mission Range',320,'nm','Target','Propulsion','At 150 kn; 45-min IFR fuel reserve included','13,19,27'],
    ['ST-001','Structures','Max Takeoff Weight (MTOW)',3850,'lb','TBD','Structures','2 crew + 400 lb payload; pending weight audit','8,15,18'],
    ['ST-002','Structures','Operating Empty Weight',2280,'lb','TBD','Structures','Structural + propulsion + avionics; mass budget open','15,18'],
    ['ST-003','Structures','Limit Load Factor','+3.8 / −1.5','g','Target','Structures','FAR Part 23 Normal Category; flight + gust cases','15'],
    ['ST-004','Structures','Wing Box Primary Material','CFRP','—','Achieved','Structures','T800 woven prepreg; autoclave cure at 180°C','15'],
    ['ST-005','Structures','Tilt Hinge Fatigue Life',30000,'cycles','Target','Structures','10× design life at limit loads; no crack initiation','20,21'],
    ['AV-001','Avionics','Flight Control Computer Redundancy','Triplex','—','Achieved','Avionics','3× FCC with dissimilar SW; single failure survivable','10,16'],
    ['AV-002','Avionics','GPS/INS Position Accuracy',1.5,'m RMS','Target','Avionics','SBAS-augmented GNSS; degraded mode via INS','10,22'],
    ['AV-003','Avionics','C2 Data Link Range',25,'nm','Target','Avionics','900 MHz FHSS; BLOS uplink via satcom backup','11,22'],
    ['AV-004','Avionics','Autopilot Modes',8,'modes','Target','Avionics','Hover hold, track, cruise, transition, ILS, emergency','10,16,22'],
    ['AV-005','Avionics','Flight-Critical System MTBF',5000,'hr','TBD','Avionics','Per DO-178C DAL-A; pending FMEA closure','16,22'],
    ['SA-001','Certification','Certification Basis','FAR 23 Amd 64 + SC','—','Achieved','Certification','Special Conditions for powered-lift; VTOL SC applied','2,29'],
    ['SA-002','Certification','Catastrophic Failure Probability','<1×10⁻⁹','/FH','Target','Certification','Per FAA AC 23.1309; DAL-A for all FCS functions','16,30'],
    ['SA-003','Certification','Emergency Ballistic Parachute','BRS whole-airframe','—','Target','Certification','Ballistic Recovery System; 3,500 lb MTOW limit','15,30'],
    ['SY-001','Systems','HV Bus Voltage',800,'V DC','Achieved','Systems','Consistent with PR-002 cell architecture; 800V nominal','11'],
    ['SY-002','Systems','Tilt Actuator Hydraulic Pressure',3000,'psi','Target','Systems','Redundant hydraulic circuit; dual actuators per wing','9,11'],
    ['SY-003','Systems','Usable Fuel Capacity',95,'US gal','Target','Systems','JP-8 compatible tankage; 35-min IFR reserve at cruise','14,19'],
  ]), 'Specifications');

  const og = ['Name','Title','Team','Reports To','Email'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([og,
    ['S. Torres',    'Program Director',             'All Teams',    '',                   'storres@tw2.aero'],
    ['R. Nakamura',  'Chief Engineer',               'All Teams',    'S. Torres',          'rnakamura@tw2.aero'],
    ['A. Singh',     'Lead Systems Engineer',        'Systems',      'R. Nakamura',        'asingh@tw2.aero'],
    ['L. Chen',      'Aerodynamics Lead',            'Aerodynamics', 'R. Nakamura',        'lchen@tw2.aero'],
    ['M. Park',      'CFD Engineer',                 'Aerodynamics', 'L. Chen',            'mpark@tw2.aero'],
    ['B. Osei',      'Rotor Aerodynamicist',         'Aerodynamics', 'L. Chen',            'bosei@tw2.aero'],
    ['T. Walsh',     'Propulsion Lead',              'Propulsion',   'R. Nakamura',        'twalsh@tw2.aero'],
    ['F. Diaz',      'Turbine Systems Engineer',     'Propulsion',   'T. Walsh',           'fdiaz@tw2.aero'],
    ['N. Patel',     'Battery Systems Engineer',     'Propulsion',   'T. Walsh, A. Singh', 'npatel@tw2.aero'],
    ['K. Johansson', 'Structures Lead',              'Structures',   'R. Nakamura',        'kjohansson@tw2.aero'],
    ['P. Nguyen',    'Composite Structures Engineer','Structures',   'K. Johansson',       'pnguyen@tw2.aero'],
    ['H. Okonkwo',   'Avionics Lead',                'Avionics',     'R. Nakamura',        'hokonkwo@tw2.aero'],
    ['D. Lee',       'Flight Control Engineer',      'Avionics',     'H. Okonkwo',         'dlee@tw2.aero'],
    ['C. Martinez',  'Flight Test Director',         'Flight Test',  'S. Torres',          'cmartinez@tw2.aero'],
    ['J. Erikson',   'Chief Test Pilot',             'Flight Test',  'C. Martinez',        'jerikson@tw2.aero'],
    ['Y. Zhang',     'Certification Manager',        'Certification','S. Torres',          'yzhang@tw2.aero'],
    ['O. Brown',     'Manufacturing Lead',           'Manufacturing','S. Torres',          'obrown@tw2.aero'],
  ]), 'Org Chart');

  const wb_cols = ['Subsystem','Group','Target Weight (lb)','Estimated Weight (lb)','Status','Notes'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([wb_cols,
    ['Wing Assembly',            'Structures', 420, 408, 'Estimated',   'T800 CFRP wing box and skins'],
    ['Fuselage',                 'Structures', 380, 392, 'Over Budget', 'Heavier than target; titanium frames under review'],
    ['Tilt Mechanism',           'Structures',  95,  88, 'Estimated',   'Actuators, hinges, fairings'],
    ['Landing Gear',             'Structures', 120, 115, 'Estimated',   'Retractable tricycle gear'],
    ['Turbine + Gearbox',        'Propulsion', 310, 318, 'Over Budget', 'Engine heavier than catalog weight due to accessories'],
    ['Battery Pack',             'Propulsion', 275, 261, 'Estimated',   '85 kWh NMC; cell + module + BMS'],
    ['Rotor + Hub (×2)',         'Propulsion', 180, 176, 'Estimated',   'Composite blades; titanium hub'],
    ['Flight Control Computers', 'Avionics',    45,  42, 'Estimated',   'Triplex FCCs; per DO-178C DAL-A'],
    ['Sensors & Navigation',     'Avionics',    55,  58, 'Over Budget', 'GNSS + INS + pitot-static; integration heavier than estimate'],
    ['HV Wiring & Bus',          'Systems',     90,  87, 'Estimated',   '800V main bus; shielded cable runs'],
    ['Hydraulics',               'Systems',     65,  63, 'Estimated',   'Redundant tilt actuator circuit'],
    ['Fuel System',              'Systems',     55,  52, 'Estimated',   'JP-8 bladder tanks; vent and boost pump'],
    ['Furnishings & Misc',       'Other',      110, 118, 'Over Budget', 'Crew seats, harness, interior; scope growth'],
  ]), 'Weight Budget');

  XLSX.writeFile(wb, 'vehicle_project.xlsx');
}
