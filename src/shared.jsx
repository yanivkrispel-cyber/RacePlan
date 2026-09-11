// shared.jsx — primitives used by every skin: a themeable Stepper (one logic,
// four looks via `kind`), a drag-drop LogoSlot, and a zone legend.
// Skins set color via CSS custom properties on their root; see contract below.
const { formatPace, parsePace, formatKm } = window;
const I18N = window.I18N;
const t = (I18N && I18N.t) || ((k) => k);
const U = window.UNITS;

// ── design tokens ──────────────────────────────────────────────────────
// Dark adaptation of DESIGN_TOKENS.md: the navy/gold/sand roles kept, mapped
// onto a dark navy ground. Everything downstream reads these vars, so the
// palette lives here once.
if (!document.getElementById('rp-tokens')) {
  const s = document.createElement('style');
  s.id = 'rp-tokens';
  s.textContent = `
  :root{
    /* surfaces — navy family on a deep ground */
    --rp-bg:#111528;
    --rp-surface:#1a2140;
    --rp-surface-2:#222a4d;
    --rp-surface-3:#2c355e;
    --rp-line:rgba(233,220,196,.14);
    --rp-line-soft:rgba(233,220,196,.08);
    --rp-line-input:rgba(233,220,196,.30);

    /* text — cream family */
    --rp-text:#F6EFE3;
    --rp-text-soft:#D9D3C5;
    --rp-text-dim:#9BA0B7;
    --rp-placeholder:#797E97;

    /* gold accent */
    --rp-gold:#C9A24B;
    --rp-gold-soft:#DEC38C;
    --rp-gold-deep:#B98B34;
    --rp-gold-deep-hover:#D3AF5D;
    --rp-on-gold:#1a2140;
    --rp-gold-wash:rgba(201,162,75,.14);
    --rp-gold-line:rgba(201,162,75,.42);

    /* status */
    --rp-danger:#C15A2E;
    --rp-danger-text:#E1804F;
    --rp-danger-wash:rgba(193,90,46,.15);
    --rp-danger-line:rgba(193,90,46,.42);
    --rp-warn-bg:rgba(201,162,75,.12);
    --rp-warn-line:rgba(221,195,140,.34);

    /* pace zones (semantic: fast=danger, target=gold, easy=navy-muted) */
    --rp-zone-fast:#C15A2E;
    --rp-zone-target:#C9A24B;
    --rp-zone-easy:#8091BE;

    /* chart + elevation deltas (climb = wine/bordeaux, descent = cool blue) */
    --rp-elev:#7C88B0;
    --rp-elev-up:#C36079;
    --rp-elev-down:#7C9BD6;
    --rp-grid:rgba(246,239,227,.07);
    --rp-avg:rgba(246,239,227,.38);

    /* spacing scale (DESIGN_TOKENS §Spacing) */
    --rp-s-3:3px;--rp-s-4:4px;--rp-s-6:6px;--rp-s-8:8px;--rp-s-10:10px;
    --rp-s-12:12px;--rp-s-14:14px;--rp-s-18:18px;--rp-s-20:20px;--rp-s-24:24px;
    --rp-s-28:28px;--rp-s-40:40px;

    /* radii */
    --rp-r-4:4px;--rp-r-8:8px;--rp-r-12:12px;--rp-r-14:14px;--rp-r-pill:999px;

    /* shadow — only on floating surfaces */
    --rp-shadow:0 2px 10px rgba(0,0,0,.38);
    --rp-shadow-modal:0 18px 48px rgba(0,0,0,.58);

    /* type families */
    --rp-font-display:"Frank Ruhl Libre","Heebo",Georgia,serif;
    --rp-font-ui:"Heebo",system-ui,-apple-system,sans-serif;
    --rp-font-accent:"Cormorant Garamond","Frank Ruhl Libre",Georgia,serif;

    /* motion */
    --rp-t-fast:150ms cubic-bezier(.22,1,.36,1);
    --rp-t-panel:220ms ease;
    --rp-t-phase:320ms ease;

    /* focus ring — visible on light and navy */
    --rp-focus:0 0 0 2px var(--rp-bg),0 0 0 4px var(--rp-gold);

    /* page padding — patient-app comfortable; wider on desktop */
    --rp-pad:16px;
  }
  @media (min-width:760px){ :root{ --rp-pad:24px; } }

  /* legacy --rp-* contract, remapped onto the tokens above so existing
     components reskin without per-value edits */
  .rp-cq{
    --rp-accent:var(--rp-gold);
    --rp-on-accent:var(--rp-on-gold);
    --rp-field-bg:var(--rp-surface-2);
    --rp-field-border:var(--rp-line);
    --rp-btn-bg:var(--rp-gold);
    --rp-btn-hover:var(--rp-gold-wash);
    --rp-btn-text:var(--rp-on-gold);
    --rp-seg-gap:var(--rp-s-8);
    --rp-seg-bg:var(--rp-surface);
    --rp-seg-border:1px solid var(--rp-line);
    --rp-seg-radius:var(--rp-r-12);
    --rp-seg-hover:var(--rp-surface-2);
  }

  /* focus-visible everywhere inside the app */
  .rp-cq :where(button,a,input,select,[tabindex]):focus-visible{
    outline:none;box-shadow:var(--rp-focus);border-radius:var(--rp-r-8);
  }

  @media (prefers-reduced-motion:reduce){
    *,*::before,*::after{
      animation-duration:.01ms!important;animation-iteration-count:1!important;
      transition-duration:.01ms!important;scroll-behavior:auto!important;
    }
  }

  /* ── phones: compact steppers (the segments table is dense), but keep the
     standalone action buttons / presets at a comfortable tap size ── */
  @container (max-width:640px){
    /* inside the dense segments table the pill background is dropped so two
       steppers fit on one row; elsewhere the pill look is kept */
    .rpt-seg .rp-stp-pill,.rpt-total .rp-stp-pill{background:transparent;border:0;padding:0;gap:0}
    .rpt-seg .rp-stp-pill .rp-stp-btn{width:24px;height:26px;background:transparent;
      color:var(--rp-gold);font-size:17px}
    .rpt-seg .rp-stp-pill .rp-stp-val{width:auto;min-width:34px;max-width:44px;height:26px;
      font-size:13.5px;font-weight:700}
    .rp-stp-boxed .rp-stp-btn{width:34px;height:34px;font-size:18px}
    .rp-stp-boxed .rp-stp-val{width:52px;height:34px;font-size:14px}
    .rp-btn{padding:11px 15px!important;font-size:15px!important;min-height:44px}
    .rpt-preset{padding:10px 14px;min-height:46px;font-size:15px}
  }
  `;
  document.head.appendChild(s);
}

