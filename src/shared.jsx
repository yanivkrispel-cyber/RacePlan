// shared.jsx — primitives used by every skin: a themeable Stepper (one logic,
// four looks via `kind`), a drag-drop LogoSlot, and a zone legend.
// Skins set color via CSS custom properties on their root; see contract below.
const { formatPace, parsePace, formatKm } = window;
const I18N = window.I18N;
const t = (I18N && I18N.t) || ((k) => k);
const U = window.UNITS;

// ── skin switch: classic (navy + gold) or lime (black + lime) ─────────────
// Per device, opt-in: ?ui=lime once turns it on (remembered), ?ui=classic turns
// it off. The page head sets window.RP_LIME and <html data-ui> before any
// script runs (no flash); this repeats it for hosts whose head doesn't.
const LIME = (function () {
  if (typeof window === 'undefined') return false;
  if (typeof window.RP_LIME === 'boolean') return window.RP_LIME;
  let v = null;
  try {
    const q = new URLSearchParams(location.search).get('ui');
    if (q === 'lime' || q === 'classic') localStorage.setItem('rp-ui', q);
    v = localStorage.getItem('rp-ui');
  } catch (e) {}
  window.RP_LIME = v === 'lime';
  if (window.RP_LIME) document.documentElement.setAttribute('data-ui', 'lime');
  return window.RP_LIME;
})();

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
    --rp-placeholder:#8E93AB; /* ≥4.5:1 on bg/surface/surface-2 — it doubles as empty-state text */

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

  /* ── lime skin: the same roles, black + lime. "gold" is the accent role, so
     every --rp-gold* reader turns lime without a per-component edit. ── */
  :root[data-ui="lime"]{
    --rp-bg:#050605;
    --rp-surface:#0c0e0b;
    --rp-surface-2:#13160f;
    --rp-surface-3:#1b1f16;
    --rp-line:rgba(244,246,238,.10);
    --rp-line-soft:rgba(244,246,238,.06);
    --rp-line-input:rgba(244,246,238,.24);
    --rp-text:#F4F6EE;
    --rp-text-soft:#cdd2c3;
    --rp-text-dim:#8f9686;
    --rp-placeholder:#7d8475;
    --rp-gold:#DDFF4A;
    --rp-gold-soft:#e8ff8c;
    --rp-gold-deep:#c4e83a;
    --rp-gold-deep-hover:#e8ff8c;
    --rp-on-gold:#050605;
    --rp-gold-wash:rgba(221,255,74,.10);
    --rp-gold-line:rgba(221,255,74,.36);
    --rp-danger:#FF5A36;
    --rp-danger-text:#ff8466;
    --rp-danger-wash:rgba(255,90,54,.12);
    --rp-danger-line:rgba(255,90,54,.45);
    --rp-warn-bg:rgba(255,177,61,.10);
    --rp-warn-line:rgba(255,177,61,.40);
    --rp-zone-fast:#FF5A36;
    --rp-zone-target:#DDFF4A;
    --rp-zone-easy:#7fd3ff;
    --rp-elev:#8f9686;
    --rp-elev-up:#ff7a59;
    --rp-elev-down:#7fd3ff;
    --rp-grid:rgba(221,255,74,.07);
    --rp-avg:rgba(244,246,238,.36);
    --rp-shadow:0 2px 14px rgba(0,0,0,.6);
    --rp-shadow-modal:0 18px 60px rgba(0,0,0,.75);
    --rp-font-display:"Heebo",system-ui,-apple-system,sans-serif;
    --rp-font-accent:"Heebo",system-ui,sans-serif;
    --rp-font-mono:"JetBrains Mono",ui-monospace,Consolas,monospace;
    --rp-lime-glow:rgba(221,255,74,.35);
    --rp-tabbar-h:64px;
  }
  :root[data-ui="lime"] body{background:#050605}
  :root[data-ui="lime"] .rp-btn-primary{box-shadow:0 8px 26px rgba(221,255,74,.16)}
  /* the HUD voice: small Latin labels in mono, widely spaced */
  .rp-hud{font-family:var(--rp-font-mono,inherit);font-weight:700;letter-spacing:.16em;
    text-transform:uppercase;direction:ltr;unicode-bidi:isolate}
  @keyframes rp-blink{50%{opacity:.18}}
  @keyframes rp-pulse{0%{box-shadow:0 0 0 0 rgba(221,255,74,.45)}70%{box-shadow:0 0 0 8px rgba(221,255,74,0)}100%{box-shadow:0 0 0 0 rgba(221,255,74,0)}}
  .rp-blink{animation:rp-blink 1s steps(1) infinite}
  /* a digit arriving: a short neon flicker while it drops into place (on
     first paint every digit, staggered by --d; afterwards only the one that changed) */
  @keyframes rp-digit-in{0%{opacity:0;transform:translateY(-30%)}35%{opacity:.85}50%{opacity:.25}
    70%{opacity:1;transform:translateY(4%)}100%{opacity:1;transform:none}}
  .rp-digit{display:block;animation:rp-digit-in .42s cubic-bezier(.2,.9,.25,1) both;animation-delay:var(--d,0ms)}
  @keyframes rp-digit-roll{from{opacity:.25;transform:translateY(-28%)}to{opacity:1;transform:none}}
  .rp-digit-roll{display:block;animation:rp-digit-roll .24s cubic-bezier(.2,.9,.25,1) both}
  /* segment bar filling up, bar by bar */
  @keyframes rp-bar-in{from{transform:scaleX(0);opacity:.2}to{transform:none;opacity:1}}
  .rp-segbar.rp-fill i{animation:rp-bar-in .38s ease-out both;transform-origin:var(--rp-bar-origin,right)}
  .rp-pulse{animation:rp-pulse 2.4s ease-out infinite}

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
  return <span className={LIME ? 'rp-blink' : undefined} style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--rc-on)',
    filter: 'drop-shadow(0 0 3px var(--rc-glow))', display: 'block' }} />;
}

