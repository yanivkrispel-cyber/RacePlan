// tracking.jsx: the owner's screen for the anonymous funnel counters (Firestore stats/{day}).
// Written by functions/tracking.js; the app's side is track() in web/firebase-init.js.

// [step, the step its percentage is taken from]
const TK_FUNNEL = [
  ['land'], ['inapp', 'land'], ['inapp_tap', 'inapp'], ['hop', 'inapp_tap'], ['signin_tap', 'land'], ['signup', 'signin_tap'], ['install'],
];
const TK_USE = [['active'], ['planner', 'active'], ['plan_saved', 'planner'], ['watch', 'planner']];
const TK_BRANDS = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', whatsapp: 'WhatsApp', telegram: 'Telegram', google: 'Google' };
const TK_DEVICE = { ios: 'iPhone', android: 'Android' };

function tkSum(rows, group, step) {
  const out = {};
  rows.forEach((r) => {
    const m = (r[group] && r[group][step]) || {};
    Object.keys(m).forEach((k) => { out[k] = (out[k] || 0) + (Number(m[k]) || 0); });
  });
  return out;
}
function tkTotal(m) { return Object.values(m).reduce((a, b) => a + b, 0); }

function TkRows({ steps, rows }) {
  const totals = {};
  steps.forEach(([s]) => { totals[s] = tkTotal(tkSum(rows, 's', s)); });
  const max = Math.max(1, ...Object.values(totals));
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {steps.map(([s, of]) => {
        const n = totals[s];
        const base = of ? totals[of] : 0;
        return (
          <div key={s} style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{t('stats.step.' + s)}</span>
              <span style={{ fontSize: 20, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{n}</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--rp-surface-2)' }}>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--rp-accent, var(--rp-text))', width: (n / max) * 100 + '%' }} />
            </div>
            {base > 0 && <div style={{ fontSize: 12, color: 'var(--rp-text-dim)' }}>
              {t('stats.pct', { pct: Math.min(100, Math.round((n / base) * 100)) })}</div>}
          </div>
        );
      })}
    </div>
  );
}