if (!document.getElementById('rp-shared-styles')) {
  const s = document.createElement('style');
  s.id = 'rp-shared-styles';
  s.textContent = `
  /* CSS var contract a skin root must provide:
     --rp-accent --rp-field-bg --rp-field-border --rp-text --rp-text-dim
     --rp-btn-bg --rp-btn-hover --rp-btn-text  */
  .rp-stp{display:inline-flex;align-items:center;direction:ltr;
    font-variant-numeric:tabular-nums;user-select:none}
  .rp-stp-val{background:transparent;border:none;outline:none;text-align:center;
    color:var(--rp-text);font:inherit;font-weight:600;padding:0;min-width:0;
    -moz-appearance:textfield}
  .rp-stp-val:focus{box-shadow:0 0 0 2px var(--rp-accent) inset;border-radius:6px}
  .rp-stp-btn{border:none;cursor:pointer;display:flex;align-items:center;
    justify-content:center;font:inherit;font-weight:600;line-height:1;padding:0;
    transition:background .12s,color .12s,opacity .12s,transform .08s}
  .rp-stp-btn:active{transform:scale(.9)}

  .rp-stp-boxed{background:var(--rp-field-bg);border:1px solid var(--rp-field-border);
    border-radius:9px;overflow:hidden}
  .rp-stp-boxed .rp-stp-btn{width:30px;height:34px;background:transparent;color:var(--rp-text-dim);font-size:17px}
  .rp-stp-boxed .rp-stp-btn:hover{background:var(--rp-btn-hover);color:var(--rp-accent)}
  .rp-stp-boxed .rp-stp-val{width:54px;height:34px;font-size:15px}

  .rp-stp-pill{background:var(--rp-field-bg);border-radius:999px;padding:3px;gap:3px;
    border:1px solid var(--rp-field-border)}
  .rp-stp-pill .rp-stp-btn{width:27px;height:27px;border-radius:50%;
    background:var(--rp-btn-bg);color:var(--rp-btn-text);font-size:15px}
  .rp-stp-pill .rp-stp-btn:hover{filter:brightness(1.12)}
  .rp-stp-pill .rp-stp-val{width:50px;height:27px;font-size:14px}

  .rp-stp-split{gap:6px}
  .rp-stp-split .rp-stp-btn{width:32px;height:32px;border-radius:8px;
    border:1px solid var(--rp-field-border);background:var(--rp-field-bg);
    color:var(--rp-text);font-size:16px}
  .rp-stp-split .rp-stp-btn:hover{border-color:var(--rp-accent);color:var(--rp-accent)}
  .rp-stp-split .rp-stp-val{width:58px;height:32px;font-size:15px;
    border:1px solid var(--rp-field-border);border-radius:8px;background:var(--rp-field-bg)}

  .rp-stp-minimal .rp-stp-btn{width:23px;height:23px;border-radius:7px;
    background:transparent;color:var(--rp-text-dim);opacity:.45;font-size:15px}
  .rp-stp-minimal:hover .rp-stp-btn{opacity:1}
  .rp-stp-minimal .rp-stp-btn:hover{background:var(--rp-btn-hover);color:var(--rp-accent)}
  .rp-stp-minimal .rp-stp-val{width:58px;font-size:17px;font-weight:700}

  .rp-logo{position:relative}
  .rp-logo image-slot{width:100%;height:100%;display:block}
  `;
  document.head.appendChild(s);
}

