// valueeditor.jsx — window.ValueEditor: a compact editor for one segment
// value (pace or distance). Tapping the value in the segments table opens it.
// Combines three ways to set the number: a scroll wheel (choose), fixed-jump
// buttons with hold-to-repeat, and tap-to-type an exact value.
const { formatPace, formatKm, parsePace } = window;

const z2 = (n) => String(n).padStart(2, '0');

// small accelerating hold-repeat button (mirrors planner-b's HoldButton, kept
// local so this file has no cross-module dependency)
function HoldBtn({ delta, onStep, children, ariaLabel }) {
  const t = React.useRef(null);
  const stop = () => { if (t.current) { clearTimeout(t.current); t.current = null; } };
  React.useEffect(() => stop, []);
  const start = (e) => {
    e.preventDefault();
    onStep(delta);
    let gap = 320;
    const tick = () => { onStep(delta); gap = Math.max(45, gap * 0.82); t.current = setTimeout(tick, gap); };
    t.current = setTimeout(tick, 400);
  };
  return (
    <button type="button" aria-label={ariaLabel || (delta < 0 ? 'הפחת' : 'הוסף')}
      onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      style={{
        minWidth: 44, minHeight: 40, borderRadius: 9, cursor: 'pointer',
        touchAction: 'manipulation', fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
        background: 'var(--rp-surface-2)', border: '1px solid var(--rp-line)', color: 'var(--rp-text)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
      }}>{children}</button>
  );
}

// A vertical scroll-snap wheel. items: number[]. Reports the centred item.
function Wheel({ items, value, onChange, format, label }) {
  const ITEM_H = 36;
  const ref = React.useRef(null);
  const lock = React.useRef(false);
  const idxOf = (v) => { const i = items.indexOf(v); return i < 0 ? 0 : i; };

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = idxOf(value) * ITEM_H;
    if (Math.abs(el.scrollTop - target) > 2) {
      lock.current = true;
      el.scrollTop = target;
      setTimeout(() => { lock.current = false; }, 70);
    }
  }, [value]);

  const onScroll = () => {
    const el = ref.current;
    if (!el || lock.current) return;
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      let i = Math.round(el.scrollTop / ITEM_H);
      i = Math.max(0, Math.min(items.length - 1, i));
      const snap = i * ITEM_H;
      if (Math.abs(el.scrollTop - snap) > 1) {
        lock.current = true;
        el.scrollTop = snap;
        setTimeout(() => { lock.current = false; }, 70);
      }
      if (items[i] !== value) onChange(items[i]);
    }, 110);
  };

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <div ref={ref} onScroll={onScroll} className="rp-wheel" style={{
        height: ITEM_H * 5, overflowY: 'scroll', scrollSnapType: 'y mandatory',
        WebkitOverflowScrolling: 'touch',
        maskImage: 'linear-gradient(180deg,transparent,#000 28%,#000 72%,transparent)',
        WebkitMaskImage: 'linear-gradient(180deg,transparent,#000 28%,#000 72%,transparent)',
      }}>
        <div style={{ height: ITEM_H * 2 }} />
        {items.map((it, i) => (
          <div key={i} style={{
            height: ITEM_H, lineHeight: ITEM_H + 'px', textAlign: 'center',
            scrollSnapAlign: 'center', fontVariantNumeric: 'tabular-nums',
            fontSize: it === value ? 22 : 16, fontWeight: it === value ? 800 : 500,
            color: it === value ? 'var(--rp-gold)' : 'var(--rp-text-dim)',
          }}>{format ? format(it) : String(it)}</div>
        ))}
        <div style={{ height: ITEM_H * 2 }} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: ITEM_H * 2, height: ITEM_H,
        border: '1px solid var(--rp-gold-line)', borderRadius: 8, pointerEvents: 'none' }} />
      {label && <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--rp-text-dim)',
        marginTop: 5, letterSpacing: '.04em' }}>{label}</div>}
    </div>
  );
}

const PACE_MIN = []; for (let i = 2; i <= 15; i++) PACE_MIN.push(i);
const PACE_SEC = []; for (let i = 0; i < 60; i++) PACE_SEC.push(i);
const DIST_KM = []; for (let i = 0; i <= 60; i++) DIST_KM.push(i);
const DIST_M = []; for (let i = 0; i < 1000; i += 10) DIST_M.push(i); // sub-km, metres