function TkSplit({ title, map, label }) {
  const items = Object.entries(map).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!items.length) return null;
  return (
    <section style={{ display: 'grid', gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
      {items.map(([k, n]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
          <span>{label(k)}</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{n}</b>
        </div>
      ))}
    </section>
  );
}

// One spreadsheet cell. A name is the person's own text, so a leading = + - @ must not run as a formula in Excel.
function tkCsvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function tkCsv(rows) {
  return '﻿' + rows.map((r) => r.map(tkCsvCell).join(',')).join('\r\n');
}
// end of the spreadsheet helpers (test/tracking.test.mjs reads them from here)

const TK_WEEK_MS = 7 * 86400000;
const TK_PEOPLE_FILTERS = {
  all: () => true,
  new: (p, now) => p.joined >= now - TK_WEEK_MS,
  active: (p, now) => p.last >= now - TK_WEEK_MS,
  once: (p) => p.visits <= 1,
};
const TK_PEOPLE_PAGE = 100;

function tkDate(ms) {
  if (!ms) return '';
  try { return new Intl.DateTimeFormat(I18N.locale, { day: 'numeric', month: 'numeric', year: '2-digit' }).format(new Date(ms)); }
  catch (e) { return ''; }
}
function tkMailto(email) { return 'mailto:' + encodeURIComponent(email).replace(/%40/g, '@'); }

function TkFact({ label, value }) {
  return (
    <div style={{ display: 'grid', gap: 1, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: 'var(--rp-text-dim)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function TkPeople({ people, srcLabel, card }) {
  const FB = window.RP_FIREBASE;
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [filter, setFilter] = React.useState('all');
  const [shown, setShown] = React.useState(TK_PEOPLE_PAGE);
  const [activity, setActivity] = React.useState(null); // null = loading, false = failed
  React.useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setActivity(null);
    FB.usersActivity().then((a) => { if (live) setActivity(a || {}); }, () => { if (live) setActivity(false); });
    return () => { live = false; };
  }, [open, people]);

  const now = Date.now();
  const needle = q.trim().toLowerCase();
  const list = people.filter((p) => TK_PEOPLE_FILTERS[filter](p, now)
    && (!needle || p.name.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle)));
  const unknown = t('stats.people.unknown');
  const act = (p) => (activity && activity[p.id]) || null;
  const watchText = (a) => {
    if (!a) return unknown;
    return t('stats.people.watch.' + (a.watch || 'none'));
  };
  const langName = (p) => (I18N.localeNames && I18N.localeNames[p.locale]) || unknown;

  const download = () => {
    const head = ['name', 'email', 'joined', 'last', 'visits', 'source', 'lang', 'plans', 'watch', 'sent'].map((k) => t('stats.people.' + k));
    const body = list.map((p) => {
      const a = act(p);
      return [p.name, p.email, tkDate(p.joined), tkDate(p.last), p.visits, p.src ? srcLabel(p.src) : '', p.locale ? langName(p) : '',
        a ? a.plans : '', a ? watchText(a) : '', a ? a.sent : ''];
    });
    const url = URL.createObjectURL(new Blob([tkCsv([head, ...body])], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'raceplan-users-' + FB.statsDay(0) + '.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  return (
    <section style={card}>
      <button className="rp-btn" aria-expanded={open} onClick={() => setOpen(!open)}
        style={{ justifyContent: 'space-between', width: '100%', fontWeight: 800 }}>
        <span>{t('stats.people.title', { n: people.length })}</span>
        <span aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>▾</span>
      </button>
      {open && (
        <>
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setShown(TK_PEOPLE_PAGE); }}
            placeholder={t('stats.people.search')} aria-label={t('stats.people.search')}
            style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, fontSize: 16, fontFamily: 'inherit',
              background: 'var(--rp-surface-2)', color: 'var(--rp-text)', border: '1px solid var(--rp-line)' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
            {Object.keys(TK_PEOPLE_FILTERS).map((k) => (
              <button key={k} aria-pressed={filter === k} className={'rp-btn' + (filter === k ? ' rp-btn-primary' : '')}
                style={{ justifyContent: 'center', padding: '8px 4px', fontSize: 13 }}
                onClick={() => { setFilter(k); setShown(TK_PEOPLE_PAGE); }}>{t('stats.people.f.' + k)}</button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: 'var(--rp-text-dim)' }}>{t('stats.people.count', { n: list.length })}</span>
            <button className="rp-btn" disabled={!list.length || activity === null} onClick={download}>{t('stats.people.export')}</button>
          </div>
          {activity === false && <div style={{ fontSize: 13, color: 'var(--rp-text-dim)' }}>{t('stats.people.activityFailed')}</div>}
          {!list.length && <div style={{ color: 'var(--rp-text-dim)' }}>{t('stats.people.none')}</div>}
          <div style={{ display: 'grid', gap: 10 }}>
            {list.slice(0, shown).map((p) => {
              const a = act(p);
              const pending = activity === null ? '…' : unknown;
              return (
                <article key={p.id} style={{ display: 'grid', gap: 8, paddingBlockEnd: 10, borderBlockEnd: '1px solid var(--rp-line)' }}>
                  <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                    <b style={{ fontSize: 15 }}><bdi>{p.name || unknown}</bdi></b>
                    {p.email && <a href={tkMailto(p.email)} dir="ltr" style={{ fontSize: 13, color: 'var(--rp-accent, var(--rp-text))', overflowWrap: 'anywhere', justifySelf: 'start' }}>{p.email}</a>}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                    <TkFact label={t('stats.people.joined')} value={tkDate(p.joined) || unknown} />
                    <TkFact label={t('stats.people.last')} value={tkDate(p.last) || unknown} />
                    <TkFact label={t('stats.people.visits')} value={p.visits} />
                    <TkFact label={t('stats.people.source')} value={p.src ? srcLabel(p.src) : unknown} />
                    <TkFact label={t('stats.people.lang')} value={langName(p)} />
                    <TkFact label={t('stats.people.plans')} value={a ? a.plans : pending} />
                    <TkFact label={t('stats.people.watch')} value={a ? watchText(a) : pending} />
                    <TkFact label={t('stats.people.sent')} value={a ? a.sent : pending} />
                  </div>
                </article>
              );
            })}
          </div>
          {list.length > shown && (
            <button className="rp-btn" style={{ justifyContent: 'center' }} onClick={() => setShown(shown + TK_PEOPLE_PAGE)}>{t('stats.people.more')}</button>
          )}
        </>
      )}
    </section>
  );
}

function TrackingPanel({ onClose, zIndex = 1000 }) {
  const FB = window.RP_FIREBASE;
  const [data, setData] = React.useState(null); // null = loading, false = failed
  const [range, setRange] = React.useState('today');
  const [failCode, setFailCode] = React.useState('');
  const load = React.useCallback(() => {
    setData(null);
    FB.statsLoad().then(setData, (e) => { setFailCode(String((e && (e.code || e.message)) || '')); setData(false); });
  }, []);
  React.useEffect(load, [load]);
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  let rows = [];
  if (data) {
    const week = new Set([0, 1, 2, 3, 4, 5, 6].map((a) => FB.statsDay(a)));
    const wanted = {
      today: (id) => id === FB.statsDay(0),
      yesterday: (id) => id === FB.statsDay(1),
      week: (id) => week.has(id),
      all: () => true,
    }[range];
    rows = data.days.filter((d) => wanted(d.id));
  }
  const ranges = ['today', 'yesterday', 'week', 'all'];
  const card = { background: 'var(--rp-surface)', border: '1px solid var(--rp-line)', borderRadius: 16, padding: 16, display: 'grid', gap: 14 };
  const tile = { ...card, padding: 12, gap: 2, alignContent: 'start' };
  const srcLabel = (k) => TK_BRANDS[k] || t('stats.src.' + k);
  const devLabel = (k) => TK_DEVICE[k] || t('stats.dev.' + k);

  return (
    <div role="dialog" aria-modal="true" aria-label={t('stats.title')} style={{
      position: 'fixed', inset: 0, zIndex, overflowY: 'auto', background: 'var(--rp-bg)', color: 'var(--rp-text)',
      fontFamily: 'var(--rp-font-ui)', direction: I18N.dir,
    }}>
      <div style={{ maxWidth: 520, margin: '0 auto', padding: 'max(14px, env(safe-area-inset-top)) 18px 40px', display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>{t('stats.title')}</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="rp-btn" onClick={load}>{t('stats.refresh')}</button>
            <button className="rp-btn" onClick={onClose}>{t('stats.close')}</button>
          </div>
        </div>

        <div role="tablist" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
          {ranges.map((r) => (
            <button key={r} role="tab" aria-selected={range === r} className={'rp-btn' + (range === r ? ' rp-btn-primary' : '')}
              style={{ justifyContent: 'center', padding: '8px 4px' }} onClick={() => setRange(r)}>{t('stats.range.' + r)}</button>
          ))}
        </div>

        {data === null && <div style={{ color: 'var(--rp-text-dim)' }}>{t('stats.loading')}</div>}
        {data === false && <div style={{ color: 'var(--rp-text-dim)' }}>{t('stats.failed')} <bdi dir="ltr">{failCode}</bdi></div>}
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
              {[['accounts', data.users.total], ['new7', data.users.new7], ['active7', data.users.active7]].map(([k, n]) => (
                <div key={k} style={tile}>
                  <b style={{ fontSize: 24, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{n}</b>
                  <span style={{ fontSize: 12, color: 'var(--rp-text-dim)' }}>{t('stats.' + k)}</span>
                </div>
              ))}
            </div>
            <TkPeople people={data.people} srcLabel={srcLabel} card={card} />
            {!rows.length && <div style={{ color: 'var(--rp-text-dim)' }}>{t('stats.empty')}</div>}
            {rows.length > 0 && (
              <>
                <section style={card}>
                  <h3 style={{ margin: 0, fontSize: 15 }}>{t('stats.funnel')}</h3>
                  <TkRows steps={TK_FUNNEL} rows={rows} />
                </section>
                <section style={card}>
                  <h3 style={{ margin: 0, fontSize: 15 }}>{t('stats.use')}</h3>
                  <TkRows steps={TK_USE} rows={rows} />
                </section>
                <div style={card}>
                  <TkSplit title={t('stats.sources')} map={tkSum(rows, 's', 'land')} label={srcLabel} />
                  <TkSplit title={t('stats.devices')} map={tkSum(rows, 'd', 'land')} label={devLabel} />
                </div>
              </>
            )}
            <div style={{ fontSize: 12, color: 'var(--rp-text-dim)' }}>{t('stats.note')}</div>
          </>
        )}
      </div>
    </div>
  );
}

window.TrackingPanel = TrackingPanel;
