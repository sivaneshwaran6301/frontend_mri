"""Patch Viewer.jsx: replace ClinicalReportPreview and add ClinicalSummaryPanel."""

NEW_COMPONENTS = r"""function ClinicalReportPreview({ text, emptyPlaceholder }) {
  const MARKERS = [
    '%%RISK_ASSESSMENT%%', '%%TUMOR_GRADE%%', '%%RECOMMENDED_DIAGNOSIS%%',
    '%%TREATMENT_RECOMMENDATIONS%%', '%%CRITICAL_FINDINGS%%',
  ];

  const stripMarkers = (txt) => {
    let firstPos = txt.length;
    for (const m of MARKERS) {
      const pos = txt.indexOf(m);
      if (pos !== -1 && pos < firstPos) firstPos = pos;
    }
    return txt.slice(0, firstPos).replace(/\n[-=*#]{3,}\s*$/m, '').trimEnd();
  };

  const normalized = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const displayText = stripMarkers(normalized);

  const blocks = [];
  let current = [];
  const pushCurrent = () => {
    const trimmed = current.join('\n').trim();
    if (trimmed) blocks.push(trimmed);
    current = [];
  };
  for (const ln of displayText.split('\n')) {
    if (!ln.trim()) { pushCurrent(); continue; }
    current.push(ln);
  }
  pushCurrent();

  if (!blocks.length) {
    return (
      <div className="clinical-report-section">
        <div className="clinical-report-paragraph muted">{emptyPlaceholder}</div>
      </div>
    );
  }

  const isHeadingLine = (s) => {
    const t = s.replace(/[*_`#]+/g, '').trim();
    if (!t || t.length <= 2) return false;
    if (t.endsWith(':') && t.length < 80) return true;
    const upperish = t === t.toUpperCase() && /[A-Z]/.test(t);
    const safe = /^[A-Z0-9][A-Z0-9 /()\-,.]{2,}$/.test(t);
    return upperish && safe;
  };

  const renderBlock = (block, idx) => {
    const blockLines = block.split('\n');
    const first = blockLines[0].replace(/[*_`#]+/g, '').trim();
    const heading = isHeadingLine(first) ? first.replace(/:$/, '') : '';
    const restLines = heading ? blockLines.slice(1) : blockLines;

    const listItems = [];
    const paragraphs = [];
    let para = [];
    const flushPara = () => {
      const p = para.join(' ').trim();
      if (p) paragraphs.push(p);
      para = [];
    };

    for (const raw of restLines) {
      const s = raw.replace(/[*_`]+/g, '').trim();
      if (!s) { flushPara(); continue; }
      const bm = s.match(/^([\-*\u2022]|\d+\.)\s+(.*)/);
      if (bm) { flushPara(); listItems.push(bm[2]); continue; }
      para.push(s);
    }
    flushPara();

    return (
      <div key={idx} className="clinical-report-section">
        {heading ? <div className="clinical-report-section-title">{heading}</div> : null}
        {paragraphs.map((p, i) => <div key={i} className="clinical-report-paragraph">{p}</div>)}
        {listItems.length ? (
          <ul className="clinical-report-list">
            {listItems.map((it, i) => <li key={i}>{it}</li>)}
          </ul>
        ) : null}
      </div>
    );
  };

  return <div className="clinical-report-body">{blocks.map(renderBlock)}</div>;
}

// Clinical Summary Panel
const SUMMARY_MARKERS = [
  '%%RISK_ASSESSMENT%%', '%%TUMOR_GRADE%%', '%%RECOMMENDED_DIAGNOSIS%%',
  '%%TREATMENT_RECOMMENDATIONS%%', '%%CRITICAL_FINDINGS%%',
];

function parseClinicalSummary(aiText) {
  const result = {};
  for (const m of SUMMARY_MARKERS) result[m] = '';
  if (!aiText) return result;
  for (let i = 0; i < SUMMARY_MARKERS.length; i++) {
    const marker = SUMMARY_MARKERS[i];
    const start = aiText.indexOf(marker);
    if (start === -1) continue;
    const contentStart = start + marker.length;
    let nextPos = aiText.length;
    for (const other of SUMMARY_MARKERS.slice(i + 1)) {
      const pos = aiText.indexOf(other, contentStart);
      if (pos !== -1 && pos < nextPos) nextPos = pos;
    }
    result[marker] = aiText.slice(contentStart, nextPos)
      .replace(/^[-=*#]+\s*/gm, '').replace(/\*\*/g, '').trim();
  }
  return result;
}

function riskColor(text) {
  const t = (text || '').toUpperCase();
  if (t.includes('CRITICAL')) return { bg: '#dc2626', light: '#fef2f2', border: '#dc2626' };
  if (t.includes('HIGH'))     return { bg: '#ea580c', light: '#fff7ed', border: '#ea580c' };
  if (t.includes('MODERATE')) return { bg: '#d97706', light: '#fffbeb', border: '#d97706' };
  return                               { bg: '#16a34a', light: '#f0fdf4', border: '#16a34a' };
}

function gradeColor(text) {
  const t = (text || '').toUpperCase();
  if (/ IV/.test(t) || /GRADE\s*4/.test(t)) return { bg: '#dc2626', light: '#fef2f2' };
  if (/III/.test(t)  || /GRADE\s*3/.test(t)) return { bg: '#ea580c', light: '#fff7ed' };
  if (/ II/.test(t)  || /GRADE\s*2/.test(t)) return { bg: '#d97706', light: '#fffbeb' };
  return                                       { bg: '#16a34a', light: '#f0fdf4' };
}

function SummaryRow({ label, content, accentColor }) {
  const lines = (content || '').split('\n').filter(l => l.trim());
  return (
    <div className="clinical-summary-row" style={{ borderLeft: `4px solid ${accentColor}` }}>
      <div className="clinical-summary-label" style={{ color: accentColor }}>{label}</div>
      <div className="clinical-summary-content">
        {lines.map((line, i) => {
          const m = line.match(/^([\-*\u2022]|\d+\.)\s+(.*)/);
          if (m) return <div key={i} className="clinical-summary-bullet">{'\u2022'} {m[2]}</div>;
          return line.trim() ? <div key={i} className="clinical-summary-text">{line}</div> : null;
        })}
      </div>
    </div>
  );
}

function ClinicalSummaryPanel({ aiReport }) {
  const summary = parseClinicalSummary(aiReport || '');
  const hasAny = SUMMARY_MARKERS.some(m => summary[m]?.trim());
  if (!hasAny) return null;

  const risk  = summary['%%RISK_ASSESSMENT%%'];
  const grade = summary['%%TUMOR_GRADE%%'];
  const diag  = summary['%%RECOMMENDED_DIAGNOSIS%%'];
  const treat = summary['%%TREATMENT_RECOMMENDATIONS%%'];
  const crit  = summary['%%CRITICAL_FINDINGS%%'];

  const rc = riskColor(risk);
  const gc = gradeColor(grade);

  return (
    <div className="clinical-summary-panel">
      <div className="clinical-summary-header">
        <span className="clinical-summary-header-icon">{'\ud83c\udfe5'}</span>
        CLINICAL SUMMARY {'\u2014'} FOR IMMEDIATE PHYSICIAN REVIEW
      </div>

      <div className="clinical-summary-badges">
        {risk && (
          <div className="clinical-summary-badge" style={{ background: rc.light, borderColor: rc.border }}>
            <div className="clinical-summary-badge-label">RISK LEVEL</div>
            <div className="clinical-summary-badge-value" style={{ color: rc.bg }}>
              {risk.split('\n')[0].trim()}
            </div>
          </div>
        )}
        {grade && (
          <div className="clinical-summary-badge" style={{ background: gc.light, borderColor: gc.bg }}>
            <div className="clinical-summary-badge-label">TUMOR GRADE</div>
            <div className="clinical-summary-badge-value" style={{ color: gc.bg }}>
              {grade.split('\n')[0].trim()}
            </div>
          </div>
        )}
      </div>

      {diag  && <SummaryRow label={'\ud83d\udd2c RECOMMENDED DIAGNOSIS'}     content={diag}  accentColor="#374151" />}
      {treat && <SummaryRow label={'\ud83d\udc8a TREATMENT RECOMMENDATIONS'} content={treat} accentColor="#1e40af" />}
      {crit  && <SummaryRow label={'\u26a0\ufe0f CRITICAL FINDINGS'}          content={crit}  accentColor="#b91c1c" />}

      <div className="clinical-summary-disclaimer">
        This AI-assisted report must be correlated clinically and interpreted alongside other investigations.
        Histopathological confirmation is required before treatment decisions.
      </div>
    </div>
  );
}
"""

with open('Viewer.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.split('\n')

# Find start of ClinicalReportPreview
start_idx = None
for i, line in enumerate(lines):
    if line == 'function ClinicalReportPreview({ text, emptyPlaceholder }) {':
        start_idx = i
        break

if start_idx is None:
    print("ERROR: Could not find ClinicalReportPreview")
    exit(1)

print(f"Found ClinicalReportPreview at line {start_idx+1}")

# Replace from ClinicalReportPreview to end of file
new_lines = lines[:start_idx] + NEW_COMPONENTS.split('\n')

with open('Viewer.jsx', 'w', encoding='utf-8') as f:
    f.write('\n'.join(new_lines))

print("Successfully patched Viewer.jsx")