// kind: 'boxed' | 'pill' | 'split' | 'minimal'
// type: 'pace' | 'dist'
function Stepper({ value, type, onStep, onSet, kind = 'boxed', step }) {
  const fmt = type === 'pace' ? formatPace : (v) => formatKm(v);
  const parse = type === 'pace' ? parsePace : (s) => parseFloat(s);
  const stepBy = step != null ? step : (type === 'pace' ? 5 : 0.05);
  const [editing, setEditing] = React.useState(null);
  const display = fmt(value);
  const shown = editing != null ? editing : display;

  const commit = () => {
    if (editing == null) return;
    const n = parse(editing);
    if (isFinite(n)) onSet(n);
    setEditing(null);
  };

  return (
    <div className={`rp-stp rp-stp-${kind}`}>
      <button className="rp-stp-btn rp-stp-plus" tabIndex={-1} onClick={() => onStep(+stepBy)} aria-label={t('common.add')}>+</button>
      <input
        className="rp-stp-val"
        type="text"
        inputMode={type === 'pace' ? 'text' : 'decimal'}
        value={shown}
        onChange={(e) => setEditing(e.target.value)}
        onFocus={(e) => { setEditing(display); requestAnimationFrame(() => e.target.select()); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') { setEditing(null); e.currentTarget.blur(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); onStep(+stepBy); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); onStep(-stepBy); }
        }}
      />
      <button className="rp-stp-btn rp-stp-minus" tabIndex={-1} onClick={() => onStep(-stepBy)} aria-label={t('common.decrease')}>−</button>
    </div>
  );
}

// Shared logo drop-zone. All slots share one id so the user drops a logo once
// and it appears in every frame after reload. fit=contain keeps a logo intact.
function LogoSlot({ width, height, radius = 10, shape = 'rounded', fit = 'contain', style }) {
  return (
    <div className="rp-logo" style={{ width, height, ...style }}
      dangerouslySetInnerHTML={{
        __html: `<image-slot id="raceplan-logo" fit="${fit}" shape="${shape}" radius="${radius}" placeholder="${t('common.logo')}"></image-slot>`,
      }} />
  );
}