// The LED colours, per skin. Spread onto any element that holds SevenSeg /
// ClockDot (the planner's goal picker and route3d's run clock use it too).
const CLOCK_VARS = LIME
  ? { '--rc-on': '#DDFF4A', '--rc-off': 'rgba(221,255,74,.07)', '--rc-glow': 'rgba(221,255,74,.85)' }
  : { '--rc-on': '#F5C24A', '--rc-off': 'rgba(245,194,74,.11)', '--rc-glow': 'rgba(245,194,74,.7)' };

// Lime only: the four reticle corners around a clock (the HUD frame).
function ClockCorners({ inset = 5, size = 10, color = 'var(--rp-gold)' }) {
  const b = '1.5px solid ' + color;
  const c = { position: 'absolute', width: size, height: size, opacity: .85, pointerEvents: 'none' };
  return (
    <>
      <i aria-hidden="true" style={{ ...c, top: inset, left: inset, borderTop: b, borderLeft: b }} />
      <i aria-hidden="true" style={{ ...c, top: inset, right: inset, borderTop: b, borderRight: b }} />
      <i aria-hidden="true" style={{ ...c, bottom: inset, left: inset, borderBottom: b, borderLeft: b }} />
      <i aria-hidden="true" style={{ ...c, bottom: inset, right: inset, borderBottom: b, borderRight: b }} />
    </>
  );
}

// ── RacePlan mark (lime skin): RP drawn as three running-track lanes ────
// One path, stroked three times (wide fg, mid bg, thin fg) so every letter
// stroke reads as three parallel lanes; `solid` is the one-stroke version for
// sizes where the lanes would blur together (< ~32px).
const RP_MARK_D = 'M12 92 V10 H44 C64 10 70 22 70 33 C70 46 62 56 44 56 H12 M42 56 L66 92 '
  + 'M86 92 V10 H118 C138 10 144 22 144 33 C144 46 136 56 118 56 H86';
