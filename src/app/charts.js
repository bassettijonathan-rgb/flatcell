// Small canvas charts drawn with the page's theme colours.

export function cssVar(name, el = document.documentElement) {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

export function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = 0; v <= max * 1.0001; v += step) out.push(+v.toPrecision(10));
  return out;
}

export function fmtNum(v) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k';
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(a % 1 === 0 ? 0 : 1);
  if (a >= 1) return v.toFixed(a % 1 === 0 ? 0 : 2).replace(/\.?0+$/, '');
  return v.toPrecision(2);
}

// A generic x/y chart. series: [{ kind: 'line'|'points'|'dashed', color,
// xs, ys, err?, alpha?, hollow? }]
export function drawXY(canvas, { xMax, yMax, xMin = 0, yMin = 0, xLabel, yLabel, series, xFmt = fmtNum, yFmt = fmtNum }) {
  const { ctx, w, h } = setupCanvas(canvas);
  const ink = cssVar('--muted'), grid = cssVar('--line'), font = cssVar('--font-data');
  ctx.clearRect(0, 0, w, h);
  const L = 40, R = 10, T = yLabel ? 24 : 10, B = 32;
  const pw = w - L - R, ph = h - T - B;
  const X = (x) => L + ((x - xMin) / (xMax - xMin)) * pw;
  const Y = (y) => T + ph - ((y - yMin) / (yMax - yMin)) * ph;
  ctx.font = `11px ${font}`;
  ctx.lineWidth = 1;
  // grid + ticks
  ctx.fillStyle = ink;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of niceTicks(yMax - yMin)) {
    const y = Y(yMin + v);
    ctx.strokeStyle = grid;
    ctx.beginPath(); ctx.moveTo(L, Math.round(y) + 0.5); ctx.lineTo(L + pw, Math.round(y) + 0.5); ctx.stroke();
    ctx.fillText(yFmt(yMin + v), L - 6, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const v of niceTicks(xMax - xMin, Math.max(2, Math.floor(pw / 70)))) {
    const x = X(xMin + v);
    ctx.fillText(xFmt(xMin + v), x, T + ph + 6);
  }
  ctx.textAlign = 'right';
  ctx.fillText(xLabel || '', L + pw, T + ph + 19);
  // y label sits above the axis, reading left to right.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(yLabel || '', 4, 2);
  // clip to plot
  ctx.save();
  ctx.beginPath();
  ctx.rect(L, T - 4, pw + 4, ph + 8);
  ctx.clip();
  for (const s of series) {
    ctx.globalAlpha = s.alpha ?? 1;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    if (s.kind === 'line' || s.kind === 'dashed') {
      ctx.lineWidth = s.width || 2;
      ctx.setLineDash(s.kind === 'dashed' ? [5, 4] : []);
      ctx.beginPath();
      for (let k = 0; k < s.xs.length; k++) {
        const x = X(s.xs[k]), y = Y(s.ys[k]);
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (s.endDot && s.xs.length) {
        const k = s.xs.length - 1;
        ctx.beginPath(); ctx.arc(X(s.xs[k]), Y(s.ys[k]), 3, 0, 7); ctx.fill();
      }
    } else if (s.kind === 'area') {
      ctx.beginPath();
      ctx.moveTo(X(s.xs[0]), Y(yMin));
      for (let k = 0; k < s.xs.length; k++) ctx.lineTo(X(s.xs[k]), Y(s.ys[k]));
      ctx.lineTo(X(s.xs[s.xs.length - 1]), Y(yMin));
      ctx.closePath();
      ctx.fill();
    } else if (s.kind === 'hist') {
      // Bars of width s.bw starting at each x.
      for (let k = 0; k < s.xs.length; k++) {
        const x0 = X(s.xs[k]) + 1, x1 = X(s.xs[k] + s.bw) - 1;
        ctx.fillRect(x0, Y(s.ys[k]), Math.max(1, x1 - x0), Y(yMin) - Y(s.ys[k]));
      }
    } else if (s.kind === 'steps') {
      ctx.lineWidth = s.width || 1.6;
      ctx.beginPath();
      for (let k = 0; k < s.xs.length; k++) {
        const x = X(s.xs[k]), y = Y(s.ys[k]);
        if (k === 0) ctx.moveTo(x, y);
        else { ctx.lineTo(x, Y(s.ys[k - 1])); ctx.lineTo(x, y); }
      }
      ctx.stroke();
    } else {
      for (let k = 0; k < s.xs.length; k++) {
        const x = X(s.xs[k]), y = Y(s.ys[k]);
        if (s.err) {
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(x, Y(s.ys[k] - s.err[k])); ctx.lineTo(x, Y(s.ys[k] + s.err[k])); ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(x, y, s.r || 3.5, 0, 7);
        if (s.hollow) { ctx.lineWidth = 2; ctx.stroke(); } else ctx.fill();
      }
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  // axes
  ctx.strokeStyle = ink;
  ctx.beginPath(); ctx.moveTo(L + 0.5, T); ctx.lineTo(L + 0.5, T + ph + 0.5); ctx.lineTo(L + pw, T + ph + 0.5); ctx.stroke();
}

// Horizontal bars, one row each: { label, value, track?, ref?, color, note? }.
// track draws a faint full-capacity bar behind the value, ref a tick mark.
// With log: [min, max] the scale is logarithmic.
export function drawBars(canvas, { rows, max, log, fmt = fmtNum, unit = '' }) {
  const rowH = 20;
  canvas.style.height = `${rows.length * rowH + 30}px`;
  const { ctx, w, h } = setupCanvas(canvas);
  const ink = cssVar('--ink'), muted = cssVar('--muted'), grid = cssVar('--line'), font = cssVar('--font-data');
  ctx.clearRect(0, 0, w, h);
  const L = 74, R = 96, T = 4;
  const pw = Math.max(20, w - L - R);
  const X = log
    ? (v) => L + Math.max(0, Math.min(1, Math.log(Math.max(v, log[0]) / log[0]) / Math.log(log[1] / log[0]))) * pw
    : (v) => L + Math.max(0, Math.min(1, v / max)) * pw;
  ctx.font = `11px ${font}`;
  ctx.textBaseline = 'middle';
  // grid
  ctx.strokeStyle = grid;
  ctx.fillStyle = muted;
  ctx.textAlign = 'center';
  const ticks = log ? decades(log[0], log[1]) : [0, max / 2, max];
  for (const v of ticks) {
    const x = Math.round(X(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + rows.length * rowH); ctx.stroke();
    ctx.fillText(fmt(v), x, T + rows.length * rowH + 10);
  }
  if (unit) { ctx.textAlign = 'right'; ctx.fillText(unit, L + pw, T + rows.length * rowH + 22); }
  rows.forEach((r, k) => {
    const y = T + k * rowH;
    ctx.textAlign = 'right';
    ctx.fillStyle = ink;
    ctx.fillText(r.label, L - 8, y + rowH / 2);
    if (r.track != null) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = r.color;
      ctx.fillRect(L, y + 4, X(r.track) - L, rowH - 8);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = r.color;
    ctx.fillRect(L, y + 4, Math.max(1, X(r.value) - L), rowH - 8);
    if (r.ref != null) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2;
      const x = Math.round(X(r.ref));
      ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x, y + rowH - 2); ctx.stroke();
      ctx.lineWidth = 1;
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = muted;
    ctx.fillText(r.note ?? fmt(r.value), L + pw + 6, y + rowH / 2);
  });
}

function decades(a, b) {
  const out = [];
  for (let e = Math.ceil(Math.log10(a)); e <= Math.floor(Math.log10(b)) + 1e-9; e++) out.push(10 ** e);
  return out;
}
