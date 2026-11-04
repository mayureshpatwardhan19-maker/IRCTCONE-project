/* IRCTC OneTrip — Bookings & refunds: status tracking, policy-based cancellation (confirm first),
 * refund tracker (requested → approved → processed to source → credited), support tickets. (Builder A)
 */
(function () {
  'use strict';
  var OT = window.OT;
  var D = function () { return OT.data.travel; };
  var root = null, filter = 'all', timers = [];
  function t(k, fb, v) { return OT.t(k, fb, v); }
  function keep(v) { return OT.lang.keep(v); }
  var STAGES = [['rf.requested', 'Requested'], ['rf.approved', 'Approved by provider'], ['rf.processed', 'Processed to source (Partner Bank)'], ['rf.credited', 'Credited to your account']];

  function ymdPlus(iso, days) { var d = new Date(iso); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }

  function trackerHTML(b) {
    var c = b.cancellation, stage = c.stage || 0;
    return '<div class="rf-track" data-tour="refund"><div class="rf-head small"><strong>' + OT.esc(t('rf.title', 'Refund tracker')) + '</strong> · ' + keep(OT.inr(c.refundAmount)) +
      ' (' + c.pct + '%) · ' + OT.esc(t('rf.eta', 'ETA {d}', { d: OT.fmtDate(c.eta) })) + '</div>' +
      '<ol class="rf-steps">' + STAGES.map(function (s, i) {
        var st = i <= stage ? 'done' : i === stage + 1 ? 'now' : 'todo';
        var when = c.times && c.times[i] ? '<span class="xs muted">' + OT.esc(OT.stamp(new Date(c.times[i]))) + '</span>' : '';
        return '<li class="rf-' + st + '"><span class="rf-dot">' + (st === 'done' ? OT.icon('check', 12) : '') + '</span><span class="rf-lbl">' + OT.esc(t(s[0], s[1])) + when + '</span></li>';
      }).join('') + '</ol>' +
      '<p class="xs muted">' + OT.esc(t('rf.owners', 'Refund decision: {p}. Money movement: Partner Bank (sample), to the original payment method.', { p: b.provider || '' })) + '</p>' +
      (stage < 3 ? '<button type="button" class="btn btn-link small" data-advance="' + b.ref + '">' + OT.icon('play', 13) + ' ' + OT.esc(t('rf.simulate', 'Simulate next step (demo)')) + '</button>' : '') + '</div>';
  }

  function cardHTML(b) {
    var x = D().get(b.refId) || {}, rf = OT.agents.refundFor(b);
    var st = b.status, pol = b.type === 'train' ? { rail: true } : x.policy, tk = b.ticket;
    return '<article class="bkg card-flat' + (b.type === 'train' ? ' bkg-train' : '') + '" data-bk="' + b.ref + '">' +
      '<div class="bk-top"><span class="offer-ic">' + OT.icon(OT.itemIcon(x, b.type), 20) + '</span>' +
      '<div class="bk-title"><strong>' + OT.esc(b.title) + '</strong><span class="xs muted">' + (b.leg ? '<span class="lbl' + (b.leg === 'return' ? ' lbl-ret' : '') + '" data-leg="' + b.leg + '">' + OT.esc(b.leg === 'return' ? t('ret.retLbl', 'Return') : t('ret.outLbl', 'Outward')) + '</span> ' : '') + OT.esc(b.provider || '') + ' · ' + keep(b.ref) + '</span></div>' +
      '<div class="bk-amt">' + keep(OT.inr(b.amount)) + OT.badge(st) + (tk && st === 'confirmed' && tk.status !== 'CNF' ? OT.badge('pending', tk.passengers[0].status + ' · ' + t('trn.chance', '{p}% chance', { p: tk.chance })) : '') + '</div></div>' +
      (tk ? '<p class="small bk-tk">' + OT.icon('train', 14) + ' PNR ' + keep(tk.pnr) + ' · ' + keep(tk.from) + ' ' + keep(tk.dep) + ' → ' + keep(tk.to) + ' ' + keep(tk.arr) + ' · ' + keep(tk.cls) + ' · ' +
        OT.esc(t('ps.partyN', '{n} traveller(s)', { n: tk.passengers.length })) + ' · <a href="#/trains/ticket?pnr=' + tk.pnr + '">' + OT.esc(t('bk.eticket', 'View e-ticket')) + '</a></p>' : '') +
      '<dl class="bk-meta xs">' +
      '<div><dt>' + OT.esc(t('bk.when', 'Service date')) + '</dt><dd>' + (b.when ? keep(OT.fmtDate(b.when)) + ' ' + keep(b.when.slice(11, 16)) : '—') + '</dd></div>' +
      '<div><dt>' + OT.esc(t('bk.paid', 'Paid')) + '</dt><dd>' + OT.esc(OT.stamp(new Date(b.paidAt))) + '</dd></div>' +
      '<div><dt>' + OT.esc(t('bk.method', 'Method')) + '</dt><dd>' + OT.esc(b.method) + '</dd></div>' +
      '<div><dt>' + OT.esc(t('bk.txn', 'Transaction')) + '</dt><dd>' + keep(b.txn || '—') + '</dd></div></dl>' +
      '<p class="policy small">' + OT.icon('refund', 14) + ' <span>' + OT.lang.highlight(OT.agents.policyText(pol)) + '</span></p>' +
      (b.cancellation ? trackerHTML(b) : '') +
      '<div class="offer-actions">' +
      (st === 'confirmed' ? '<button type="button" class="btn btn-ghost btn-sm danger-ghost" data-cancel="' + b.ref + '">' + OT.icon('xCircle', 15) + OT.esc(t('bk.cancel', 'Cancel')) +
        (rf.amount != null ? ' · ' + OT.esc(t('bk.refundEst', 'refund {a}', { a: OT.inr(rf.amount) })) : '') + '</button>' : '') +
      '<button type="button" class="btn btn-link small" data-ticket="' + b.ref + '">' + OT.icon('headset', 14) + ' ' + OT.esc(t('bk.help', 'Raise support ticket')) + '</button>' +
      '</div></article>';
  }

  /** Persona's simulated past trips (not real bookings; not counted in partner/admin data). */
  function historyHTML() {
    var u = OT.store.get('user'), p = u && u.personaId && OT.data.personas && OT.data.personas.get(u.personaId);
    if (!p || !p.history || !p.history.length) return '';
    return '<div class="card tickets history"><div class="card-head"><h2 class="h3">' + OT.icon('clock', 18) + ' ' + OT.esc(t('bk.history', 'Past trips ({name})', { name: p.short })) + '</h2>' + OT.simTag(t('bk.histTag', 'SIMULATED HISTORY')) + '</div><ul class="tk-list">' +
      p.history.map(function (h) {
        return '<li><span><bdi class="keep">' + h[0] + '</bdi> → <bdi class="keep">' + h[1] + '</bdi></span><span class="small">' + OT.esc(D().stationName(h[0], OT.i18n.lang())) + ' → ' + OT.esc(D().stationName(h[1], OT.i18n.lang())) + ' · <bdi class="keep">' + h[4] + '</bdi></span>' +
          '<span class="xs muted"><bdi class="keep">' + OT.esc(OT.fmtDate(h[2])) + '</bdi> · <bdi class="keep">' + OT.esc(OT.inr(h[5])) + '</bdi></span>' + OT.badge('confirmed', t('bk.travelled', 'Travelled')) + '</li>';
      }).join('') + '</ul></div>';
  }

  function ticketsHTML() {
    var tk = (OT.store.get('tickets', []) || []).slice().reverse();
    if (!tk.length) return '';
    return '<div class="card tickets"><div class="card-head"><h2 class="h3">' + OT.icon('headset', 18) + ' ' + OT.esc(t('bk.tickets', 'Support tickets')) + '</h2></div><ul class="tk-list">' +
      tk.slice(0, 8).map(function (k) {
        return '<li><span>' + keep(k.id) + '</span><span class="small">' + OT.esc(k.subject) + (k.bookingRef ? ' · ' + keep(k.bookingRef) : '') + '</span>' +
          '<span class="xs muted">' + OT.esc(OT.lang.info(k.lang).native) + ' · ' + OT.esc(OT.stamp(new Date(k.createdAt))) + '</span>' + OT.badge('pending', t('bk.open', 'Open · human agent')) + '</li>';
      }).join('') + '</ul></div>';
  }

  function render(el) {
    root = el;
    timers.forEach(clearTimeout); timers = [];
    var j = OT.store.get('journey');
    var all = (OT.store.get('bookings', []) || []).slice().reverse();
    var list = all.filter(function (b) { return filter === 'all' || (filter === 'active' ? b.status === 'confirmed' : b.status !== 'confirmed'); });
    var tabs = [['all', 'bk.all', 'All'], ['active', 'bk.active', 'Active'], ['refunds', 'bk.refunds', 'Cancelled & refunds']];
    el.innerHTML = '<div class="container page bookings-page">' +
      '<div class="page-head"><div><h1>' + OT.esc(t('bk.title', 'Bookings & refunds')) + '</h1><p>' + OT.esc(t('bk.sub', 'Track status, cancel under each provider\'s policy, and follow your refund to the bank.')) + '</p></div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-ticket="">' + OT.icon('headset', 15) + OT.esc(t('bk.help', 'Raise support ticket')) + '</button></div>' +
      (j && j.pnr && j.train && !all.some(function (b) { return b.type === 'train' && b.pnr === j.pnr; }) ? '<div class="co-ticket card-flat small bk-train">' + OT.icon('train', 18) + '<div><strong>' + OT.esc(t('co.ticket', 'Train ticket')) + ' ' + keep(j.train.no) + ' · PNR ' + keep(j.pnr) + '</strong>' +
        '<span class="xs muted">' + OT.esc(t('bk.trainNote', 'Managed on IRCTC under railway rules. Cancel or refund the ticket on IRCTC.')) + '</span></div>' + OT.badge('confirmed', t('status.cnf', 'CNF')) + '</div>' : '') +
      (OT.trainHold && OT.trainHold.get(j) ? '<div class="card-flat small bk-unpaid" data-bk-unpaid>' + OT.icon('train', 18) + '<div><strong>' + OT.esc(t('hold.bkTitle', '{n} train(s) in your trip, not paid yet', { n: OT.trainHold.get(j).legs.length })) + '</strong>' +
        '<span class="xs muted">' + OT.esc(t('hold.bkSub', 'They are not bookings yet: the PNR is issued when you pay at checkout, and only then can they be cancelled here.')) + '</span></div>' +
        '<a class="btn btn-accent btn-sm" href="#/checkout">' + OT.esc(t('hold.payAll', 'Review & pay for everything')) + '</a></div>' : '') +
      '<div class="tabs" role="tablist">' + tabs.map(function (tb) {
        var n = all.filter(function (b) { return tb[0] === 'all' || (tb[0] === 'active' ? b.status === 'confirmed' : b.status !== 'confirmed'); }).length;
        return '<button type="button" class="tab" role="tab" data-f="' + tb[0] + '" aria-selected="' + (filter === tb[0]) + '">' + OT.esc(t(tb[1], tb[2])) + ' <span class="tab-n">' + n + '</span></button>';
      }).join('') + '</div>' +
      (list.length ? '<div class="bk-list">' + list.map(cardHTML).join('') + '</div>'
        : '<div class="card empty-state">' + OT.icon('layers', 34) + '<p class="muted">' + OT.esc(all.length ? t('bk.noneFilter', 'Nothing in this view.') : t('bk.none', 'No OneTrip bookings yet. Add services to your journey and pay (simulated) to see them here.')) + '</p>' +
          (all.length ? '' : '<a class="btn btn-primary" href="#/journey">' + OT.esc(t('nav.journey', 'My Journey')) + '</a>') + '</div>') +
      ticketsHTML() + historyHTML() + '</div>';

    OT.$$('[data-f]', el).forEach(function (b) { b.addEventListener('click', function () { filter = b.getAttribute('data-f'); render(el); }); });
    OT.$$('[data-cancel]', el).forEach(function (b) { b.addEventListener('click', function () { cancel(b.getAttribute('data-cancel')); }); });
    OT.$$('[data-ticket]', el).forEach(function (b) { b.addEventListener('click', function () { ticketModal(b.getAttribute('data-ticket')); }); });
    OT.$$('[data-advance]', el).forEach(function (b) { b.addEventListener('click', function () { advance(b.getAttribute('data-advance')); }); });
    // auto-approve a fresh request after a few seconds, so the tracker visibly moves
    all.forEach(function (b) {
      if (b.cancellation && (b.cancellation.stage || 0) === 0) timers.push(setTimeout(function () { if (root) advance(b.ref, true); }, 4000));
    });
  }

  function update(ref, fn) {
    OT.store.update('bookings', function (l) { return (l || []).map(function (b) { if (b.ref === ref) fn(b); return b; }); });
  }

  function advance(ref, quiet) {
    var now = new Date().toISOString();
    update(ref, function (b) {
      var c = b.cancellation; if (!c || c.stage >= 3) return;
      c.stage = (c.stage || 0) + 1; c.times = c.times || []; c.times[c.stage] = now;
      if (c.stage === 3) { c.status = 'refunded'; b.status = 'refunded'; c.refundedAt = now; }
    });
    OT.store.update('cancellations', function (l) { return (l || []).map(function (c) { if (c.ref === ref) { var b = (OT.store.get('bookings') || []).filter(function (x) { return x.ref === ref; })[0]; if (b) { c.stage = b.cancellation.stage; c.status = b.cancellation.status; } } return c; }); });
    if (!quiet) OT.toast(t('rf.moved', 'Refund status updated (simulated).'), 'info');
    if (root) render(root);
  }

  function cancel(ref) {
    var b = (OT.store.get('bookings') || []).filter(function (x) { return x.ref === ref; })[0];
    if (!b) return Promise.resolve(false);
    var x = D().get(b.refId) || {}, rf = OT.agents.refundFor(b);
    var pol = b.type === 'train' ? { rail: true } : x.policy;
    var amt = rf.amount == null ? null : rf.amount;
    var lines = [
      OT.esc(b.title) + ' · ' + keep(b.ref) + (b.pnr ? ' · PNR ' + keep(b.pnr) : ''),
      OT.esc(t('bk.cPolicy', 'Policy')) + ': ' + OT.lang.highlight(OT.agents.policyText(pol)) + (b.type === 'train' ? '<br>' + OT.esc(t('rail.charge', 'Cancellation charge')) + ': ' + keep(OT.inr(rf.charge || 0)) + ' · ' + OT.esc(t(rf.policy.rule, rf.policy.rule)) : ''),
      OT.esc(t('bk.cStart', 'Service starts')) + ': ' + (b.when ? keep(OT.fmtDate(b.when)) + ' ' + keep(b.when.slice(11, 16)) : '—') + ' · ' + OT.esc(t('bk.cLeft', '{h} h from now', { h: Math.max(0, Math.round(rf.hoursLeft)) })),
      amt == null ? OT.esc(t('bk.cUnknown', 'Refund amount unavailable: provider policy missing. A human agent will review.')) :
        OT.esc(t('bk.cRefund', 'Refund')) + ': <strong>' + keep(OT.inr(amt)) + '</strong> (' + rf.pct + '% ' + OT.esc(t('bk.cOf', 'of')) + ' ' + keep(OT.inr(b.amount)) + ') → ' + OT.esc(b.method)
    ];
    var orig = OT.i18n.lang() !== 'en' ? '<details class="xs"><summary>' + OT.esc(t('tb.showOrig', 'Show original')) + ' (English)</summary>' + OT.lang.highlight(OT.agents.policyText(pol, 'en')) + '</details>' : '';
    return OT.confirmAction({
      title: t('bk.cTitle', 'Cancel this booking?'),
      lines: lines, danger: true,
      note: OT.esc(t('bk.cNote', 'Cancellation and refund text is a reviewed translation; booking refs and amounts are unchanged.')) + orig,
      confirmLabel: t('bk.cOk', 'Yes, cancel'), cancelLabel: t('bk.cKeep', 'Keep booking')
    }).then(function (ok) {
      if (!ok) return false;
      var now = new Date().toISOString();
      var c = { requestedAt: now, refundAmount: amt || 0, pct: rf.pct || 0, status: 'processing', eta: ymdPlus(now, 7), stage: 0, times: [now], reviewByHuman: amt == null };
      update(ref, function (bb) { bb.status = 'cancelled'; bb.cancellation = c; bb.cancelledAt = now; });
      OT.store.update('cancellations', function (l) { return (l || []).concat([{ ref: ref, partnerId: b.partnerId, title: b.title, amount: b.amount, refundAmount: c.refundAmount, requestedAt: now, status: 'processing', stage: 0, lang: OT.i18n.lang() }]); });
      OT.store.update('journey', function (j) {
        if (j && j.items) j.items.forEach(function (i) { if (i.id === b.itemId) i.status = 'cancelled'; });
        if (j && b.type === 'train' && j.pnr && j.pnr === b.pnr) j.train.status = 'CANCELLED';
        // v1.2.1: the return train is cancelled on its own; the outward PNR and the rest of the trip stay as they are
        if (j && b.type === 'train' && j.returnTrain && j.returnTrain.pnr === b.pnr) j.returnTrain.status = 'CANCELLED';
        return j;
      });
      if (amt == null) OT.agents.createTicket({ category: 'refund', subject: 'Refund review: policy missing', bookingRef: ref, source: 'bookings' });
      OT.toast(t('bk.cancelled', 'Cancelled. Refund {a} requested.', { a: OT.inr(c.refundAmount) }), 'success');
      filter = 'all';
      if (root) render(root);
      return true;
    });
  }

  function ticketModal(ref) {
    var cats = [['refund', 'tk.refund', 'Refund'], ['cancel', 'tk.cancel', 'Cancellation'], ['service', 'tk.service', 'Hotel / cab service issue'], ['payment', 'tk.payment', 'Payment'], ['other', 'tk.other', 'Other']];
    OT.modal({
      title: t('tk.title', 'Raise a support ticket'),
      body: '<p class="small muted">' + OT.esc(t('tk.note', 'A human agent replies in your selected language: {lang} (sample SLA 2 h).', { lang: OT.lang.info(OT.i18n.lang()).native })) + '</p>' +
        (ref ? '<p class="small">' + OT.esc(t('itin.ref', 'Ref')) + ': ' + keep(ref) + '</p>' : '') +
        '<div class="field"><label for="tk-cat">' + OT.esc(t('tk.cat', 'Category')) + '</label><select id="tk-cat" class="input">' + cats.map(function (c) { return '<option value="' + c[0] + '">' + OT.esc(t(c[1], c[2])) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field mt8"><label for="tk-msg">' + OT.esc(t('tk.msg', 'Describe the issue')) + '</label><textarea id="tk-msg" class="input" rows="3"></textarea></div>',
      actions: [
        { label: t('common.cancel', 'Cancel'), kind: 'ghost' },
        { label: t('tk.submit', 'Create ticket'), kind: 'primary', onClick: function (close) {
          var cat = document.getElementById('tk-cat').value, msg = document.getElementById('tk-msg').value.trim();
          var tk = OT.agents.createTicket({ category: cat, subject: t('tk.subject', 'Traveller ticket: {c}', { c: cat }), message: msg, bookingRef: ref || null, source: 'bookings' });
          close();
          OT.toast(t('tk.created', 'Ticket {id} created. A human agent will reply.', { id: tk.id }), 'success');
          if (root) render(root);
        } }
      ]
    });
  }

  OT.registerView('bookings', {
    title: function () { return OT.t('bk.title', 'Bookings & refunds'); },
    section: 'bookings',
    render: render,
    onLeave: function () { timers.forEach(clearTimeout); timers = []; root = null; },
    cancel: cancel
  });
})();