function ZoneLegend({ colors, style, dim }) {
  const items = [['fast', t('zone.fast')], ['target', t('zone.target')], ['easy', t('zone.easy')]];
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', ...style }}>
      {items.map(([k, label]) => (
        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: dim }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: colors.zones[k] }} />
          {label}
        </span>
      ))}
    </div>
  );
}

// ── seven-segment race clock (CSS/SVG) ─────────────────────────────────
// Shared between the planner's goal-time hero (ClockDisplay, read-only) and
// the interactive h/m/s picker (ClockGroup/RaceClock, in planner-b.jsx) and
// route3d.jsx's in-run clock — one look for "premium LED clock" everywhere.
const SEG_ON = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg',
  5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
const SEG_PTS = {
  a: '3,4 5,2 19,2 21,4 19,6 5,6',
  g: '3,22 5,20 19,20 21,22 19,24 5,24',
  d: '3,40 5,38 19,38 21,40 19,42 5,42',
  f: '3,5 5,7 5,19 3,21 1,19 1,7',
  b: '21,5 23,7 23,19 21,21 19,19 19,7',
  e: '3,23 5,25 5,37 3,39 1,37 1,25',
  c: '21,23 23,25 23,37 21,39 19,37 19,25',
};
function SevenSeg({ value, h = 44 }) {
  const on = SEG_ON[value] || '';
  return (
    <svg viewBox="0 0 24 44" height={h} width={h * (24 / 44)} style={{ display: 'block' }}>
      {Object.keys(SEG_PTS).map((k) => {
        const lit = on.indexOf(k) !== -1;
        return (
          <polygon key={k} points={SEG_PTS[k]}
            fill={lit ? 'var(--rc-on)' : 'var(--rc-off)'}
            style={lit ? { filter: 'drop-shadow(0 0 2.5px var(--rc-glow))' } : undefined} />
        );
      })}
    </svg>
  );
}
function ClockDot() {
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--rc-on)',
    filter: 'drop-shadow(0 0 3px var(--rc-glow))', display: 'block' }} />;
}

// Read-only seven-segment display of a total time (H:MM·SS) — the planner's
// goal-time hero card, and route3d.jsx's in-run clock at a smaller digitH.
function ClockDisplay({ totalSec, digitH = 38, onClick, caption }) {
  const t = Math.max(0, Math.round(totalSec || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const seg = (v, k) => <SevenSeg key={k} value={v} h={digitH} />;
  const well = (
    <div style={{ background: '#04050a', borderRadius: 12, padding: '9px 10px 7px',
      display: 'flex', direction: 'ltr', alignItems: 'center', justifyContent: 'center', gap: 4,
      boxShadow: 'inset 0 0 22px rgba(0,0,0,.75)' }}>
      {String(h).split('').map((c, i) => seg(+c, 'h' + i))}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '0 3px' }}>
        <ClockDot /><ClockDot />
      </div>
      {seg(Math.floor(m / 10), 'm0')}{seg(m % 10, 'm1')}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '0 3px' }}>
        <ClockDot /><ClockDot />
      </div>
      {seg(Math.floor(s / 10), 's0')}{seg(s % 10, 's1')}
    </div>
  );
  const root = {
    '--rc-on': '#F5C24A', '--rc-off': 'rgba(245,194,74,.11)', '--rc-glow': 'rgba(245,194,74,.7)',
    background: '#12141d', border: '1px solid var(--rp-line)', borderRadius: 16,
    padding: '10px 12px 9px', boxShadow: 'inset 0 2px 12px rgba(0,0,0,.45)',
    width: '100%', display: 'block', fontFamily: 'inherit',
  };
  const body = (
    <>
      {well}
      {caption && (
        <div style={{ textAlign: 'center', fontSize: 9.5, fontWeight: 700, letterSpacing: '.14em',
          color: 'var(--rp-text-dim)', textTransform: 'uppercase', marginTop: 8 }}>{caption}</div>
      )}
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} style={{ ...root, cursor: 'pointer' }}>{body}</button>
    : <div style={root}>{body}</div>;
}

Object.assign(window, { Stepper, LogoSlot, ZoneLegend, SevenSeg, ClockDot, ClockDisplay });
