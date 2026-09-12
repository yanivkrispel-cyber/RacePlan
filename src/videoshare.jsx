// videoshare.jsx — auto-generate a short, vertical, branded flyover clip of
// the route (reusing route3d.jsx's headless `mount3D`) and share it via the
// Web Share API, same pattern as exporting.jsx's sharePdf. Falls back to a
// static branded image on browsers where in-page video recording isn't
// reliable (notably iOS Safari).
//
//   window.RP_VIDEO_SHARE = { supportsVideoCapture, shareRouteClip }
//   window.ShareVideoProgress — small progress modal
const I18N = window.I18N;
const t = (I18N && I18N.t) || ((k) => k);

const RP_VIDEO_SHARE = (() => {
  const OUTPUT_W = 720, OUTPUT_H = 1280;
  const DURATION_MS = 7000;
  const FPS = 30;
  const PREFERRED_MIMES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  // Instagram/TikTok Stories & Reels overlay their own UI in roughly the top
  // and bottom ~13% of a 9:16 frame — keep logo/text out of those bands.
  const SAFE_BAND = Math.round(OUTPUT_H * 0.13);

  function supportsVideoCapture() {
    try {
      return !!(document.createElement('canvas').captureStream
        && window.MediaRecorder
        && PREFERRED_MIMES.some((m) => MediaRecorder.isTypeSupported(m)));
    } catch (e) { return false; }
  }

  function pickMimeType() {
    return PREFERRED_MIMES.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || '';
  }

  function easeInOutCubic(x) {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function loadLogo() {
    return new Promise((resolve) => {
      const src = window.__RACEPLAN_LOGO__;
      if (!src) { resolve(null); return; }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  // Draws the current three.js frame plus the branded overlay onto `ctx`.
  function drawFrame(ctx, threeCanvas, logoImg, raceName, distLabel) {
    ctx.clearRect(0, 0, OUTPUT_W, OUTPUT_H);
    ctx.drawImage(threeCanvas, 0, 0, OUTPUT_W, OUTPUT_H);

    // Bottom scrim for text legibility.
    const grad = ctx.createLinearGradient(0, OUTPUT_H * 0.62, 0, OUTPUT_H);
    grad.addColorStop(0, 'rgba(5,7,13,0)');
    grad.addColorStop(1, 'rgba(5,7,13,.6)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, OUTPUT_H * 0.62, OUTPUT_W, OUTPUT_H * 0.38);

    // Logo chip, top-center, just below the safe band.
    if (logoImg) {
      const logoH = 64, logoW = (logoImg.width / logoImg.height) * logoH;
      const chipPad = 14;
      const chipW = logoW + chipPad * 2, chipH = logoH + chipPad * 2;
      const chipX = (OUTPUT_W - chipW) / 2, chipY = SAFE_BAND + 8;
      ctx.fillStyle = 'rgba(9,11,22,.55)';
      _roundRect(ctx, chipX, chipY, chipW, chipH, 16);
      ctx.fill();
      ctx.drawImage(logoImg, chipX + chipPad, chipY + chipPad, logoW, logoH);
    }

    // Race name + distance, centered, above the bottom safe band.
    ctx.direction = I18N.dir;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const baseY = OUTPUT_H - SAFE_BAND;
    if (raceName) {
      ctx.font = '700 34px var(--rp-font-ui), sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(raceName, OUTPUT_W / 2, baseY - 42);
    }
    if (distLabel) {
      ctx.font = '600 22px var(--rp-font-ui), sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.fillText(distLabel, OUTPUT_W / 2, baseY);
    }
  }

  function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Builds either a video or a fallback still image of the route flyover.
  // Returns { blob, mime, kind: 'video'|'image' }.
  async function buildShareClip(data, opts) {
    opts = opts || {};
    const THREE = await window.ensureThree();

    const container = document.createElement('div');
    container.style.cssText = `position:fixed; left:-99999px; top:0; width:${OUTPUT_W}px; height:${OUTPUT_H}px;`;
    document.body.appendChild(container);

    const stateRef = {};
    let cleanup = null;
    try {
      cleanup = window.mount3D(THREE, container, data, null, stateRef, null);
      stateRef.current.setCameraMode('broadcast');
      stateRef.current.playing = false;

      const threeCanvas = container.querySelector('canvas');
      const logoImg = await loadLogo();
      const distLabel = window.UNITS && data.totalDist ? window.UNITS.fmtDist(data.totalDist) : '';

      const compositeCanvas = document.createElement('canvas');
      compositeCanvas.width = OUTPUT_W; compositeCanvas.height = OUTPUT_H;
      const ctx = compositeCanvas.getContext('2d');

      const attemptVideo = supportsVideoCapture();
      if (attemptVideo) {
        try {
          return await captureVideo();
        } catch (e) {
          if (e && e.message === 'cancelled') throw e;
          console.warn('videoshare: video capture failed, falling back to still image', e);
          // fall through to the still-image path below
        }
      }
      return await captureStill();

      async function captureVideo() {
        const mime = pickMimeType();
        const stream = compositeCanvas.captureStream(FPS);
        const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
        const chunks = [];
        recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
        recorder.start();

        // Paced with setTimeout + a forced synchronous render (stateRef.current.renderNow()),
        // not requestAnimationFrame — rAF (and mount3D's own internal rAF-driven paint
        // loop) can be throttled to a couple of frames a second when the tab/window
        // isn't compositor-visible (e.g. an occluded window, some automation contexts),
        // which would otherwise starve both our pacing and the actual WebGL repaint.
        const msPerFrame = 1000 / FPS;
        const t0 = performance.now();
        for (;;) {
          if (opts.isCancelled && opts.isCancelled()) { recorder.stop(); await stopped; throw new Error('cancelled'); }
          const elapsed = performance.now() - t0;
          const rawFrac = Math.min(1, elapsed / DURATION_MS);
          const frac = easeInOutCubic(rawFrac);
          stateRef.current.seek(frac);
          stateRef.current.renderNow();
          drawFrame(ctx, threeCanvas, logoImg, data.raceName, distLabel);
          if (opts.onProgress) opts.onProgress(rawFrac);
          if (rawFrac >= 1) break;
          const frameIndex = Math.floor(elapsed / msPerFrame);
          const nextDue = t0 + (frameIndex + 1) * msPerFrame;
          await sleep(Math.max(0, nextDue - performance.now()));
        }
        recorder.stop();
        await stopped;
        const blob = new Blob(chunks, { type: mime || 'video/webm' });
        // A properly captured clip is several hundred KB at minimum; anything
        // tiny means the stream never actually received distinct frames.
        if (blob.size < 20000) throw new Error('recording too small (' + blob.size + ' bytes)');
        return { blob, mime: mime || 'video/webm', kind: 'video' };
      }

      async function captureStill() {
        stateRef.current.seek(0.5);
        stateRef.current.renderNow();
        drawFrame(ctx, threeCanvas, logoImg, data.raceName, distLabel);
        if (opts.onProgress) opts.onProgress(1);
        const blob = await new Promise((resolve) => compositeCanvas.toBlob(resolve, 'image/png'));
        if (!blob || !blob.size) throw new Error('empty image');
        return { blob, mime: 'image/png', kind: 'image' };
      }
    } finally {
      if (cleanup) cleanup();
      if (container.parentNode) container.parentNode.removeChild(container);
    }
  }

  // Orchestrates buildShareClip + share-or-download, mirroring exporting.jsx's sharePdf.
  async function shareRouteClip(data, filenameBase, title, opts) {
    let result;
    try {
      result = await Promise.race([
        buildShareClip(data, opts),
        // DURATION_MS is the capture itself; the rest covers a cold three.js
        // CDN fetch + scene build, which can easily take a few seconds.
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), DURATION_MS + 15000)),
      ]);
    } catch (e) {
      if (e && e.message === 'cancelled') return 'cancelled';
      throw e;
    }
    const ext = result.kind === 'video' ? (result.mime.indexOf('mp4') !== -1 ? 'mp4' : 'webm') : 'png';
    const file = new File([result.blob], filenameBase + '.' + ext, { type: result.mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: title || filenameBase });
        return 'shared';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancelled';
        // fall through to download
      }
    }
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'downloaded';
  }

  return { supportsVideoCapture, shareRouteClip };
})();

function ShareVideoProgress({ progress, onCancel }) {
  const pct = Math.round((progress || 0) * 100);
  return ReactDOM.createPortal((
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      direction: I18N.dir, fontFamily: 'var(--rp-font-ui)',
    }}>
      <div style={{
        background: 'var(--rp-surface)', border: '1px solid var(--rp-line)',
        borderRadius: 'var(--rp-r-14)', width: '100%', maxWidth: 320, padding: 20,
        color: 'var(--rp-text)', textAlign: 'center',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{t('planner.generatingVideo')}</div>
        <div style={{ height: 6, borderRadius: 3, background: 'var(--rp-line)', overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ height: '100%', width: pct + '%', background: 'var(--rp-accent, #F5C24A)', transition: 'width .15s linear' }} />
        </div>
        <button onClick={onCancel} style={{
          background: 'none', border: '1px solid var(--rp-line)', borderRadius: 10,
          padding: '8px 16px', color: 'var(--rp-text-dim)', cursor: 'pointer', fontSize: 13,
        }}>{t('common.cancel')}</button>
      </div>
    </div>
  ), document.body);
}

window.RP_VIDEO_SHARE = RP_VIDEO_SHARE;
window.ShareVideoProgress = ShareVideoProgress;
