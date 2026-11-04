/* IRCTC OneTrip — one-page itinerary snapshot (v1.2). SIMULATED.
 *   #/itinerary-print[?print=1]   print-optimised single A4 page (Download PDF = window.print → "Save as PDF")
 *   OT.itinerary.png()            -> PNG data URL drawn on a <canvas> by hand (no libraries), downloaded / shared
 *   OT.itinerary.whatsApp()       -> opens https://wa.me/91XXXXXXXXXX?text=… directly with the signed-in user's number (asks once if none)
 *   OT.itinerary.email()          -> consent + confirm, mailto: link + "Sent to … (simulated)" + admin notification log
 * The code drawn on the page is a simulated QR-style pattern (not scannable). A production system would send through
 * the WhatsApp Business API and a transactional mail service; this prototype says so on screen.
 */
(function () {
  'use strict';
  var OT = window.OT;
  var D = function () { return OT.data.travel; };
  function t(k, fb, v) { return OT.t(k, fb, v); }
  function L() { return OT.i18n.lang(); }
  function keep(v) { return OT.lang.keep(v); }
  function hash(s) { return OT.data.rail ? OT.data.rail.hash(String(s)) : 1; }
  function tm(iso) { return iso ? String(iso).slice(11, 16) : ''; }
  var MAX_ROWS = 12;

  /* ---------------- model ---------------- */
  /** v1.2.2: a train kept in the trip unpaid reads "Not paid yet" (no PNR) instead of a raw status code. */
  function stLabel(s) { return s === 'HELD' ? t('hold.badge', 'Not paid yet') : s; }
  function contactFor(name) { var h = hash(name || 'x'); return '+91 9' + (h % 9) + 'XXX XX' + (100 + h % 900) + ' (sample)'; }
  function model(j) {
    j = j || OT.store.get('journey');
    if (!j) return null;
    var u = OT.store.get('user') || {};
    var rt = OT.agents.liveReturn ? OT.agents.liveReturn(j) : null;
    var bookings = (OT.store.get('bookings', []) || []).filter(function (b) { return b.journeyId === j.id || (j.pnr && b.type === 'train' && b.pnr === j.pnr) || (rt && b.type === 'train' && b.pnr === rt.pnr); });
    var paid = bookings.filter(function (b) { return b.status === 'confirmed'; });
    var it = OT.agents.itinerary(j), tr = j.train;
    var rows = it.events.map(function (e) {
      var i = e.item, x = i && D().get(i.refId);
      var isTrain = e.kind === 'dep' || e.kind === 'arr' || e.kind === 'rdep' || e.kind === 'rarr';
      if (e.meter) return { date: e.when ? OT.fmtDate(e.when) : '', time: tm(e.when), title: e.title, sub: OT.meter.note(e.meter), ref: OT.meter.approx(e.meter), contact: '',
        status: t('tx.meterBadge', 'Pay on meter'), icon: 'auto', train: false, meter: true };
      return {
        date: e.when ? OT.fmtDate(e.when) : '', time: tm(e.when), title: e.title,
        sub: x ? (x.type === 'hotel' ? x.area : x.meet || x.area || x.provider || '') : (e.sub || ''),
        ref: i && i.bookingRef ? i.bookingRef : (isTrain && (e.kind === 'dep' || e.kind === 'arr') && j.pnr ? 'PNR ' + j.pnr : e.kind === 'rdep' && j.returnTrain && j.returnTrain.pnr ? 'PNR ' + j.returnTrain.pnr : ''),
        contact: x && !x.mode ? contactFor(x.provider) : '', status: i ? (i.status === 'confirmed' ? t('status.confirmed', 'Confirmed') : t('status.selected', 'Planned')) : (isTrain ? stLabel((e.kind === 'rdep' || e.kind === 'rarr') && rt ? rt.status || 'CNF' : (tr && tr.status) || 'CNF') : ''),
        icon: isTrain ? 'train' : e.icon || 'info', train: isTrain
      };
    });
    var city = j.scenario ? D().stationName(j.scenario, L()) : '';
    var title = tr ? D().stationName(tr.from, L()) + ' → ' + D().stationName(tr.to, L()) : (j.title || t('trip.stayIn', 'Stay in {city}', { city: city }));
    var dates = tr ? OT.fmtDate(tr.date) + (rt ? ' – ' + OT.fmtDate(rt.date) : '') : (j.start ? OT.fmtDate(j.start) + (j.end && j.end !== j.start ? ' – ' + OT.fmtDate(j.end) : '') : '');
    var total = paid.reduce(function (s, b) { return s + (b.amount || 0); }, 0);
    var refs = paid.map(function (b) { return b.type === 'train' ? 'PNR ' + b.pnr : b.ref; });
    if (j.pnr && !refs.some(function (r) { return r.indexOf(j.pnr) >= 0; })) refs.unshift('PNR ' + j.pnr);
    if (rt && rt.pnr && !refs.some(function (r) { return r.indexOf(rt.pnr) >= 0; })) refs.push('PNR ' + rt.pnr);
    var meters = OT.meter ? OT.meter.list(j) : [];
    return {
      id: j.id, name: u.name || t('it.traveller', 'Traveller'), phone: u.phone || '', email: u.email || '', title: title, dates: dates, city: city,
      pax: j.passengers || 1, train: tr && tr.status !== 'PLANNED' ? { no: tr.no, name: tr.name, from: tr.from, to: tr.to, dep: tr.dep, arr: tr.arr, date: tr.date, cls: tr.cls, coach: tr.coach, seats: (tr.seats || []).join(', '), status: stLabel(tr.status), pnr: j.pnr } : null,
      ret: rt ? { no: rt.no, name: rt.name, from: rt.from, to: rt.to, dep: rt.dep, arr: rt.arr, date: rt.date, cls: rt.cls, status: stLabel(rt.status || 'CNF'), pnr: rt.pnr } : null,
      meterTotal: meters.reduce(function (s, r) { return s + (r.approx || 0); }, 0), meterN: meters.length,
      rows: rows, more: Math.max(0, rows.length - MAX_ROWS), total: total, refs: refs, generatedAt: new Date(),
      code: 'ONETRIP|' + j.id + '|' + refs.join(',')
    };
  }

  /* ---------------- simulated QR-style code (deterministic, NOT scannable) ---------------- */
  function qr(text, n) {
    n = n || 25;
    var m = [], seed = hash(text) || 1, i, r, c;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    for (r = 0; r < n; r++) { m.push([]); for (c = 0; c < n; c++) m[r].push(rnd() > 0.52); }
    function finder(r0, c0) {
      for (var a = -1; a <= 7; a++) for (var b = -1; b <= 7; b++) {
        var rr = r0 + a, cc = c0 + b; if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        var ring = Math.max(Math.abs(a - 3), Math.abs(b - 3));
        m[rr][cc] = a >= 0 && a <= 6 && b >= 0 && b <= 6 && (ring === 3 || ring <= 1);
      }
    }
    finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
    for (i = 8; i < n - 8; i++) { m[6][i] = i % 2 === 0; m[i][6] = i % 2 === 0; }
    return m;
  }
  function qrSVG(text, px) {
    var m = qr(text), n = m.length, d = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (m[r][c]) d += 'M' + c + ' ' + r + 'h1v1h-1z';
    return '<svg class="it-qr" viewBox="-1 -1 ' + (n + 2) + ' ' + (n + 2) + '" width="' + (px || 96) + '" height="' + (px || 96) + '" role="img" aria-label="' + OT.esc(t('it.qrAria', 'Simulated booking code (not scannable)')) + '"><rect x="-1" y="-1" width="' + (n + 2) + '" height="' + (n + 2) + '" fill="#fff"/><path d="' + d + '" fill="#0B2C5F"/></svg>';
  }

  /* ---------------- printable sheet ---------------- */
  function sheetHTML(m) {
    var rows = m.rows.slice(0, MAX_ROWS);
    return '<article class="itin-sheet" data-tour="itin-sheet" aria-label="' + OT.esc(t('it.yours', 'Your one-page itinerary')) + '">' +
      '<div class="it-wm" aria-hidden="true">SIMULATED</div>' +
      '<header class="it-head"><div class="it-brand"><span class="brand-mark">' + OT.icon('train', 18) + '</span><div><strong>IRCTC OneTrip</strong><span>' + OT.esc(t('it.sheetTag', 'One-page itinerary · academic prototype')) + '</span></div></div>' +
      '<div class="it-code">' + qrSVG(m.code, 84) + '<span class="it-code-l">' + OT.esc(t('it.qrNote', 'Simulated code · not scannable')) + '</span></div></header>' +
      '<section class="it-who"><div><span class="it-k">' + OT.esc(t('it.traveller', 'Traveller')) + '</span><strong>' + OT.esc(m.name) + '</strong>' + (m.pax > 1 ? ' <span class="it-muted">+' + (m.pax - 1) + '</span>' : '') + '</div>' +
      '<div><span class="it-k">' + OT.esc(t('it.trip', 'Trip')) + '</span><strong>' + OT.esc(m.title) + '</strong></div>' +
      '<div><span class="it-k">' + OT.esc(t('trip.date', 'Date')) + '</span><strong>' + keep(m.dates || '—') + '</strong></div>' +
      '<div><span class="it-k">' + OT.esc(t('it.total', 'Total paid')) + '</span><strong>' + keep(OT.inr(m.total)) + '</strong></div></section>' +
      (m.train ? '<section class="it-train"><span class="it-k">' + OT.icon('train', 13) + ' PNR</span><strong class="it-pnr">' + keep(m.train.pnr || '—') + '</strong>' +
        '<span>' + keep(m.train.no) + ' ' + OT.esc(m.train.name) + '</span><span>' + keep(m.train.from) + ' ' + keep(m.train.dep) + ' → ' + keep(m.train.to) + ' ' + keep(m.train.arr) + '</span>' +
        '<span>' + keep(m.train.cls) + (m.train.seats ? ' · ' + keep(m.train.coach) + ' / ' + keep(m.train.seats) : '') + ' · ' + keep(m.train.status) + '</span></section>' : '') +
      (m.ret ? '<section class="it-train it-ret" data-it-return><span class="it-k">' + OT.icon('refresh', 13) + ' ' + OT.esc(t('ret.retLbl', 'Return')) + ' PNR</span><strong class="it-pnr">' + keep(m.ret.pnr || '—') + '</strong>' +
        '<span>' + keep(m.ret.no) + ' ' + OT.esc(m.ret.name) + '</span><span>' + keep(m.ret.from) + ' ' + keep(m.ret.dep) + ' → ' + keep(m.ret.to) + ' ' + keep(m.ret.arr) + '</span>' +
        '<span>' + keep(OT.fmtDate(m.ret.date)) + ' · ' + keep(m.ret.cls) + ' · ' + keep(m.ret.status) + '</span></section>' : '') +
      '<ol class="it-tl">' + rows.map(function (r) {
        return '<li class="' + (r.train ? 'is-train' : '') + '"><span class="it-when"><b>' + keep(r.time || '—') + '</b><small>' + keep(r.date) + '</small></span><span class="it-dot">' + OT.icon(r.icon, 11) + '</span>' +
          '<span class="it-what"><b>' + OT.lang.highlight(r.title) + '</b>' + (r.sub ? '<small>' + OT.lang.highlight(r.sub) + '</small>' : '') + (r.contact ? '<small>' + OT.icon('headset', 10) + ' ' + OT.esc(r.contact) + '</small>' : '') + '</span>' +
          '<span class="it-ref">' + (r.ref ? keep(r.ref) : '') + (r.status ? '<small>' + OT.esc(r.status) + '</small>' : '') + '</span></li>';
      }).join('') + '</ol>' +
      (m.more ? '<p class="it-more">' + OT.esc(t('it.more', '+{n} more items in My Journey', { n: m.more })) + '</p>' : '') +
      (m.meterN ? '<p class="it-more it-meter">' + OT.icon('auto', 11) + ' ' + OT.esc(t('it.meterNote', 'Autos / e-rickshaws: about {p}, paid to the driver on the meter. Not booked and not included in the total.', { p: OT.inr(m.meterTotal) })) + '</p>' : '') +
      (!m.rows.length ? '<p class="it-more">' + OT.esc(t('it.empty', 'No items yet. Add a hotel, transport, food or sights in My Journey.')) + '</p>' : '') +
      '<footer class="it-foot"><div><span class="it-k">' + OT.esc(t('it.refs', 'Booking refs')) + '</span><span>' + (m.refs.length ? m.refs.map(function (r) { return keep(r); }).join(' · ') : '—') + '</span></div>' +
      '<div><span class="it-k">' + OT.esc(t('it.help', 'Help')) + '</span><span>' + OT.esc(t('it.helpText', 'OneTrip support in your language: in-app assistant → “Talk to a human” (sample SLA 2 h)')) + '</span></div>' +
      '<p class="it-disc">' + OT.esc(t('it.disc', 'SIMULATED itinerary from an academic prototype. Not a ticket, not valid for travel. Final train booking happens on IRCTC.')) + ' · ' + OT.esc(OT.stamp(m.generatedAt)) + '</p></footer></article>';
  }

  function toolbarHTML() {
    return '<div class="it-toolbar no-print" data-tour="itin-toolbar">' +
      '<a class="btn btn-ghost btn-sm" href="#/journey">' + OT.icon('arrowLeft', 15) + OT.esc(t('co.back', 'Back to My Journey')) + '</a>' +
      '<div class="row-wrap"><button type="button" class="btn btn-primary btn-sm" data-it="print">' + OT.icon('printer', 15) + OT.esc(t('it.pdf', 'Download PDF')) + '</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-it="png">' + OT.icon('image', 15) + OT.esc(t('it.png', 'Save PNG')) + '</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-it="wa">' + OT.icon('whatsapp', 15) + OT.esc(t('it.wa', 'WhatsApp')) + '</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-it="mail">' + OT.icon('mail', 15) + OT.esc(t('it.mail', 'Email')) + '</button></div>' + waNoteHTML() +
      '<p class="xs muted it-pdfhint">' + OT.esc(t('it.pdfHint', 'Download PDF opens your browser’s print dialog: choose “Save as PDF”. The page is sized for one A4 sheet.')) + '</p></div>';
  }

  function render(el, params) {
    var q = (params && params.query) || {};
    var m = model();
    if (!m) {
      el.innerHTML = '<div class="container page"><div class="card empty-state">' + OT.icon('layers', 34) + '<h1 class="h2">' + OT.esc(t('it.noTrip', 'No trip yet')) + '</h1><p class="muted">' + OT.esc(t('journey.empty', 'Plan a trip around your train: tell us where you are going, or load the sample trip to see how it works.')) + '</p><a class="btn btn-primary" href="#/home">' + OT.esc(t('nav.plan', 'Plan trip')) + '</a></div></div>';
      return;
    }
    el.innerHTML = '<div class="container page itin-page">' + toolbarHTML() + '<div class="itin-wrap">' + sheetHTML(m) + '</div></div>';
    OT.$$('[data-it]', el).forEach(function (b) { b.addEventListener('click', function () { action(b.getAttribute('data-it')); }); });
    if (q.print === '1') setTimeout(function () { if (OT.router.current() && OT.router.current().name === 'itinerary-print') window.print(); }, 450);
  }

  /* ---------------- PNG on a canvas (hand-drawn, no libraries) ---------------- */
  var FONT = "Mukta, 'Nirmala UI', 'Noto Sans', 'Noto Sans Devanagari', system-ui, sans-serif";
  function wrap(ctx, text, maxW) {
    var words = String(text || '').split(/\s+/), lines = [], line = '';
    words.forEach(function (w) { var test = line ? line + ' ' + w : w; if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test; });
    if (line) lines.push(line);
    return lines;
  }
  function png(scale) {
    var m = model(); if (!m) return '';
    var W = 1240, H = 1754, s = scale || 1;
    var cv = document.createElement('canvas'); cv.width = W * s; cv.height = H * s;
    var ctx = cv.getContext('2d'); if (!ctx) return '';
    ctx.scale(s, s);
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
    // watermark
    ctx.save(); ctx.translate(W / 2, H / 2 + 80); ctx.rotate(-Math.PI / 6); ctx.fillStyle = 'rgba(107,79,187,0.07)'; ctx.font = '800 190px ' + FONT; ctx.textAlign = 'center'; ctx.fillText('SIMULATED', 0, 0); ctx.restore();
    // header band
    ctx.fillStyle = '#0B2C5F'; ctx.fillRect(0, 0, W, 170); ctx.fillStyle = '#F07F1A'; ctx.fillRect(0, 170, W, 8);
    ctx.fillStyle = '#FFFFFF'; ctx.font = '700 46px ' + FONT; ctx.textAlign = 'left'; ctx.fillText('IRCTC OneTrip', 70, 92);
    ctx.font = '500 26px ' + FONT; ctx.fillStyle = '#CFDDF5'; ctx.fillText(t('it.sheetTag', 'One-page itinerary · academic prototype'), 70, 134);
    // QR
    var q = qr(m.code), n = q.length, qs = 190, cell = qs / (n + 2), qx = W - 70 - qs, qy = 220;
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(qx, qy, qs, qs); ctx.strokeStyle = '#DCE3EE'; ctx.lineWidth = 2; ctx.strokeRect(qx, qy, qs, qs);
    ctx.fillStyle = '#0B2C5F';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q[r][c]) ctx.fillRect(qx + (c + 1) * cell, qy + (r + 1) * cell, Math.ceil(cell), Math.ceil(cell));
    ctx.fillStyle = '#5A6B82'; ctx.font = '500 18px ' + FONT; ctx.textAlign = 'center'; ctx.fillText(t('it.qrNote', 'Simulated code · not scannable'), qx + qs / 2, qy + qs + 26); ctx.textAlign = 'left';
    // who / trip
    var y = 250;
    function kv(k, v, x, yy, w) {
      ctx.fillStyle = '#5A6B82'; ctx.font = '600 20px ' + FONT; ctx.fillText(String(k).toUpperCase(), x, yy);
      ctx.fillStyle = '#1E2A3B'; ctx.font = '700 32px ' + FONT; wrap(ctx, v, w || 460).slice(0, 2).forEach(function (l, i) { ctx.fillText(l, x, yy + 40 + i * 38); });
    }
    kv(t('it.traveller', 'Traveller'), m.name + (m.pax > 1 ? '  +' + (m.pax - 1) : ''), 70, y, 420);
    kv(t('it.trip', 'Trip'), m.title, 520, y, 440);
    y += 130;
    kv(t('trip.date', 'Date'), m.dates || '—', 70, y, 420);
    kv(t('it.total', 'Total paid'), OT.inr(m.total), 520, y, 440);
    y += 120;
    if (m.train) {
      ctx.fillStyle = '#EEF4FD'; ctx.fillRect(70, y, W - 140, 120);
      ctx.fillStyle = '#0B2C5F'; ctx.font = '700 34px ' + FONT; ctx.fillText('PNR ' + (m.train.pnr || '—'), 96, y + 50);
      ctx.font = '600 26px ' + FONT; ctx.fillStyle = '#1E2A3B';
      ctx.fillText(m.train.no + ' ' + m.train.name + ' · ' + m.train.cls + ' · ' + m.train.status, 96, y + 92);
      ctx.textAlign = 'right'; ctx.fillText(m.train.from + ' ' + m.train.dep + '  →  ' + m.train.to + ' ' + m.train.arr, W - 96, y + 50); ctx.textAlign = 'left';
      y += m.ret ? 132 : 160;
    }
    if (m.ret) {
      ctx.fillStyle = '#FFF3E6'; ctx.fillRect(70, y, W - 140, 100);
      ctx.fillStyle = '#B85A07'; ctx.font = '700 30px ' + FONT; ctx.fillText(t('ret.retLbl', 'Return') + ' · PNR ' + (m.ret.pnr || '—'), 96, y + 42);
      ctx.font = '600 24px ' + FONT; ctx.fillStyle = '#1E2A3B'; ctx.fillText(m.ret.no + ' ' + m.ret.name + ' · ' + m.ret.cls + ' · ' + m.ret.status, 96, y + 80);
      ctx.textAlign = 'right'; ctx.fillText(OT.fmtDate(m.ret.date) + '  ' + m.ret.from + ' ' + m.ret.dep + '  →  ' + m.ret.to + ' ' + m.ret.arr, W - 96, y + 42); ctx.textAlign = 'left';
      y += 130;
    }
    // timeline
    ctx.fillStyle = '#0B2C5F'; ctx.font = '700 30px ' + FONT; ctx.fillText(t('tl.title', 'Journey timeline'), 70, y); y += 30;
    var rows = m.rows.slice(0, MAX_ROWS), rowH = m.ret ? 70 : 78;
    rows.forEach(function (rw, i) {
      var ry = y + i * rowH + 20;
      ctx.fillStyle = '#1E2A3B'; ctx.font = '700 28px ' + FONT; ctx.fillText(rw.time || '—', 70, ry + 28);
      ctx.fillStyle = '#5A6B82'; ctx.font = '500 20px ' + FONT; ctx.fillText(rw.date || '', 70, ry + 54);
      if (i < rows.length - 1) { ctx.strokeStyle = rw.train ? '#0B2C5F' : '#F07F1A'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(250, ry + 24); ctx.lineTo(250, ry + rowH + 24); ctx.stroke(); }
      ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = rw.train ? '#0B2C5F' : '#F07F1A'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(250, ry + 22, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1E2A3B'; ctx.font = '700 26px ' + FONT; ctx.fillText(wrap(ctx, rw.title, 640)[0] || '', 284, ry + 28);
      ctx.fillStyle = '#5A6B82'; ctx.font = '500 20px ' + FONT; ctx.fillText(wrap(ctx, [rw.sub, rw.contact].filter(Boolean).join(' · '), 640)[0] || '', 284, ry + 56);
      ctx.textAlign = 'right'; ctx.fillStyle = '#0B2C5F'; ctx.font = '700 22px ' + FONT; ctx.fillText(rw.ref || '', W - 70, ry + 28);
      ctx.fillStyle = '#12805C'; ctx.font = '600 18px ' + FONT; ctx.fillText(rw.status || '', W - 70, ry + 54); ctx.textAlign = 'left';
    });
    y += rows.length * rowH + 40;
    if (m.more) { ctx.fillStyle = '#5A6B82'; ctx.font = '600 22px ' + FONT; ctx.fillText(t('it.more', '+{n} more items in My Journey', { n: m.more }), 284, y); y += 40; }
    // footer
    var fy = H - 210;
    ctx.strokeStyle = '#DCE3EE'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(70, fy); ctx.lineTo(W - 70, fy); ctx.stroke();
    ctx.fillStyle = '#5A6B82'; ctx.font = '600 20px ' + FONT; ctx.fillText(t('it.refs', 'Booking refs').toUpperCase(), 70, fy + 42);
    ctx.fillStyle = '#1E2A3B'; ctx.font = '600 24px ' + FONT; wrap(ctx, m.refs.join(' · ') || '—', W - 140).slice(0, 2).forEach(function (l, i) { ctx.fillText(l, 70, fy + 78 + i * 32); });
    ctx.fillStyle = '#C2382F'; ctx.font = '600 20px ' + FONT; wrap(ctx, t('it.disc', 'SIMULATED itinerary from an academic prototype. Not a ticket, not valid for travel. Final train booking happens on IRCTC.'), W - 140).slice(0, 2).forEach(function (l, i) { ctx.fillText(l, 70, fy + 150 + i * 28); });
    try { return cv.toDataURL('image/png'); } catch (e) { return ''; }
  }
  function fileName(ext) { var m = model(); return 'OneTrip-itinerary-' + ((m && m.train && m.train.pnr) || (m && m.id) || 'trip') + '.' + ext; }
  function download(url, name) {
    var a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 0);
  }
  function savePng(silent) {
    var url = png(1);
    if (!url) { OT.toast(t('it.pngFail', 'Could not draw the image in this browser.'), 'error'); return ''; }
    OT.state.lastPng = url.length;
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (coarse && navigator.canShare && window.fetch && window.File) {
      try {
        var bin = atob(url.split(',')[1]), arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        var file = new File([arr], fileName('png'), { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: 'IRCTC OneTrip itinerary' }).catch(function () { download(url, fileName('png')); }); return url; }
      } catch (e) { /* fall back to download */ }
    }
    download(url, fileName('png'));
    if (!silent) OT.toast(t('it.pngSaved', 'Itinerary image saved ({name}).', { name: fileName('png') }), 'success');
    return url;
  }

  /* ---------------- WhatsApp / email (consent + confirm) ---------------- */
  function summaryText(m) {
    m = m || model(); if (!m) return '';
    var out = ['IRCTC OneTrip itinerary (simulated)', m.name + ' · ' + m.title + (m.dates ? ' · ' + m.dates : '')];
    if (m.train) out.push('PNR ' + (m.train.pnr || '—') + ' · ' + m.train.no + ' ' + m.train.name + ' ' + m.train.dep + '→' + m.train.arr);
    if (m.ret) out.push('Return PNR ' + (m.ret.pnr || '—') + ' · ' + m.ret.no + ' ' + m.ret.name + ' · ' + OT.fmtDate(m.ret.date) + ' ' + m.ret.dep + '→' + m.ret.arr);
    m.rows.slice(0, 8).forEach(function (r) { out.push('• ' + [r.date, r.time].filter(Boolean).join(' ') + ' ' + r.title + (r.ref ? ' (' + r.ref + ')' : '')); });
    if (m.rows.length > 8) out.push('+' + (m.rows.length - 8) + ' more');
    out.push('Total paid: ' + OT.inr(m.total));
    if (m.meterN) out.push('Autos on meter (pay the driver, not booked): about ' + OT.inr(m.meterTotal));
    out.push('Simulated academic prototype. Not a ticket.');
    return out.join('\n');
  }
  function waUrl(digits, text) { return 'https://wa.me/91' + String(digits).replace(/\D/g, '').slice(-10) + '?text=' + encodeURIComponent(text); }
  function mailtoUrl(email, subject, body) { return 'mailto:' + encodeURIComponent(email).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body); }
  /* The signed-in user's own mobile (profile phone, a number saved earlier, or the demo persona's dummy number). '' if none. */
  function clean10(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (d.length === 12 && d.slice(0, 2) === '91') d = d.slice(2); else if (d.length === 11 && d[0] === '0') d = d.slice(1);
    return /^[6-9]\d{9}$/.test(d) ? d : '';
  }
  function userMobile() {
    var u = OT.store.get('user') || {}, p = u.personaId && OT.data.personas && OT.data.personas.get(u.personaId);
    return clean10(u.mobile) || clean10(u.phone) || clean10(p && p.waSample) || clean10(OT.store.get('waMobile'));
  }
  function sampleMobile() { return userMobile(); }
  function fmt(d) { d = String(d); return '+91 ' + d.slice(0, 5) + ' ' + d.slice(5); }
  function rememberMobile(d) {
    var u = OT.store.get('user');
    if (u) OT.store.set('user', Object.assign({}, u, { mobile: d })); else OT.store.set('waMobile', d);
  }
  function mask(d) { d = String(d); return '+91 ' + d.slice(0, 2) + 'XXX XX' + d.slice(-3); }
  function maskMail(e) { var p = String(e).split('@'); return p[0].slice(0, 2) + '…@' + (p[1] || ''); }
  function log(entry) {
    OT.store.update('notifications', function (l) { return (l || []).concat([Object.assign({ id: OT.uid('NTF'), at: new Date().toISOString(), status: 'sent (simulated)', lang: L() }, entry)]).slice(-50); });
  }

  function askContact(kind) {
    var u = OT.store.get('user') || {};
    var wa = kind === 'wa';
    return new Promise(function (resolve) {
      var done = false;
      OT.modal({
        title: wa ? t('it.waTitle', 'Send itinerary to WhatsApp') : t('it.mailTitle', 'Send itinerary by email'),
        body: '<div class="share-form">' +
          (wa ? '<div class="field"><label for="sh-to">' + OT.esc(t('it.mobile', 'Mobile number (India)')) + '</label><div class="rupee-input"><span>+91</span><input id="sh-to" class="input mono-num" inputmode="numeric" maxlength="10" autocomplete="tel-national" value="' + OT.esc(sampleMobile()) + '"></div>' +
            (sampleMobile() ? '<p class="xs muted">' + OT.esc(t('it.sampleNum', 'Prefilled from the demo persona (sample number). Replace it with yours.')) + '</p>' : '') + '</div>'
            : '<div class="field"><label for="sh-to">' + OT.esc(t('it.email', 'Email address')) + '</label><input id="sh-to" class="input" type="email" autocomplete="email" value="' + OT.esc(u.email || '') + '"></div>') +
          '<label class="check consent mt8"><input type="checkbox" id="sh-consent"> <span class="small">' + OT.esc(wa ? t('it.consentWa', 'I consent to OneTrip sharing this itinerary (names, times, booking refs) to this WhatsApp number, for this message only (DPDP Act).') : t('it.consentMail', 'I consent to OneTrip sending this itinerary (names, times, booking refs) to this email address, for this message only (DPDP Act).')) + '</span></label>' +
          '<p class="small form-error hidden" id="sh-err" role="alert"></p>' +
          '<p class="xs muted">' + OT.icon('info', 12) + ' ' + OT.esc(wa ? t('it.waHonest', 'Prototype: we open WhatsApp (wa.me) with the summary and download the PNG for you to attach. A production system would send it through the WhatsApp Business API.') : t('it.mailHonest', 'Prototype: nothing is sent from a server. We open your email app with the summary (mailto) and log a simulated delivery.')) + '</p></div>',
        onClose: function () { if (!done) { done = true; resolve(null); } },
        actions: [
          { label: t('common.cancel', 'Cancel'), kind: 'ghost', onClick: function (c) { done = true; resolve(null); c(); } },
          { label: t('it.continue', 'Continue'), kind: 'primary', onClick: function (c) {
            var v = document.getElementById('sh-to').value.trim(), ok = document.getElementById('sh-consent').checked, err = document.getElementById('sh-err');
            var bad = wa ? !/^[6-9]\d{9}$/.test(v.replace(/\D/g, '')) : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
            var msg = bad ? (wa ? t('it.badMobile', 'Enter a 10-digit Indian mobile number.') : t('it.badEmail', 'Enter a valid email address.')) : !ok ? t('it.needConsent', 'Please tick the consent box to continue.') : '';
            if (msg) { err.textContent = msg; err.classList.remove('hidden'); return; }
            done = true; c(); resolve(wa ? v.replace(/\D/g, '') : v);
          } }
        ]
      });
    });
  }

  /* Opens WhatsApp straight away (wa.me deep link, like Canva's "Share to WhatsApp"): the chat with this number opens
   * with the itinerary text already typed; the traveller only taps Send. Called synchronously from the click so the
   * browser treats it as a user action and does not block the new tab. */
  function openWa(num, m) {
    var url = waUrl(num, summaryText(m));
    OT.state.lastShare = { channel: 'whatsapp', url: url, to: num };
    try { window.open(url, '_blank', 'noopener'); } catch (e) { location.href = url; }
    log({ channel: 'whatsapp', to: mask(num), journeyId: m.id, refs: m.refs, items: m.rows.length });
    OT.toast(t('it.waOpened', 'Opening WhatsApp for {to} with your itinerary. Tap Send there.', { to: fmt(num) }), 'success');
    OT.emit('itinerary:wa', { url: url, to: num });
    return url;
  }
  function askWa(m) {
    var done = false;
    OT.modal({
      title: t('it.waTitle', 'Send itinerary to WhatsApp'),
      body: '<div class="wa-ask">' +
        '<div class="wa-ask-head"><span class="wa-ask-ic" aria-hidden="true">' + OT.icon('whatsapp', 22) + '</span><div><strong>' + OT.esc(t('it.waWhere', 'Which WhatsApp number?')) + '</strong>' +
        '<p class="xs muted">' + OT.esc(t('it.waWhereSub', 'WhatsApp opens with your itinerary already typed. You just tap Send.')) + '</p></div></div>' +
        '<label class="wa-lbl" for="sh-to">' + OT.esc(t('it.mobile', 'Mobile number (India)')) + '</label>' +
        '<div class="wa-phone"><span class="wa-cc">+91</span><input id="sh-to" class="mono-num" type="tel" inputmode="numeric" maxlength="16" autocomplete="tel-national" placeholder="98765 43210"></div>' +
        '<label class="check wa-remember"><input type="checkbox" id="sh-remember" checked> <span class="small">' + OT.esc(t('it.waRemember', 'Save this number to my profile, so next time WhatsApp opens directly')) + '</span></label>' +
        '<p class="small form-error hidden" id="sh-err" role="alert"></p>' +
        '<p class="xs muted wa-fine">' + OT.icon('info', 12) + ' ' + OT.esc(t('it.waFine', 'By continuing you agree to share this itinerary with this number (DPDP Act). Prototype: in production OneTrip would send it via the WhatsApp Business API.')) + '</p></div>',
      onOpen: function (box) {
        var inp = (box && box.querySelector('#sh-to')) || document.getElementById('sh-to'); if (!inp) return;
        setTimeout(function () { inp.focus(); }, 30);
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var root = inp.closest('.modal') || document, b = OT.$$('.modal-foot .btn', root); if (b.length) b[b.length - 1].click(); } });
      },
      onClose: function () { done = true; },
      actions: [
        { label: t('common.cancel', 'Cancel'), kind: 'ghost', onClick: function (c) { done = true; c(); } },
        { label: t('it.waOk', 'Open WhatsApp'), kind: 'primary', onClick: function (c) {
          var v = clean10(document.getElementById('sh-to').value), err = document.getElementById('sh-err');
          if (!v) { err.textContent = t('it.badMobile', 'Enter a 10-digit Indian mobile number.'); err.classList.remove('hidden'); return; }
          if (document.getElementById('sh-remember').checked) rememberMobile(v);
          done = true; c(); openWa(v, m); refreshWaNotes();
        } }
      ]
    });
    return Promise.resolve(null);
  }
  /** WhatsApp: opens directly with the signed-in user's number; asks only when no number is known (or to change it). */
  function whatsApp(opts) {
    var m = model(); if (!m) return Promise.resolve(null);
    var num = opts && opts.ask ? '' : userMobile();
    if (num) return Promise.resolve(openWa(num, m));
    return askWa(m);
  }
  /* Small line under the share buttons: "WhatsApp to +91 75898 02655 · Change". */
  function waNoteHTML() {
    var n = userMobile();
    return '<p class="xs muted wa-to" data-wa-note>' + (n
      ? OT.icon('whatsapp', 12) + ' ' + OT.esc(t('it.waTo', 'WhatsApp opens for')) + ' <bdi class="keep">' + OT.esc(fmt(n)) + '</bdi> · <button type="button" class="btn-link" data-wa-change>' + OT.esc(t('it.waChange', 'Change number')) + '</button>'
      : '') + '</p>';
  }
  function refreshWaNotes() { OT.$$('[data-wa-note]').forEach(function (el) { el.outerHTML = waNoteHTML(); }); }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-wa-change]');
    if (b) { e.preventDefault(); whatsApp({ ask: true }); }
  });
  OT.on('store:user', function () { refreshWaNotes(); });

  function email() {
    var m = model(); if (!m) return Promise.resolve(null);
    return askContact('mail').then(function (addr) {
      if (!addr) return null;
      var subject = 'IRCTC OneTrip itinerary: ' + m.title + (m.dates ? ' (' + m.dates + ')' : '');
      var url = mailtoUrl(addr, subject, summaryText(m) + '\n\nTip: use “Download PDF” in OneTrip to attach the one-page itinerary.');
      return OT.confirmAction({
        title: t('it.mailConfirm', 'Send by email?'),
        lines: [OT.esc(t('it.to', 'To')) + ': ' + OT.esc(addr), OT.esc(t('it.subject', 'Subject')) + ': ' + OT.lang.highlight(subject), OT.esc(t('it.what', 'What')) + ': ' + OT.esc(t('it.whatText', 'One-page itinerary summary, {n} item(s), booking refs', { n: m.rows.length }))],
        note: OT.esc(t('it.mailHonest', 'Prototype: nothing is sent from a server. We open your email app with the summary (mailto) and log a simulated delivery.')),
        confirmLabel: t('it.mailOk', 'Send')
      }).then(function (ok) {
        if (!ok) return null;
        OT.state.lastShare = { channel: 'email', url: url, to: addr };
        log({ channel: 'email', to: maskMail(addr), journeyId: m.id, refs: m.refs, items: m.rows.length });
        OT.toast(t('it.sentTo', 'Sent to {to} (simulated)', { to: addr }), 'success');
        OT.modal({
          title: t('it.sentTo', 'Sent to {to} (simulated)', { to: addr }),
          body: '<p class="small">' + OT.icon('checkCircle', 16) + ' ' + OT.esc(t('it.mailDoneText', 'Logged as a simulated delivery in the admin notifications log. To send it for real from your own mailbox, open it in your email app:')) + '</p>' +
            '<p><a class="btn btn-ghost btn-sm" id="mail-link" href="' + OT.esc(url) + '">' + OT.icon('mail', 15) + OT.esc(t('it.openMail', 'Open in your email app')) + '</a></p>',
          actions: [{ label: t('common.close', 'Close'), kind: 'primary' }]
        });
        return url;
      });
    });
  }

  function action(kind) {
    if (kind === 'pdf') { if (OT.paySuccess) OT.paySuccess.close(true); OT.go('itinerary-print?print=1'); return; }
    if (kind === 'print') { window.print(); return; }
    if (kind === 'png') return savePng();
    if (kind === 'wa') return whatsApp();
    if (kind === 'mail') return email();
  }

  /** Small card for My Journey: "Your one-page itinerary". */
  function cardHTML() {
    return '<div class="card itin-card" data-tour="itin-card"><div class="card-head"><h2 class="h3">' + OT.icon('layers', 18) + ' ' + OT.esc(t('it.yours', 'Your one-page itinerary')) + '</h2>' + OT.simTag() + '</div>' +
      '<p class="xs muted">' + OT.esc(t('it.cardSub', 'A single A4 page with every time, ref, address and contact. Save it or send it.')) + '</p>' +
      '<div class="itin-btns"><a class="btn btn-ghost btn-sm" href="#/itinerary-print">' + OT.icon('eye', 15) + OT.esc(t('it.view', 'View')) + '</a>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-it="pdf">' + OT.icon('printer', 15) + OT.esc(t('it.pdf', 'Download PDF')) + '</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-it="png">' + OT.icon('image', 15) + OT.esc(t('it.png', 'Save PNG')) + '</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-it="wa">' + OT.icon('whatsapp', 15) + OT.esc(t('it.wa', 'WhatsApp')) + '</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-it="mail">' + OT.icon('mail', 15) + OT.esc(t('it.mail', 'Email')) + '</button></div>' + waNoteHTML() + '</div>';
  }
  function bindCard(scope) { OT.$$('.itin-card [data-it]', scope).forEach(function (b) { b.addEventListener('click', function () { action(b.getAttribute('data-it')); }); }); }

  OT.registerView('itinerary-print', {
    title: function () { return OT.t('it.yours', 'Your one-page itinerary'); },
    section: 'journey',
    render: render
  });
  OT.itinerary = { model: model, sheetHTML: sheetHTML, png: png, savePng: savePng, whatsApp: whatsApp, email: email, action: action, waUrl: waUrl, mailtoUrl: mailtoUrl,
    summaryText: summaryText, userMobile: userMobile, waNoteHTML: waNoteHTML, qr: qr, qrSVG: qrSVG, cardHTML: cardHTML, bindCard: bindCard };
})();