function ValueEditor({ type, value, title, onApply, onClose }) {
  const isPace = type === 'pace';
  const clampV = (v) => isPace
    ? Math.max(120, Math.min(900, Math.round(v)))
    : Math.max(0.05, Math.min(99, Math.round(v * 100) / 100));

  const [val, setVal] = React.useState(() => clampV(value));
  const [typing, setTyping] = React.useState(null);

  const bump = (d) => setVal((v) => clampV(v + d));

  const pm = Math.floor(val / 60);
  const ps = Math.round(val % 60);
  const dk = Math.floor(val + 1e-9);
  const dm = Math.round((val - dk) * 1000 / 10) * 10; // sub-km part, in metres (0..990)

  const jumps = isPace
    ? [{ d: 10, t: '10' }, { d: 5, t: '5' }, { d: 1, t: '1' }]
    : [{ d: 0.1, t: '100' }, { d: 0.05, t: '50' }, { d: 0.01, t: '10' }]; // metres
  const ltr = { direction: 'ltr', unicodeBidi: 'isolate' };
  const fmtVal = isPace ? formatPace(val) : formatKm(val);

  const commitTyping = () => {
    if (typing == null) return;
    let n = NaN;
    if (isPace) {
      const digits = String(typing).replace(/\D/g, '');
      if (digits) n = digits.length <= 2 ? +digits * 60
        : +digits.slice(0, -2) * 60 + +digits.slice(-2);
      if (!isFinite(n)) { const p = parsePace(typing); if (isFinite(p)) n = p; }
    } else {
      n = parseFloat(typing);
    }
    if (isFinite(n)) setVal(clampV(n));
    setTyping(null);
  };

  return ReactDOM.createPortal((
    <div className="rp-sheet-wrap rp-cq-scope"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(9,11,22,.78)',
        backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 18, direction: 'rtl', fontFamily: 'var(--rp-font-ui)', color: 'var(--rp-text)' }}>
      <style>{`
        .rp-wheel::-webkit-scrollbar{display:none}
        .rp-wheel{scrollbar-width:none}
        @media (max-width: 640px){
          .rp-sheet-wrap{ align-items: flex-end !important; padding: 0 !important; }
          .ve-sheet{ width: 100% !important; max-width: none !important;
            border-radius: 18px 18px 0 0 !important; }
        }
      `}</style>

      <div className="ve-sheet" style={{ background: 'var(--rp-surface)', border: '1px solid var(--rp-line)',
        borderRadius: 'var(--rp-r-14)', width: '100%', maxWidth: 380,
        boxShadow: 'var(--rp-shadow-modal)', padding: '14px 16px 16px' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{title || (isPace ? 'קצב' : 'מרחק')}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--rp-text-dim)', fontSize: 20, lineHeight: 1, padding: '2px 6px' }}>✕</button>
        </div>

        {/* wheels — LTR so the larger unit sits on the left */}
        <div style={{ display: 'flex', direction: 'ltr', alignItems: 'flex-start', gap: 6, justifyContent: 'center' }}>
          {isPace ? (
            <>
              <Wheel items={PACE_MIN} value={pm} label="דקות"
                onChange={(m) => setVal(clampV(m * 60 + ps))} />
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--rp-text-dim)',
                lineHeight: '180px' }}>:</div>
              <Wheel items={PACE_SEC} value={ps} format={z2} label="שניות"
                onChange={(s) => setVal(clampV(pm * 60 + s))} />
            </>
          ) : (
            <>
              <Wheel items={DIST_KM} value={dk} label={'ק"מ'}
                onChange={(k) => setVal(clampV(k + dm / 1000))} />
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--rp-text-dim)',
                lineHeight: '180px' }}>.</div>
              <Wheel items={DIST_M} value={dm} label="מטרים"
                onChange={(m) => setVal(clampV(dk + m / 1000))} />
            </>
          )}
        </div>

        {/* fixed jumps + tap-to-type */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 12, justifyContent: 'center' }}>
          {jumps.map(({ d, t }) => (
            <HoldBtn key={'m' + t} delta={-d} onStep={bump}>
              <span style={ltr}>−{t}</span>
            </HoldBtn>
          ))}
          {typing == null ? (
            <button onClick={() => setTyping(fmtVal)} style={{
              minWidth: 76, minHeight: 40, borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit',
              fontWeight: 800, fontSize: 17, fontVariantNumeric: 'tabular-nums',
              background: 'var(--rp-surface-2)', border: '1px solid var(--rp-gold-line)',
              color: 'var(--rp-gold)', flex: '0 0 auto',
            }}>{fmtVal}</button>
          ) : (
            <input autoFocus value={typing} inputMode={isPace ? 'numeric' : 'decimal'}
              onChange={(e) => setTyping(e.target.value)} onBlur={commitTyping}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') { setTyping(null); e.currentTarget.blur(); } }}
              style={{ minWidth: 76, minHeight: 40, borderRadius: 9, textAlign: 'center',
                fontFamily: 'inherit', fontWeight: 800, fontSize: 17, flex: '0 0 auto',
                background: 'var(--rp-surface-2)', border: '1px solid var(--rp-gold-line)',
                color: 'var(--rp-text)', outline: 'none' }} />
          )}
          {jumps.map(({ d, t }) => (
            <HoldBtn key={'p' + t} delta={d} onStep={bump}>
              <span style={ltr}>+{t}</span>
            </HoldBtn>
          ))}
        </div>

        <button className="rp-btn rp-btn-primary" onClick={() => onApply(val)}
          style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}>אישור</button>
      </div>
    </div>
  ), document.body);
}

Object.assign(window, { ValueEditor });
