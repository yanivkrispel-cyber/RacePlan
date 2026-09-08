// exporting.jsx — share / print / PDF helpers + the printable summary.
//
//   window.RP_EXPORT      — { shareLink, sharePdf, nodeToPdfBlob }
//   window.PrintableSummary — a light-theme, print-friendly plan sheet
//   window.ActionSheet    — a generic bottom-sheet menu (share / "more")
//
// jsPDF + html2canvas are pulled from a CDN only the first time a PDF is
// actually requested (≈500 KB, so never on the critical path). Hebrew / RTL
// render correctly because the PDF is a rasterised snapshot of real DOM.

const { formatPace, formatClock, formatKm } = window;

const RP_EXPORT = (() => {
  const H2C = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  const _pending = {};

  function ensureScript(src, globalKey) {
    if (window[globalKey]) return Promise.resolve(window[globalKey]);
    if (_pending[src]) return _pending[src];
    _pending[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => resolve(window[globalKey]);
      s.onerror = () => { _pending[src] = null; reject(new Error('failed to load ' + src)); };
      document.head.appendChild(s);
    });
    return _pending[src];
  }

  async function nodeToPdfBlob(node, opts) {
    opts = opts || {};
    await ensureScript(H2C, 'html2canvas');
    await ensureScript(JSPDF, 'jspdf');
    const canvas = await window.html2canvas(node, {
      scale: opts.scale || 2, backgroundColor: '#ffffff', useCORS: true, logging: false,
    });
    const jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    const w = canvas.width;
    const h = canvas.height;
    const pdf = new jsPDF({ unit: 'px', format: [w, h], orientation: w > h ? 'l' : 'p' });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, w, h);
    return pdf.output('blob');
  }

  // Build the PDF and hand it to the OS share sheet; fall back to a download.
  async function sharePdf(node, filename, title) {
    const blob = await nodeToPdfBlob(node);
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: title || filename });
        return 'shared';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancelled';
        // fall through to download
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'downloaded';
  }

  async function shareLink(url, title) {
    if (navigator.share) {
      try { await navigator.share({ title, url }); return 'shared'; }
      catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(url); return 'copied'; }
      catch (e) { /* fall through */ }
    }
    try { window.prompt('קישור לשיתוף:', url); } catch (e) {}
    return 'prompt';
  }

  return { ensureScript, nodeToPdfBlob, sharePdf, shareLink };
})();

// ── PrintableSummary ─────────────────────────────────────────────────────
// Rendered off-screen (.rp-print-wrap) as the html2canvas target, and shown
// in place of the app under @media print. Deliberately light-on-white and
// chart/map-free so it rasterises cleanly.
const PrintableSummary = React.forwardRef(function PrintableSummary(
  { raceName, trainer, raceDate, raceTime, plan }, ref,
) {
  const rows = (plan && plan.rows) || [];
  const cell = { padding: '6px 10px', borderBottom: '1px solid #e3e3e8', fontSize: 13 };
  const head = { ...cell, fontWeight: 700, color: '#555', borderBottom: '2px solid #cfcfd6',
    background: '#f5f5f8', whiteSpace: 'nowrap' };
  const when = [raceDate, raceTime].filter(Boolean).join(' · ');

  return (
    <div ref={ref} className="rp-printable" style={{
      width: 720, background: '#fff', color: '#14171f', padding: 32,
      fontFamily: '"Heebo", system-ui, sans-serif', direction: 'rtl', boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        borderBottom: '2px solid #14171f', paddingBottom: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{raceName || 'תוכנית מרוץ'}</div>
          <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
            {trainer}{trainer && when ? ' · ' : ''}{when}
          </div>
        </div>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.12em', color: '#888' }}>RACE PLAN</div>
      </div>

      <div style={{ display: 'flex', gap: 24, marginBottom: 18, fontSize: 13 }}>
        <div><b>זמן כולל:</b> {formatClock(plan ? plan.totalTime : 0)}</div>
        <div><b>מרחק:</b> {formatKm(plan ? plan.totalDist : 0)} ק"מ</div>
        <div><b>קצב ממוצע:</b> {formatPace(plan ? plan.avgPace : 0)} / ק"מ</div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: 'center', width: 44 }}>#</th>
            <th style={{ ...head, textAlign: 'right' }}>מרחק (ק"מ)</th>
            <th style={{ ...head, textAlign: 'right' }}>קצב</th>
            <th style={{ ...head, textAlign: 'right' }}>זמן מקטע</th>
            <th style={{ ...head, textAlign: 'right' }}>זמן מצטבר</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ ...cell, textAlign: 'center', color: '#888' }}>{i + 1}</td>
              <td style={cell}>{formatKm(r.distance)}</td>
              <td style={cell}>{formatPace(r.paceSec)}</td>
              <td style={cell}>{formatClock(r.segTime)}</td>
              <td style={{ ...cell, fontWeight: 600 }}>{formatClock(r.cumTime)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 18, fontSize: 11, color: '#999' }}>נוצר ב־RACE PLAN By Krispel</div>
    </div>
  );
});

// ── ActionSheet ──────────────────────────────────────────────────────────
// Bottom sheet on phones, centred card on wider screens. items:
//   [{ label, hint?, icon?, danger?, disabled?, onClick }]
function ActionSheet({ title, items, onClose }) {
  return ReactDOM.createPortal((
    <div
      className="rp-sheet-wrap rp-cq-scope"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(9,11,22,.72)',
        backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: 20, direction: 'rtl',
        fontFamily: 'var(--rp-font-ui)', color: 'var(--rp-text)',
      }}
    >
      <style>{`
        @media (max-width: 640px){
          .rp-sheet-wrap{ align-items: flex-end !important; padding: 0 !important; }
          .as-sheet{ width: 100% !important; max-width: none !important;
            border-radius: 18px 18px 0 0 !important; }
          .as-sheet button{ font-size: 15px !important; min-height: 50px; }
        }
      `}</style>
      <div className="as-sheet" style={{
        background: 'var(--rp-surface)', border: '1px solid var(--rp-line)',
        borderRadius: 'var(--rp-r-14)', width: '100%', maxWidth: 380,
        boxShadow: 'var(--rp-shadow-modal)', overflow: 'hidden',
      }}>
        {title && (
          <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--rp-line)',
            fontSize: 13, fontWeight: 800, color: 'var(--rp-text-dim)',
            letterSpacing: '.04em', textTransform: 'uppercase' }}>{title}</div>
        )}
        {items.map((it, i) => (
          <button key={i} disabled={it.disabled}
            onClick={() => { if (!it.disabled) it.onClick(); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%',
              padding: '13px 18px', background: 'none', border: 'none',
              borderBottom: i < items.length - 1 ? '1px solid var(--rp-line)' : 'none',
              cursor: it.disabled ? 'not-allowed' : 'pointer', opacity: it.disabled ? 0.5 : 1,
              fontFamily: 'inherit', fontSize: 14, textAlign: 'start',
              color: it.danger ? 'var(--rp-danger-text)' : 'var(--rp-text)',
            }}>
            {it.icon && (
              <span style={{ flex: '0 0 auto', display: 'inline-flex',
                color: it.danger ? 'var(--rp-danger-text)' : 'var(--rp-gold)' }}>{it.icon}</span>
            )}
            <span style={{ flex: 1, fontWeight: 600 }}>{it.label}</span>
            {it.hint && <span style={{ fontSize: 12, color: 'var(--rp-text-dim)' }}>{it.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  ), document.body);
}

Object.assign(window, { RP_EXPORT, PrintableSummary, ActionSheet });