let _rpMarkId = 0;
function RPMark({ width = 120, fg = '#DDFF4A', bg = '#050605', solid, title = 'RACE PLAN' }) {
  const id = React.useMemo(() => 'rpm' + (++_rpMarkId), []);
  const widths = (solid != null ? solid : width < 32) ? [22] : [26, 15, 6];
  return (
    <svg width={width} height={width * 102 / 178} viewBox="-12 -6 178 102" role="img" aria-label={title}
      style={{ display: 'block', overflow: 'visible' }}>
      <defs><clipPath id={id}><rect x="-40" y="-20" width="260" height="112" /></clipPath></defs>
      <g clipPath={`url(#${id})`}>
        <g transform="skewX(-14) translate(14 0)" fill="none" strokeLinejoin="miter" strokeMiterlimit="3">
          {widths.map((w, i) => <path key={i} d={RP_MARK_D} stroke={i % 2 ? bg : fg} strokeWidth={w} />)}
        </g>
      </g>
    </svg>
  );
}
// The app icon: the mark on a rounded black tile.
function RPIcon({ size = 40, radius }) {
  return (
    <span style={{ width: size, height: size, borderRadius: radius != null ? radius : size * 0.24,
      background: '#050605', border: '1px solid rgba(221,255,74,.22)', display: 'inline-flex',
      alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', overflow: 'hidden' }}>
      <RPMark width={size * 0.78} />
    </span>
  );
}
// Wordmark: RACE PLAN in heavy slanted caps, BY KRISPEL small and wide in lime.
function RPWordmark({ size = 20, align = 'center' }) {
  return (
    <div dir="ltr" style={{ textAlign: align, lineHeight: 1 }}>
      <div style={{ fontWeight: 900, fontSize: size, letterSpacing: '.02em', color: 'var(--rp-text)',
        transform: 'skewX(-12deg)', display: 'inline-block', whiteSpace: 'nowrap' }}>RACE PLAN</div>
      <div style={{ fontWeight: 700, fontSize: Math.max(7, size * 0.3), letterSpacing: '.42em', color: 'var(--rp-gold)',
        marginTop: size * 0.22, whiteSpace: 'nowrap', paddingInlineStart: '.42em' }}>BY KRISPEL</div>
    </div>
  );
}

// Read-only seven-segment display of a total time (H:MM·SS) — the planner's
// goal-time hero card, and route3d.jsx's in-run clock at a smaller digitH.
function ClockDisplay({ totalSec, digitH = 38, onClick, caption, dim, live, children }) {
  const t = Math.max(0, Math.round(totalSec || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  // lime: on the first paint the digits flicker on one after another; after
  // that a digit that changes rolls in (keyed by value, so only it remounts).
  // A running clock (`live`: race day, the 3D run) ticks every second, so its
  // digits keep their place and just change.
  const first = React.useRef(true);
  React.useEffect(() => { first.current = false; }, []);
  let n = 0;
  const seg = LIME
    ? (v, k) => (
      <span key={live ? k : k + ':' + v} className={first.current ? 'rp-digit' : 'rp-digit-roll'}
        style={{ '--d': first.current ? (n++) * 70 + 'ms' : '0ms' }}>
        <SevenSeg value={dim ? null : v} h={digitH} /></span>)
    : (v, k) => <SevenSeg key={k} value={v} h={digitH} />;
  const well = (
    <div style={LIME ? {
      padding: '4px 6px', display: 'flex', direction: 'ltr', alignItems: 'center', justifyContent: 'center',
      gap: Math.max(3, digitH * 0.1), transform: 'skewX(-6deg)',
      filter: dim ? 'none' : 'drop-shadow(0 0 6px rgba(221,255,74,.4)) drop-shadow(0 0 18px rgba(221,255,74,.16))',
    } : { background: '#04050a', borderRadius: 12, padding: '9px 10px 7px',
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
    ...CLOCK_VARS,
    ...(dim ? { '--rc-on': 'rgba(221,255,74,.14)', '--rc-glow': 'transparent' } : null),
    background: LIME ? 'radial-gradient(120% 90% at 50% 40%, rgba(221,255,74,.07), transparent 65%), #020302' : '#12141d',
    border: LIME ? '1px solid var(--rp-gold-line)' : '1px solid var(--rp-line)', borderRadius: 16,
    padding: LIME ? '13px 15px 11px' : '10px 12px 9px', boxShadow: 'inset 0 2px 12px rgba(0,0,0,.45)',
    width: '100%', display: 'block', fontFamily: 'inherit', position: 'relative',
  };
  const body = (
    <>
      {LIME && <ClockCorners />}
      {well}
      {caption && (
        <div style={{ textAlign: 'center', fontSize: 9.5, fontWeight: 700, letterSpacing: '.14em',
          color: 'var(--rp-text-dim)', textTransform: 'uppercase', marginTop: 8 }}>{caption}</div>
      )}
      {children}
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} style={{ ...root, cursor: 'pointer' }}>{body}</button>
    : <div style={root}>{body}</div>;
}

// ── Escape closes the top-most open modal ────────────────────────────
// One window listener and a stack of handlers: every sheet/dialog registers
// while it's open, and Escape calls only the most recent one, so a confirm
// opened over a panel closes itself and leaves the panel alone. When focus is
// in a text field the first Escape is left to the field (cancel the edit /
// blur) instead of throwing the whole dialog away.
const _escStack = [];
if (typeof window !== 'undefined' && !window.__rpEscBound) {
  window.__rpEscBound = true;
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !_escStack.length || e.defaultPrevented) return;
    const el = e.target;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) {
      if (el.blur) el.blur();
      return;
    }
    e.preventDefault();
    _escStack[_escStack.length - 1]();
  });
}
function useEscape(onEscape, active = true) {
  const cb = React.useRef(onEscape);
  cb.current = onEscape;
  React.useEffect(() => {
    if (!active) return undefined;
    const entry = () => { if (cb.current) cb.current(); };
    _escStack.push(entry);
    return () => {
      const i = _escStack.lastIndexOf(entry);
      if (i >= 0) _escStack.splice(i, 1);
    };
  }, [active]);
}

// Line icons in place of emoji (Kris, 3.11.2026: "no generic icons", the lock and the weather first).
// currentColor on a 24 grid, so each sits in any text colour; `fill` for the solid ones (play / pause).
const CLOUD = 'M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.24';
const _G = (d, solid) => function RPGlyphIcon({ size = 16, sw = 2, style, title }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={solid ? 'currentColor' : 'none'}
      stroke={solid ? 'none' : 'currentColor'} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
      role={title ? 'img' : undefined} aria-label={title || undefined} aria-hidden={title ? undefined : 'true'}
      style={{ display: 'inline-block', verticalAlign: '-0.16em', flex: '0 0 auto', ...style }}>
      {[].concat(d).map((x, i) => (typeof x === 'string' ? <path key={i} d={x} /> : <React.Fragment key={i}>{x}</React.Fragment>))}
    </svg>
  );
};
const RPGlyph = {
  lock: _G([<rect x="5" y="11" width="14" height="10" rx="2.5" />, 'M8 11V8a4 4 0 0 1 8 0v3']),
  unlock: _G([<rect x="5" y="11" width="14" height="10" rx="2.5" />, 'M8 11V8a4 4 0 0 1 7.6-1.8']),
  sun: _G([<circle cx="12" cy="12" r="4" />, 'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41']),
  partly: _G(['M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41', 'M15.95 12.65a4 4 0 0 0-5.93-4.13', 'M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z']),
  fog: _G([CLOUD, 'M16 17H7M17 21H9']),
  drizzle: _G([CLOUD, 'M8 19v1M8 14v1M16 19v1M16 14v1M12 21v1M12 16v1']),
  rain: _G([CLOUD, 'M16 14v6M8 14v6M12 16v6']),
  snow: _G([CLOUD, 'M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01']),
  storm: _G(['M6 16.33A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 .5 8.97', 'm13 12-3 5h4l-3 5']),
  history: _G(['M3 3v18h18', 'M18 17V9M13 17V5M8 17v-3']),
  globe: _G([<circle cx="12" cy="12" r="10" />, 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20']),
  thermo: _G(['M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z']),
  warn: _G(['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z', 'M12 9v4M12 17h.01']),
  check: _G(['M20 6 9 17l-5-5']),
  pin: _G(['M20 10c0 5-8 12-8 12s-8-7-8-12a8 8 0 0 1 16 0Z', <circle cx="12" cy="10" r="3" />]),
  play: _G(['M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z'], true),
  pause: _G([<rect x="6" y="4" width="4" height="16" rx="1.2" />, <rect x="14" y="4" width="4" height="16" rx="1.2" />], true),
};

Object.assign(window, { Stepper, LogoSlot, ZoneLegend, SevenSeg, ClockDot, ClockDisplay, useEscape,
  CLOCK_VARS, ClockCorners, RPMark, RPIcon, RPWordmark, RPGlyph });
