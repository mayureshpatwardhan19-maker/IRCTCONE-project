/* IRCTC OneTrip — Checkout: itemised booking + payment summary, SIMULATED payment, human-in-the-loop
 * confirm with protected tokens, confirmation with booking refs. Never collects real card data. (Builder A)
 */
(function () {
  'use strict';
  var OT = window.OT;
  var D = function () { return OT.data.travel; };
  var root = null, method = 'upi', busy = false, heldFor = null;
  function t(k, fb, v) { return OT.t(k, fb, v); }
  function keep(v) { return OT.lang.keep(v); }
  var PREFIX = { hotel: 'HTL', cab: 'CAB', food: 'FOD', sight: 'SGT' };
  var METHODS = {
    upi: { icon: 'rupee', key: 'pay.upi', en: 'UPI (simulated)', detail: 'traveller@upi-sim', note: ['pay.upiNote', 'Demo VPA. No real UPI request is sent.'] },
    card: { icon: 'card', key: 'pay.card', en: 'Card (simulated)', detail: 'XXXX XXXX XXXX 4242', note: ['pay.cardNote', 'Demo card. Real card numbers are never collected.'] },
    wallet: { icon: 'wallet', key: 'pay.wallet', en: 'OneTrip Wallet (simulated)', detail: '₹5,000', note: ['pay.walletNote', 'Demo wallet balance.'] }
  };
  function code5() { var c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = ''; for (var i = 0; i < 5; i++) s += c.charAt(Math.floor(Math.random() * c.length)); return s; }

  /** v1.2.1: autos / e-rickshaws are paid on the meter, never charged here (defensive: older saved data). */
  function payable(i) { return i.status === 'selected' && !(OT.data.transport && OT.data.transport.isMeter(D().get(i.refId))); }
  function lines(j) {
    if (OT.meter) OT.meter.migrate();
    j = OT.store.get('journey') || j;
    return (j.items || []).filter(payable).map(function (i) {
      var x = D().get(i.refId) || {}, l = OT.agents.lineFor(i, j);
      var v = OT.agents.verifyOne(x) || { verdict: i.verification, flags: [] };
      var priceIssue = i.price !== i.listedPrice && !i.priceAccepted;
      var stale = v.flags.some(function (f) { return f.kind === 'stale'; });
      return { it: i, x: x, l: l, v: v, priceIssue: priceIssue, stale: stale, blocked: priceIssue || stale };
    });
  }

  /** v1.2.2: trains kept in the trip unpaid ("Add other services, pay once") are charged here with the services. */
  function trainRows(j) {
    var H = OT.trainHold, h = H && H.get(j); if (!h) return [];
    var round = h.legs.length > 1 || h.legs.some(function (l) { return l.leg === 'return'; });
    return h.legs.map(function (l) {
      var n = (l.pax || []).length || 1, conv = H.conv(method);
      return { leg: l, n: n, conv: conv, amount: H.legAmount(l, method), problem: H.problem(l), label: H.label(l, round) };
    });
  }
  function trainLineHTML(r, j) {
    var l = r.leg;
    return '<li class="co-line co-train-line' + (r.problem ? ' blocked' : '') + '" data-train-line="' + l.leg + '">' +
      '<span class="offer-ic">' + OT.icon('train', 18) + '</span>' +
      '<div class="co-what"><strong>' + OT.esc(r.label) + ' · ' + keep(l.no) + ' ' + OT.esc(l.name) + '</strong>' +
      '<span class="xs muted">' + keep(l.from) + ' ' + keep(l.dep) + ' → ' + keep(l.to) + ' ' + keep(l.arr) + ' · ' + keep(OT.fmtDate(l.date)) + ' · ' + keep(l.cls) + ' × ' + r.n + '</span>' +
      '<span class="xs muted">' + OT.esc(t('trn.passengers', 'Passengers')) + ': ' + (l.pax || []).map(function (p) { return OT.esc(p.name) + ' (' + OT.esc(p.age) + ')'; }).join(', ') + '</span>' +
      '<span class="xs co-hold-st">' + OT.badge('pending', t('hold.badge', 'Not paid yet')) + ' ' + OT.esc(t('hold.pnrAfter', 'PNR is issued when you pay')) + '</span>' +
      (r.problem ? '<div class="note note-warn small" role="alert" data-hold-problem>' + OT.icon('alert', 14) + ' ' + OT.esc(r.problem) + '</div>' : '') +
      '<span class="xs co-hold-act"><a href="#/' + OT.trainHold.searchPath(l, j) + '">' + OT.esc(t('hold.change', 'Choose another train')) + '</a> · <button type="button" class="btn-link xs" data-hold-remove="' + l.leg + '">' + OT.esc(t('hold.remove', 'Remove from trip')) + '</button></span></div>' +
      '<div class="co-amt"><span>' + keep(OT.inr(r.amount)) + '</span><span class="xs muted">' + keep(OT.inr(l.farePerPax)) + ' × ' + r.n + ' + ' + keep(OT.inr(r.conv)) + ' ' + OT.esc(t('hold.fee', 'fee')) + '</span></div></li>';
  }

  function lineHTML(r, j) {
    var i = r.it, x = r.x, l = r.l;
    var qty = l.qty > 1 ? keep(OT.inr(l.unit)) + ' × ' + l.qty + ' ' + OT.esc({ night: i.rooms > 1 ? t('co.roomNights', 'room-nights') : t('co.nights', 'nights'), person: t('co.persons', 'persons'), bag: t('co.bags', 'bags') }[l.basis] || '') : '';
    return '<li class="co-line' + (r.blocked ? ' blocked' : '') + '" data-line="' + i.id + '">' +
      '<span class="offer-ic">' + OT.icon(OT.itemIcon(x, i.type), 18) + '</span>' +
      '<div class="co-what"><strong>' + OT.esc(i.title) + '</strong><span class="xs muted">' + OT.esc(x.provider || '') + ' · ' + (i.when ? keep(OT.fmtDate(i.when)) + ' ' + keep(i.when.slice(11, 16)) : '') + '</span>' +
      '<span class="xs muted">' + OT.esc(t('co.refundOwner', 'Refund owner: {p}', { p: x.provider || '' })) + ' · ' + OT.lang.highlight(OT.agents.policyText(x.policy)) + '</span>' +
      (l.early ? '<span class="xs">' + OT.lang.highlight(t('co.early', 'Early check-in request {fee} (charged only if the hotel confirms)', { fee: OT.inr(l.early) })) + '</span>' : '') +
      (r.priceIssue ? '<div class="note note-warn small">' + OT.icon('alert', 14) + ' ' + OT.lang.highlight(t('co.priceIssue', 'Price changed at source: {a} → {b}.', { a: OT.inr(i.listedPrice), b: OT.inr(i.price) })) +
        ' <label class="check"><input type="checkbox" data-accept="' + i.id + '"> ' + OT.lang.highlight(t('co.accept', 'I accept {b}', { b: OT.inr(i.price) })) + '</label></div>' : '') +
      (r.stale ? '<div class="note note-warn small">' + OT.icon('clock', 14) + ' ' + OT.esc(t('co.stale', 'Data older than 6 h. Re-check before paying.')) + ' <button type="button" class="btn-link small" data-recheck-line="' + x.id + '">' + OT.esc(t('res.recheck', 'Re-check now')) + '</button></div>' : '') +
      '</div>' +
      '<div class="co-amt"><span>' + keep(OT.inr(l.amount)) + '</span>' + (qty ? '<span class="xs muted">' + qty + '</span>' : '') + '<span class="xs muted">' + OT.esc(t('co.gstIncl', 'incl. GST {g}', { g: OT.inr(l.gst) })) + '</span></div></li>';
  }

  function summaryHTML(j, rows) {
    var trows = trainRows(j), held = !!trows.length;
    var svc = rows.reduce(function (s, r) { return s + r.l.amount; }, 0);
    var trn = trows.reduce(function (s, r) { return s + r.amount; }, 0), convSum = trows.reduce(function (s, r) { return s + r.conv; }, 0);
    var total = svc + trn;
    var gst = rows.reduce(function (s, r) { return s + r.l.gst; }, 0);
    var blocked = rows.some(function (r) { return r.blocked; }) || trows.some(function (r) { return r.problem; });
    var m = METHODS[method];
    return '<div class="container page checkout-page">' +
      '<div class="page-head"><div><p class="ot-eyebrow">' + OT.icon('shield', 14) + ' ' + OT.esc(t('co.eyebrow', 'Human-in-the-loop: nothing is booked until you confirm')) + '</p>' +
      '<h1>' + OT.esc(t('co.title', 'Review & pay')) + '</h1><p>' + OT.esc(t('co.sub', 'Simulated payment. No money moves and no real payment details are collected.')) + '</p></div>' +
      '<a class="btn btn-ghost btn-sm" href="#/journey">' + OT.icon('arrowLeft', 15) + OT.esc(t('co.back', 'Back to My Journey')) + '</a></div>' +
      '<div class="co-grid">' +
      '<div class="card co-items" data-tour="co-items"><div class="card-head"><h2 class="h3">' + OT.esc(t('co.summary', 'Booking summary')) + '</h2>' + OT.simTag() + '</div>' +
      (held ? '<p class="small co-hold-intro" data-co-hold>' + OT.icon('train', 15) + ' ' + OT.esc(trows.length > 1 ? t('hold.coIntro2', 'Your trains are not paid yet: they are charged here with your services, in one payment.') : t('hold.coIntro', 'Your train is not paid yet: it is charged here with your services, in one payment.')) + '</p>' :
      !j.train ? '<div class="co-ticket small co-trip">' + OT.icon('route', 18) + '<div><strong>' + OT.esc(OT.trip.title(j)) + '</strong><span class="xs muted"><bdi class="keep">' + OT.esc(OT.fmtDate(j.start)) + (j.end && j.end !== j.start ? ' – ' + OT.esc(OT.fmtDate(j.end)) : '') + '</bdi> · ' + OT.esc(t('trip.noTrainShort', 'no train in this trip')) + '</span></div>' +
        '<div class="co-amt"><a class="xs" href="#/journey">' + OT.esc(t('trip.addTrain', 'Add a train to this trip')) + '</a></div></div>' :
      '<div class="co-ticket small">' + OT.icon('train', 18) + '<div><strong>' + OT.esc(t('co.ticket', 'Train ticket')) + ' ' + keep(j.train.no) + ' · PNR ' + keep(j.pnr) + '</strong>' +
      '<span class="xs muted">' + keep(j.train.from) + ' ' + keep(j.train.dep) + ' → ' + keep(j.train.to) + ' ' + keep(j.train.arr) + ' · ' + keep(OT.fmtDate(j.train.date)) + '</span></div>' +
      (j.train.status === 'PLANNED' ? '<div class="co-amt">' + OT.badge('pending', t('trip.notBooked', 'Not booked yet')) + '<a class="xs" href="#/' + OT.trains.path({ from: j.train.from, to: j.train.to, date: j.train.date, pax: j.passengers }) + '">' + OT.esc(t('trip.bookNow', 'Book this train')) + '</a></div></div>' :
      '<div class="co-amt"><span>' + keep(OT.inr(j.train.fare)) + '</span>' + OT.badge('confirmed', t('co.paidIrctc', 'Paid on IRCTC')) + '<span class="xs muted">' + OT.esc(t('co.notCharged', 'Not charged again')) + '</span></div></div>')) +
      (OT.agents.liveReturn(j) && !OT.agents.liveReturn(j).held ? (function (r) {
        return '<div class="co-ticket small" data-co-return>' + OT.icon('train', 18) + '<div><strong>' + OT.esc(t('ret.title', 'Return train')) + ' ' + keep(r.no) + ' · PNR ' + keep(r.pnr) + '</strong>' +
          '<span class="xs muted">' + keep(r.from) + ' ' + keep(r.dep) + ' → ' + keep(r.to) + ' ' + keep(r.arr) + ' · ' + keep(OT.fmtDate(r.date)) + '</span></div>' +
          '<div class="co-amt">' + (r.fare ? '<span>' + keep(OT.inr(r.fare)) + '</span>' : '') + OT.badge('confirmed', r.bookedViaOneTrip ? t('ret.paidAlready', 'Paid') : t('co.paidIrctc', 'Paid on IRCTC')) + '<span class="xs muted">' + OT.esc(t('co.notCharged', 'Not charged again')) + '</span></div></div>';
      })(OT.agents.liveReturn(j)) : '') +
      '<ul class="co-lines">' + trows.map(function (r) { return trainLineHTML(r, j); }).join('') + rows.map(function (r) { return lineHTML(r, j); }).join('') + '</ul>' +
      (OT.meter && OT.meter.list(j).length ? '<p class="xs muted co-meter" data-co-meter>' + OT.icon('info', 12) + ' ' + OT.esc(t('co.meterNote', '{n} auto / e-rickshaw ride(s) in your plan (about {p}) are paid to the driver on the meter: not booked, not charged here.', { n: OT.meter.list(j).length, p: OT.inr(OT.meter.total(j)) })) + '</p>' : '') +
      '<div class="co-totals small">' +
      (held ? '<div data-co-trains><span>' + OT.esc(t('hold.coTrains', 'Train tickets ({n})', { n: trows.length })) + '</span>' + keep(OT.inr(trn)) + '</div>' : '') +
      '<div data-co-services><span>' + OT.esc(t('co.subtotal', 'OneTrip services')) + '</span>' + keep(OT.inr(svc)) + '</div>' +
      '<div class="muted"><span>' + OT.esc(t('co.ofGst', 'of which GST (simulated breakdown)')) + '</span>' + keep(OT.inr(gst)) + '</div>' +
      (held ? '<div class="muted"><span>' + OT.esc(t('hold.coConv', 'of which train convenience fee (simulated)')) + '</span>' + keep(OT.inr(convSum)) + '</div>'
        : '<div class="muted"><span>' + OT.esc(t('co.fee', 'Convenience fee')) + '</span>' + keep(OT.inr(0)) + '</div>') +
      '<div class="grand"><span>' + OT.esc(t('co.total', 'Total payable now')) + '</span><strong>' + keep(OT.inr(total)) + '</strong></div></div></div>' +

      '<div class="co-pay"><div class="card" data-tour="co-pay"><h2 class="h3">' + OT.esc(t('co.method', 'Payment method')) + '</h2>' +
      '<div class="pay-methods" role="radiogroup">' + Object.keys(METHODS).map(function (k) {
        var mm = METHODS[k];
        return '<label class="pay-m' + (k === method ? ' on' : '') + '"><input type="radio" name="pm" value="' + k + '"' + (k === method ? ' checked' : '') + '>' + OT.icon(mm.icon, 18) +
          '<span><strong>' + OT.esc(t(mm.key, mm.en)) + '</strong><span class="xs muted">' + OT.esc(t(mm.note[0], mm.note[1])) + '</span></span></label>';
      }).join('') + '</div>' +
      '<div class="field"><label>' + OT.esc(t('co.detail', 'Prefilled demo details')) + '</label><input class="input mono-num" value="' + OT.esc(m.detail) + '" disabled aria-readonly="true"></div>' +
      '<div class="owners xs"><div>' + OT.icon('bank', 14) + ' ' + OT.esc(t('co.payOwner', 'Payment & disputes: Partner Bank (sample)')) + '</div>' +
      '<div>' + OT.icon('store', 14) + ' ' + OT.esc(t('co.svcOwner', 'Service, cancellation & refunds: each provider (shown per line)')) + '</div>' +
      '<div>' + OT.icon('headset', 14) + ' ' + OT.esc(t('co.supOwner', 'First-line support: IRCTC OneTrip')) + '</div></div>' +
      (blocked ? '<p class="small text-warn" role="alert">' + OT.icon('alert', 14) + ' ' + OT.esc(t('co.blocked', 'Resolve the highlighted items before paying.')) + '</p>' : '') +
      '<button type="button" class="btn btn-accent btn-lg btn-block" id="pay-btn"' + (blocked || !(rows.length || held) ? ' disabled' : '') + '>' + OT.icon('lock', 18) +
      OT.esc(held ? t('hold.payBtn', 'Pay {amt} for everything (simulated)', { amt: OT.inr(total) }) : t('co.pay', 'Pay {amt} (simulated)', { amt: OT.inr(total) })) + '</button>' +
      '<p class="xs muted center">' + OT.esc(t('co.payNote', 'You will see a confirmation with all details before anything is booked.')) + '</p></div></div>' +
      '</div></div>';
  }

  function confirmationHTML(c) {
    return '<div class="container page"><div class="card confirmation" data-tour="confirmation">' +
      '<div class="conf-head">' + OT.icon('checkCircle', 44) + '<div><h1 class="h2">' + OT.esc(t('co.confirmed', 'Booking confirmed (simulated)')) + '</h1>' +
      '<p class="muted">' + OT.lang.highlight(t('co.txn', 'Transaction {txn} · {amt} · {method}', { txn: c.txn, amt: OT.inr(c.total), method: c.method })) + '</p></div></div>' +
      '<ul class="conf-list">' + c.bookings.map(function (b) {
        return '<li>' + OT.icon(OT.itemIcon(D().get(b.refId), b.type), 18) + '<div><strong>' + OT.esc(b.title) + '</strong><span class="xs muted">' + OT.esc(b.provider || '') + (b.partnerId ? ' · ' + keep(b.partnerId) : '') + '</span></div>' +
          '<span class="keep-ref">' + keep(b.type === 'train' && b.pnr ? 'PNR ' + b.pnr : b.ref) + '</span>' + keep(OT.inr(b.amount)) + OT.badge('confirmed') + '</li>';
      }).join('') + '</ul>' +
      (c.partners.length ? '<p class="small conf-partner">' + OT.icon('store', 15) + ' ' + OT.esc(t('co.partnerNotified', 'Partners notified: {list}. The booking now appears in their dashboard.', { list: c.partners.join(', ') })) + '</p>' : '') +
      '<p class="xs muted">' + OT.esc(t('co.receiptNote', 'Simulated receipt for an academic demo. No money was moved.')) + '</p>' +
      '<div class="row-wrap"><a class="btn btn-primary" href="#/journey">' + OT.icon('route', 16) + OT.esc(t('nav.journey', 'My Journey')) + '</a>' +
      '<a class="btn btn-ghost" href="#/bookings">' + OT.esc(t('nav.bookings', 'Bookings & refunds')) + '</a>' +
      '<button type="button" class="btn btn-ghost" id="conf-listen">' + OT.icon('speaker', 16) + OT.esc(t('res.listen', 'Listen')) + '</button>' +
      (OT.views.partner ? '<a class="btn btn-link" href="#/partner">' + OT.esc(t('co.seePartner', 'See it in the partner dashboard')) + ' →</a>' : '') + '</div></div></div>';
  }

  function pay() {
    if (busy || !root) return Promise.resolve(false);
    var j = OT.store.get('journey'); if (!j) return Promise.resolve(false);
    var rows = lines(j), trows = trainRows(j);
    var bad = trows.filter(function (r) { return r.problem; })[0];
    if (bad) { OT.toast(bad.problem, 'error'); if (root) render(root); return Promise.resolve(false); }
    if (!(rows.length || trows.length) || rows.some(function (r) { return r.blocked; })) { OT.toast(t('co.blocked', 'Resolve the highlighted items before paying.'), 'error'); return Promise.resolve(false); }
    var total = rows.reduce(function (s, r) { return s + r.l.amount; }, 0) + trows.reduce(function (s, r) { return s + r.amount; }, 0);
    var m = METHODS[method];
    var cl = (trows.length ? trows.map(function (r) {
      var l = r.leg;
      return OT.esc(r.label) + ': ' + keep(l.no) + ' ' + OT.esc(l.name) + ' · ' + keep(l.from) + ' ' + keep(l.dep) + ' → ' + keep(l.to) + ' ' + keep(l.arr) + ' · ' + keep(OT.fmtDate(l.date)) + ' · ' + keep(l.cls) + ' × ' + r.n +
        ' · ' + OT.esc(t('trn.passengers', 'Passengers')) + ': ' + (l.pax || []).map(function (p) { return OT.esc(p.name); }).join(', ') + ' · <strong>' + keep(OT.inr(r.amount)) + '</strong> ' + OT.esc(t('hold.inclFee', '(incl. {c} fee)', { c: OT.inr(r.conv) }));
    }) : [
      j.train ? OT.esc(t('co.cTrip', 'Trip')) + ': ' + keep(j.train.no) + ' · PNR ' + keep(j.pnr) + ' · ' + keep(j.train.from) + ' → ' + keep(j.train.to) + ' · ' + keep(OT.fmtDate(j.train.date))
        : OT.esc(t('co.cTrip', 'Trip')) + ': ' + OT.esc(OT.trip.title(j)) + ' · ' + keep(OT.fmtDate(j.start))
    ]).concat(rows.map(function (r) { return OT.esc(r.it.title) + ': ' + keep(OT.inr(r.l.amount)) + (r.it.when ? ' · ' + keep(OT.fmtDate(r.it.when)) + ' ' + keep(r.it.when.slice(11, 16)) : ''); }))
      .concat([OT.esc(t('co.cTotal', 'Total')) + ': <strong>' + keep(OT.inr(total)) + '</strong> · ' + OT.esc(t(m.key, m.en))]);
    busy = true;
    return OT.confirmAction({
      title: trows.length ? t('hold.cTitle', 'Confirm trains, services and one payment') : t('co.cTitle', 'Confirm booking and payment'),
      intro: t('co.cIntro', 'Please check these details. PNR, train number, dates and amounts are shown exactly as booked (never translated).'),
      lines: cl,
      note: OT.esc(t('co.cNote', 'Simulated: no real payment will be taken.')),
      confirmLabel: t('co.cOk', 'Confirm & pay {amt}', { amt: OT.inr(total) })
    }).then(function (ok) {
      if (!ok) { busy = false; return false; }
      OT.state.payPending = true;
      var btn = root && root.querySelector('#pay-btn');
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> ' + OT.esc(t('co.processing', 'Re-verifying prices and authorising (simulated)…')); }
      return OT.sleep(1100).then(function () {
        var txn = 'SIM-TXN-' + code5() + code5().slice(0, 3);
        var now = new Date().toISOString(), user = OT.store.get('user') || {};
        var created = [], issued = { bookings: [], refs: [] };
        if (trows.length) {
          var still = trainRows(OT.store.get('journey')).filter(function (r) { return r.problem; })[0];
          if (still) { busy = false; OT.state.payPending = false; OT.toast(still.problem, 'error'); if (root) render(root); return false; }
          issued = OT.trainHold.issue(method, m.en, txn);
          created = created.concat(issued.bookings);
        }
        OT.store.update('journey', function (jj) {
          jj.items.forEach(function (i) {
            if (!payable(i)) return;
            var x = D().get(i.refId) || {}, l = OT.agents.lineFor(i, jj);
            var ref = 'OT-' + (x.mode ? 'LTR' : PREFIX[i.type] || 'SVC') + '-' + code5();
            i.status = 'confirmed'; i.bookingRef = ref; i.verification = 'verified'; i.paidAt = now;
            created.push({ ref: ref, journeyId: jj.id, itemId: i.id, refId: i.refId, type: i.type, partnerId: i.partnerId, title: i.title, provider: x.provider,
              amount: l.amount, gst: l.gst, status: 'confirmed', paidAt: now, method: m.en, city: i.city || jj.scenario,
              when: i.when, txn: txn, pnr: jj.pnr, lang: OT.i18n.lang(), guest: user.name || 'Sunita S.', pax: jj.passengers, earlyCheckIn: !!i.earlyCheckIn, simulated: true });
          });
          return jj;
        });
        OT.store.update('bookings', function (b) { return (b || []).concat(created); });
        var partners = created.filter(function (b) { return /^P-/.test(b.partnerId || ''); }).map(function (b) { return b.provider + ' (' + b.partnerId + ')'; });
        OT.state.lastCheckout = { txn: txn, total: total, method: m.en, bookings: created, partners: partners, at: now };
        busy = false;
        OT.emit('booking:confirmed', OT.state.lastCheckout);
        if (root) render(root);
        var to = created.map(function (b) { return b.provider; }).filter(function (v, k, a) { return v && a.indexOf(v) === k; });
        OT.paySuccess.show({
          amount: total, method: m.en, txn: txn, at: now, viewHref: 'journey',
          paidTo: 'IRCTC OneTrip' + (to.length ? ' · ' + (to.length > 2 ? t('ps2.nProviders', '{n} providers', { n: to.length }) : to.join(', ')) : ''),
          refs: issued.refs.concat(created.filter(function (b) { return b.type !== 'train'; }).map(function (b) { return { icon: OT.itemIcon(D().get(b.refId), b.type), label: b.title, ref: b.ref }; }))
        });
        return true;
      });
    });
  }

  function render(el) {
    root = el;
    var j = OT.store.get('journey');
    if (!j) {
      el.innerHTML = '<div class="container page"><div class="card empty-state">' + OT.icon('wallet', 36) + '<h1 class="h2">' + OT.esc(t('co.emptyTitle', 'Nothing to pay')) + '</h1><p class="muted">' + OT.esc(t('co.empty', 'Plan a trip and add services first.')) + '</p><a class="btn btn-primary" href="#/home">' + OT.esc(t('nav.plan', 'Plan trip')) + '</a></div></div>';
      return;
    }
    var rows = lines(j), held = trainRows(j).length;
    if (held && heldFor !== j.id) { heldFor = j.id; if (j.hold.method && METHODS[j.hold.method]) method = j.hold.method; return render(el); }
    var lc = OT.state.lastCheckout;
    if (!rows.length && !held && lc && lc.bookings.length && lc.bookings[0].journeyId === j.id) {
      el.innerHTML = confirmationHTML(lc);
      var lb = el.querySelector('#conf-listen');
      if (lb) lb.addEventListener('click', function () {
        OT.lang.speak(t('co.speak', 'Your booking is confirmed. Transaction {txn}. {n} services booked for {amt}.', { txn: lc.txn, n: lc.bookings.length, amt: OT.inr(lc.total) }), OT.i18n.lang());
      });
      return;
    }
    if (!rows.length && !held) {
      el.innerHTML = '<div class="container page"><div class="card empty-state">' + OT.icon('checkCircle', 36) + '<h1 class="h2">' + OT.esc(t('co.allPaid', 'Everything in your journey is booked')) + '</h1>' +
        '<p class="muted">' + OT.esc(t('co.allPaidSub', 'Add more services, or manage bookings and refunds.')) + '</p><div class="row-wrap center"><a class="btn btn-primary" href="#/journey">' + OT.esc(t('nav.journey', 'My Journey')) + '</a><a class="btn btn-ghost" href="#/bookings">' + OT.esc(t('nav.bookings', 'Bookings & refunds')) + '</a></div></div></div>';
      return;
    }
    el.innerHTML = summaryHTML(j, rows);
    OT.$$('input[name="pm"]', el).forEach(function (r) { r.addEventListener('change', function () { method = r.value; render(el); }); });
    OT.$$('[data-accept]', el).forEach(function (c) {
      c.addEventListener('change', function () {
        var id = c.getAttribute('data-accept');
        OT.store.update('journey', function (jj) { jj.items.forEach(function (i) { if (i.id === id) { i.priceAccepted = c.checked; if (c.checked) i.verification = 'verified'; } }); return jj; });
        render(el);
      });
    });
    OT.$$('[data-recheck-line]', el).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-recheck-line'); b.disabled = true; b.textContent = t('res.rechecking', 'Re-checking…');
        OT.sleep(700).then(function () {
          OT.agents.recheck(id);
          OT.store.update('journey', function (jj) { jj.items.forEach(function (i) { if (i.refId === id && i.status === 'selected') i.verification = OT.agents.verifyOne(D().get(id)).verdict; }); return jj; });
          if (root) render(root);
          OT.toast(t('res.recheckedToast', 'Re-checked at source just now.'), 'success');
        });
      });
    });
    var pb = el.querySelector('#pay-btn'); if (pb) pb.addEventListener('click', pay);
    OT.$$('[data-hold-remove]', el).forEach(function (b) {
      b.addEventListener('click', function () { OT.trainHold.remove(b.getAttribute('data-hold-remove')).then(function (ok) { if (ok && root) render(root); }); });
    });
  }

  OT.registerView('checkout', {
    title: function () { return OT.t('co.title', 'Review & pay'); },
    section: 'journey',
    render: render,
    onLeave: function () { root = null; busy = false; },
    pay: pay
  });
})();
