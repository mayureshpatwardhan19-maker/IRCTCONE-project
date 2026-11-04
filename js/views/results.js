/* IRCTC OneTrip — Results: live Agent Trace -> verified recommendations (hotels, cabs, food, sightseeing),
 * price comparison, source + checked time, add to journey. (Builder A)
 */
(function () {
  'use strict';
  var OT = window.OT;
  var D = function () { return OT.data.travel; };
  var root = null, token = 0;
  var TYPES = ['hotel', 'cab', 'food', 'sight'];
  var TAB_KEYS = { hotel: ['tabs.hotel', 'Hotels'], cab: ['tabs.transport', 'Transport'], food: ['tabs.food', 'Food'], sight: ['tabs.sight', 'Sightseeing'] };
  var TAB_ICON = { hotel: 'hotel', cab: 'bus', food: 'food', sight: 'sight' };

  function t(k, fb, v) { return OT.t(k, fb, v); }
  function line(l) { return OT.lang.highlight(t(l.key, l.en, l.vars)); }
  function L() { return OT.i18n.lang(); }

  /* ---------------- Agent Trace ---------------- */
  function stepHTML(s) {
    var def = OT.agents.defs[s.agent] || {};
    var stIcon = s.status === 'running' ? '<span class="spinner" aria-hidden="true"></span>' : OT.icon(s.status === 'warn' ? 'alert' : 'checkCircle', 16);
    var stLbl = s.status === 'running' ? t('tr.running', 'running') : s.status === 'warn' ? t('tr.flagged', 'flagged') : t('tr.done', 'done');
    return '<li class="tr-step is-' + s.status + '" data-agent="' + s.agent + '">' +
      '<span class="tr-av av-' + s.agent + '" aria-hidden="true">' + OT.icon(def.icon || 'bot', 16) + '</span>' +
      '<div class="tr-body">' +
      '<div class="tr-head"><strong>' + OT.esc(OT.agents.name(s.agent)) + '</strong>' +
      '<span class="tr-state" title="' + OT.esc(stLbl) + '">' + stIcon + '<span class="sr-only">' + OT.esc(stLbl) + '</span></span>' +
      (s.ms != null && s.status !== 'running' ? '<span class="tr-ms"><bdi class="keep">' + s.ms + '</bdi> ms</span>' : '') + '</div>' +
      '<div class="tr-title">' + line(s.title) + '</div>' +
      (s.lines && s.lines.length ? '<ul class="tr-lines">' + s.lines.map(function (l) {
        var cls = l.kind ? (l.kind === 'soldout' ? 'fl-bad' : 'fl-warn') : '';
        return '<li class="' + cls + '">' + (l.kind ? OT.icon(l.kind === 'soldout' ? 'xCircle' : 'alert', 13) + ' ' : '') + line(l) + '</li>';
      }).join('') + '</ul>' : '') +
      (s.tool ? '<details class="tr-tool"><summary>' + OT.icon('spark', 13) + ' ' + OT.esc(t('tr.toolCall', 'Tool call (JSON)')) + '</summary><pre>' + OT.esc(JSON.stringify(s.tool, null, 2)) + '</pre></details>' : '') +
      '</div></li>';
  }

  function traceHTML(run, steps, done) {
    var ai = OT.gemini && OT.gemini.available();
    return '<div class="trace-head">' +
      '<h2 class="h3">' + OT.icon('layers', 18) + ' ' + OT.esc(t('tr.title', 'Agent Trace')) + '</h2>' +
      '<span class="badge ' + (ai ? 'b-ok' : 'b-sim') + '">' + OT.icon(ai ? 'spark' : 'flag', 12) + '<span>' + OT.esc(ai ? t('asst.mode.live', 'Gemini live') : t('asst.mode.sim', 'Simulated agents')) + '</span></span>' +
      '</div>' +
      '<p class="xs muted trace-sub">' + OT.esc(t('tr.sub', 'Orchestrator → specialist agents. Agents propose; you confirm.')) + '</p>' +
      '<div class="autonomy" aria-label="' + OT.esc(t('tr.autonomyLbl', 'Degree of autonomy')) + '">' +
      '<span class="on">' + OT.esc(t('tr.assist', 'Assist')) + '</span><span class="on">' + OT.esc(t('tr.propose', 'Propose')) + '</span><span class="off">' + OT.icon('lock', 11) + ' ' + OT.esc(t('tr.act', 'Act needs your OK')) + '</span></div>' +
      '<ol class="tr-list">' + steps.map(stepHTML).join('') + '</ol>' +
      (done ? '<p class="trace-total xs">' + OT.icon('clock', 13) + ' ' + OT.esc(t('tr.total', '{n} agent steps in {ms} ms', { n: steps.length, ms: run.ms })) + '</p>' : '');
  }

  /* ---------------- Offer cards ---------------- */
  function basisLabel(b) {
    return t({ night: 'res.perNight', trip: 'res.perTrip', person: 'res.perPerson', bag: 'res.perBag' }[b] || 'res.perTrip',
      { night: 'per night', trip: 'per trip', person: 'per person', bag: 'per bag/day' }[b] || '');
  }
  function inJourney(refId) {
    var j = OT.store.get('journey');
    return j && (j.items || []).filter(function (i) { return i.refId === refId && i.status !== 'cancelled'; })[0];
  }
  function descOf(x) { return (x.desc && (x.desc[L()] || x.desc.en)) || ''; }

  function compareHTML(v) {
    var x = v.item;
    if (!x.compare || !x.compare.length || !v.livePrice) return '';
    var rows = [{ name: t('res.onetrip', 'OneTrip (verified)'), price: v.livePrice, me: true }].concat(x.compare);
    var max = Math.max.apply(null, rows.map(function (r) { return r.price; }));
    var others = x.compare.map(function (c) { return c.price; });
    var save = Math.min.apply(null, others) - v.livePrice;
    return '<div class="compare"><div class="compare-head xs"><strong>' + OT.esc(t('res.compare', 'Price comparison')) + '</strong>' + OT.simTag() +
      (save > 0 ? '<span class="save">' + OT.esc(t('res.save', 'Saves {s} vs next best', { s: OT.inr(save) })) + '</span>' : '') + '</div>' +
      rows.map(function (r) {
        return '<div class="cmp-row' + (r.me ? ' me' : '') + '"><span class="cmp-name">' + OT.esc(r.name) + '</span>' +
          '<span class="cmp-bar"><i style="width:' + Math.max(8, Math.round(r.price / max * 100)) + '%"></i></span>' +
          '<bdi class="keep cmp-val">' + OT.esc(OT.inr(r.price)) + '</bdi></div>';
      }).join('') + '</div>';
  }

  function verifLog(v) {
    return '<details class="verif"><summary>' + OT.icon('shield', 13) + ' ' + OT.esc(t('res.verifLog', 'Verification log')) +
      ' <span class="xs muted">(' + v.checks.length + ' ✓' + (v.flags.length ? ' · ' + v.flags.length + ' ⚠' : '') + ')</span></summary><ul>' +
      v.checks.map(function (c) { return '<li class="ok">' + OT.icon('check', 13) + ' ' + line(c) + '</li>'; }).join('') +
      v.flags.map(function (f) { return '<li class="' + (f.kind === 'soldout' ? 'bad' : 'warn') + '">' + OT.icon('alert', 13) + ' ' + line(f) + '</li>'; }).join('') +
      '<li class="xs muted">' + OT.esc(t('res.provSrc', 'Provider source: {s}', { s: v.item.providerSource.name })) + '</li>' +
      '</ul></details>';
  }

  function cardHTML(v, run, opts) {
    opts = opts || {};
    var x = v.item, added = opts.standalone ? opts.added : inJourney(x.id);
    var meter = OT.data.transport && OT.data.transport.isMeter(x);
    var meterOn = meter && OT.meter && OT.meter.list().some(function (r) { return r.refId === x.id; });
    var priceChanged = !meter && v.livePrice !== x.price;
    var labels = [];
    labels.push(x.managed === 'irctc' ? '<span class="lbl lbl-irctc">' + OT.esc(t('res.irctc', 'IRCTC-managed')) + '</span>' : '<span class="lbl">' + OT.esc(t('res.partner', 'Partner offer')) + '</span>');
    if (x.sponsored) labels.push('<span class="lbl lbl-spon">' + OT.esc(t('res.sponsored', 'Sponsored')) + '</span>');
    var facts = [];
    facts.push(x.rating != null ? '<li>' + OT.icon('star', 14) + ' <strong>' + Number(x.rating).toFixed(1) + '</strong> <span class="muted">· ' + OT.esc(t('res.reviews', '{n} reviews', { n: x.reviews.toLocaleString('en-IN') })) + '</span></li>'
      : (x.providerSource.ratingNotApplicable ? '' : '<li class="muted">' + OT.icon('star', 14) + ' ' + OT.esc(t('res.noRating', 'Rating unavailable at source')) + '</li>'));
    if (v.verdict === 'confirm' && v.flags.some(function (f) { return f.kind === 'rating'; }) && x.rating != null) facts[0] = '<li class="muted">' + OT.icon('star', 14) + ' ' + OT.esc(t('res.noRating', 'Rating unavailable at source')) + '</li>';
    if (x.distanceKm != null) facts.push('<li>' + OT.icon('pin', 14) + ' ' + OT.esc(t('res.dist', '{d} km from station', { d: x.distanceKm })) + '</li>');
    if (x.type === 'hotel') facts.push('<li>' + OT.icon('clock', 14) + ' ' + OT.esc(t('res.checkin', 'Check-in')) + ' <bdi class="keep">' + x.checkIn + '</bdi> · ' + OT.esc(t('res.checkout', 'out')) + ' <bdi class="keep">' + x.checkOut + '</bdi></li>');
    if (x.type === 'cab') facts.push('<li>' + OT.icon('cab', 14) + ' ' + OT.esc(x.vehicle) + '</li>', '<li>' + OT.icon('clock', 14) + ' ' + OT.esc(x.meet) + '</li>');
    if ((x.type === 'food' || x.type === 'sight') && x.slot) facts.push('<li>' + OT.icon('clock', 14) + ' ' + OT.esc(t('res.slot', 'Suggested time')) + ' <bdi class="keep">' + x.slot + '</bdi>' + (x.onTrain ? ' · <bdi class="keep">' + x.at + '</bdi>' : '') + '</li>');
    facts.push('<li>' + OT.icon('checkCircle', 14) + ' ' + OT.esc(x.availability === 'few' ? t('res.few', 'Only {n} left', { n: x.left || 1 }) : t('res.avail', 'Available')) + '</li>');

    return '<article class="offer' + (v.top ? ' is-top' : '') + '" data-ref="' + x.id + '" data-verdict="' + v.verdict + '">' +
      '<div class="offer-top">' +
      '<span class="offer-ic">' + OT.icon(OT.itemIcon(x), 22) + '</span>' +
      '<div class="offer-title"><h3>' + OT.esc(x.name) + '</h3><div class="offer-prov small">' + OT.esc(x.provider) + ' ' + labels.join(' ') + '</div></div>' +
      (meter ? '<div class="offer-price"><div class="price"><bdi class="keep">≈ ' + OT.esc(OT.inr(v.livePrice)) + '</bdi></div><div class="xs muted">' + OT.esc(t('tx.boothFare', 'fixed fare at the booth · no online booking')) + '</div>' + OT.simTag() + '</div>' :
      '<div class="offer-price"><div class="price"><bdi class="keep">' + OT.esc(x.price === 0 && v.livePrice === 0 ? t('res.free', 'Free') : OT.inr(v.livePrice)) + '</bdi></div>' +
      '<div class="xs muted">' + OT.esc(basisLabel(x.basis)) + ' · ' + OT.esc(t('res.inclTax', 'incl. GST')) + '</div>' + OT.simTag() + '</div>') +
      '</div>' +
      '<div class="offer-badges">' + OT.badge(v.verdict) + (v.top ? '<span class="badge b-top">' + OT.icon('target', 12) + '<span>' + OT.esc(t('res.topPick', 'Top verified pick')) + '</span></span>' : '') +
      (v.lifted ? '<span class="xs muted">' + OT.esc(t('res.lifted', 'Sponsored: moved up one slot (max allowed)')) + '</span>' : '') + '</div>' +
      (priceChanged ? '<div class="note note-warn small">' + OT.icon('alert', 14) + ' ' + OT.lang.highlight(t('res.priceChanged', 'Listing said {a}; provider now shows {b}. You will be asked to accept {b} before paying.', { a: OT.inr(x.price), b: OT.inr(v.livePrice) })) + '</div>' : '') +
      (v.flags.some(function (f) { return f.kind === 'stale'; }) ? '<div class="note note-warn small">' + OT.icon('clock', 14) + ' ' + OT.esc(t('res.staleNote', 'Data is more than 6 h old.')) + ' <button type="button" class="btn-link small" data-recheck="' + x.id + '">' + OT.esc(t('res.recheck', 'Re-check now')) + '</button></div>' : '') +
      '<p class="offer-desc small" lang="' + (x.desc && x.desc[L()] ? L() : 'en') + '">' + OT.lang.highlight(descOf(x)) + '</p>' +
      '<ul class="offer-facts small">' + facts.join('') + '</ul>' +
      (v.reasons && v.reasons.length ? '<div class="why"><span class="xs muted">' + OT.esc(t('res.why', 'Why this?')) + '</span>' + v.reasons.map(function (r) { return '<span class="why-chip">' + line(r) + '</span>'; }).join('') + '</div>' : '') +
      (meter ? '<p class="note small tx-meter" data-meter-note>' + OT.icon('info', 14) + ' <span>' + OT.esc(t('tx.meterBooth', 'No booking needed: {meet}. Pay at the booth or to the driver.', { meet: x.meet || '' })) + '</span></p>' :
      '<div class="policy small">' + OT.icon('refund', 14) + ' <span>' + OT.lang.highlight(OT.agents.policyText(x.policy)) + '</span>' +
      (L() !== 'en' ? ' <span class="xs muted">(' + OT.esc(t('res.policyVerified', 'reviewed translation')) + ')</span>' : '') + '</div>' +
      compareHTML(v)) +
      verifLog(v) +
      '<div class="source-line">' + OT.icon('info', 12) + '<span>' + OT.esc(t('res.source', 'Source')) + ': ' + OT.esc(x.source.name) + '</span><span><bdi class="keep">' + OT.esc(x.source.ref) + '</bdi></span>' +
      '<span>' + OT.esc(t('res.checked', 'checked')) + ' ' + OT.esc(OT.stamp(new Date(v.sourceCheckedAt))) + ' (' + OT.esc(OT.agents.time.agoLabel(v.sourceCheckedAt)) + ')</span></div>' +
      (meter ? '<div class="offer-actions">' + (opts.standalone ? '<span class="badge b-info">' + OT.icon('info', 12) + '<span>' + OT.esc(t('tx.meterBadge', 'Pay on meter')) + '</span></span>' :
        meterOn ? '<button type="button" class="btn btn-ghost btn-sm added" data-meter-off="' + x.id + '">' + OT.icon('check', 15) + OT.esc(t('tx.meterPlanned', 'In your plan · pay on meter')) + ' · ' + OT.esc(t('common.remove', 'Remove')) + '</button>'
          : '<button type="button" class="btn btn-ghost btn-sm" data-meter-ref="' + x.id + '">' + OT.esc(t('tx.takeAuto', 'I’ll take an auto')) + '</button>') +
        (opts.standalone ? '' : '<button type="button" class="btn btn-link small" data-dismiss="' + x.id + '">' + OT.esc(t('res.dismiss', 'Not for me')) + '</button>') + '</div></article>' :
      opts.standalone ? '<div class="offer-actions">' +
        '<button type="button" class="btn btn-accent btn-sm" data-book-now="' + x.id + '">' + OT.icon('wallet', 15) + OT.esc(t('svc.bookNow', 'Book now')) + '</button>' +
        (added ? '<span class="badge b-ok">' + OT.icon('check', 12) + '<span>' + OT.esc(t('svc.inTrip', 'In your trip')) + '</span></span>' : '<button type="button" class="btn btn-ghost btn-sm" data-add-trip="' + x.id + '">' + OT.icon('plus', 15) + OT.esc(t('svc.addTrip', 'Add to trip')) + '</button>') + '</div></article>' :
      '<div class="offer-actions">' +
      (added ? '<button type="button" class="btn btn-ghost btn-sm added" data-remove="' + x.id + '">' + OT.icon('check', 15) + OT.esc(t('res.added', 'Added')) + ' · ' + OT.esc(t('common.remove', 'Remove')) + '</button>'
        : '<button type="button" class="btn btn-primary btn-sm" data-add="' + x.id + '">' + OT.icon('plus', 15) + OT.esc(t('res.add', 'Add to journey')) + '</button>') +
      '<button type="button" class="btn btn-link small" data-dismiss="' + x.id + '">' + OT.esc(t('res.dismiss', 'Not for me')) + '</button>' +
      '</div></article>');
  }

  function hiddenHTML(run, type) {
    var hid = run.rec.hidden.filter(function (h) { return h.v.item.type === type; });
    var fil = run.rec.filtered.filter(function (h) { return h.v.item.type === type; });
    if (!hid.length && !fil.length) return '';
    return '<details class="hidden-list card-flat"><summary>' + OT.icon('eye', 15) + ' ' + OT.esc(t('res.hiddenTitle', 'Hidden or filtered by agents ({n})', { n: hid.length + fil.length })) + '</summary><ul>' +
      hid.map(function (h) { return '<li>' + OT.badge('unavailable') + ' <strong>' + OT.esc(h.v.item.name) + '</strong>: ' + OT.esc(t('res.hidSold', 'sold out at provider source (Verification Agent)')) + '</li>'; }).join('') +
      fil.map(function (h) {
        var why = h.reason === 'budget' ? t('res.hidBudget', '{p} is over your {b} budget (Recommendation Agent)', { p: OT.inr(h.v.item.price), b: OT.inr(run.intent.budget) }) : h.reason === 'budgetMin' ? t('res.hidBudgetMin', '{p} is below your minimum {b}', { p: OT.inr(h.v.livePrice), b: OT.inr(run.intent.budgetMin) }) : t('res.hidDismissed', 'dismissed by you');
        return '<li><span class="badge b-info">' + OT.icon('filter', 12) + '<span>' + OT.esc(h.reason !== 'dismissed' ? t('res.filtered', 'Filtered') : t('res.dismissed', 'Dismissed')) + '</span></span> <strong>' + OT.esc(h.v.item.name) + '</strong>: ' + OT.lang.highlight(why) +
          (h.reason === 'dismissed' ? ' <button type="button" class="btn-link small" data-undismiss="' + h.v.item.id + '">' + OT.esc(t('res.undo', 'Undo')) + '</button>' : '') + '</li>';
      }).join('') + '</ul></details>';
  }

  function trayHTML() {
    var j = OT.store.get('journey');
    if (!j) return '';
    var n = (j.items || []).filter(function (i) { return i.status !== 'cancelled'; }).length;
    var r = OT.agents.readiness(j).score;
    return '<div class="tray-in container"><span class="tray-ring" style="--p:' + r + '"><bdi>' + r + '%</bdi></span>' +
      '<span class="small"><strong>' + OT.esc(t('nav.journey', 'My Journey')) + '</strong> · ' + OT.esc(t('res.trayItems', '{n} item(s) · Trip Readiness {r}%', { n: n, r: r })) + '</span>' +
      '<a class="btn btn-accent btn-sm" href="#/journey">' + OT.esc(t('res.viewJourney', 'View journey')) + OT.icon('arrowRight', 15) + '</a></div>';
  }

  function summaryHTML(run) {
    var lang = L();
    var text = OT.agents.summarize(run, lang), en = OT.agents.summarize(run, 'en');
    var covered = lang === 'en' || OT.i18n.has('res.summary', lang);
    var tb = OT.lang.translatedBlock({ text: text, original: lang === 'en' ? null : en, origLang: 'en', lang: lang, engine: lang === 'en' ? 'none' : covered ? 'template' : 'unavailable', confidence: lang === 'en' ? 1 : covered ? 0.95 : 0.4 });
    var tr = run.translation || {};
    return '<div class="summary card">' +
      '<div class="summary-q"><span class="xs muted">' + OT.esc(t('res.youAsked', 'You asked')) + ' · ' + OT.esc(OT.lang.info(run.detected ? run.detected.code : lang).native) + '</span>' +
      '<p class="q-text" lang="' + OT.esc(run.detected ? run.detected.code : lang) + '">“' + OT.lang.highlight(run.query) + '”</p>' +
      (tr.text && tr.text !== run.query ? '<p class="xs muted">' + OT.icon('globe', 12) + ' ' + OT.esc(t('res.nmtEn', 'Agents worked on (English)')) + ': ' + OT.lang.highlight(tr.text) + '</p>' : '') + '</div>' +
      '<div class="summary-a">' + OT.icon('bot', 20) + '<div>' + tb + '</div>' +
      '<button type="button" class="icon-btn speak-btn" id="speak-sum" aria-label="' + OT.esc(t('res.listen', 'Listen')) + '" title="' + OT.esc(t('res.listen', 'Listen')) + '">' + OT.icon('speaker', 20) + '</button></div>' +
      (!covered ? '<p class="xs tb-warn">' + OT.icon('info', 12) + ' ' + OT.esc(t('res.langPartial', 'This language has partial coverage in the prototype: some text is shown in English.')) + '</p>' : '') +
      '</div>';
  }

  function resultsHTML(run) {
    var tab = OT.state.resTab || 'hotel';
    var rec = run.rec.byType;
    return summaryHTML(run) +
      '<div class="tabs" role="tablist">' + TYPES.map(function (ty) {
        return '<button type="button" role="tab" class="tab" data-tab="' + ty + '" aria-selected="' + (ty === tab) + '">' + OT.icon(TAB_ICON[ty], 15) + ' ' + OT.esc(t(TAB_KEYS[ty][0], TAB_KEYS[ty][1])) + ' <span class="tab-n">' + rec[ty].length + '</span></button>';
      }).join('') + '</div>' +
      TYPES.map(function (ty) {
        return '<div class="tab-panel" role="tabpanel" data-panel="' + ty + '"' + (ty === tab ? '' : ' hidden') + '>' +
          (ty === 'cab' ? legHTML(run) + (rec[ty].length ? '<h3 class="h4 tx-more">' + OT.icon('cab', 16) + ' ' + OT.esc(t('tx.moreCabs', 'More cab offers (day trips, transfers)')) + '</h3>' : '') : '') +
          (ty === 'hotel' ? '<p class="xs muted bud-inline">' + OT.icon('rupee', 12) + ' ' + OT.esc(t('res.budgetShown', 'Showing hotels for {b} per night', { b: OT.budget.text(run.intent.budgetMin || OT.budget.MIN, run.intent.budget || OT.budget.MAX) })) + '</p>' : '') +
          (rec[ty].length ? rec[ty].map(function (v) { return cardHTML(v, run); }).join('') : '<p class="muted">' + OT.esc(t('res.none', 'No verified options in this category.')) + '</p>') +
          hiddenHTML(run, ty) + '</div>';
      }).join('');
  }

  /* Station → hotel leg: every local mode side by side (replaces "cabs only" in the journey flow). */
  var lastLeg = null;
  function legHTML(run) {
    var j = OT.store.get('journey');
    if (!j || !OT.transportUI || !OT.data.transport) return '';
    var to = run.intent.to;
    var hotel = (j.items || []).filter(function (i) { return i.type === 'hotel' && i.status !== 'cancelled'; })[0];
    var top = run.rec.byType.hotel[0];
    var ref = hotel ? hotel.refId : top && top.item.id;
    var u = OT.store.get('user') || {}, per = u.personaId && OT.data.personas ? OT.data.personas.get(u.personaId) : null;
    lastLeg = j.train ? OT.data.transport.stationLeg(to, ref, j, per || u) : OT.data.transport.compare({ city: to, from: 'stn:' + to, to: ref ? 'htl:' + ref : null, time: '12:00', pax: j.passengers, persona: per || u });
    var sel = {}; (j.items || []).forEach(function (i) { if (i.status !== 'cancelled') sel[i.refId] = true; });
    return OT.transportUI.html(lastLeg, { action: 'select', selected: sel, title: j.train ? t('tx.arrivalTitle', 'Station → hotel: compare every way to get there') : null });
  }

  function skeleton() {
    return '<div class="summary card skel"><div class="sk-line w60"></div><div class="sk-line w90"></div></div>' +
      '<p class="small muted working">' + '<span class="spinner"></span> ' + OT.esc(t('res.working', 'Agents are researching and verifying…')) + '</p>' +
      [1, 2, 3].map(function () { return '<div class="offer skel"><div class="sk-line w40"></div><div class="sk-line w80"></div><div class="sk-line w60"></div></div>'; }).join('');
  }

  /* ---------------- actions ---------------- */
  function addItem(refId, opts) {
    opts = opts || {};
    var run = OT.state.lastRun, x = D().get(refId);
    var j = OT.store.get('journey');
    if (!x || !j) return null;
    if (OT.data.transport.isMeter(x)) {   // v1.2.1: autos are never booked; mark "I'll take an auto" instead (pay on meter)
      var r = OT.meter.add(OT.meter.fromItem(x, j));
      if (!opts.quiet) OT.toast(t('tx.meterAdded', '{name} added to your plan: {approx}, pay the driver. Nothing is charged here.', { name: r.title, approx: OT.meter.approx(r) }), 'success');
      refresh();
      return null;
    }
    var v = OT.agents.verifyOne(x);
    if (v.verdict === 'unavailable') { OT.toast(t('res.cannotAdd', 'This option is unavailable at source.'), 'error'); return null; }
    var slot = OT.agents.slotFor(x, j);
    var replaced = null;
    if (OT.meter) { var mr = OT.meter.dropLeg(x.legKey, x); if (mr) { replaced = mr.title; j = OT.store.get('journey'); } }
    j.items = j.items || [];
    if (x.type === 'hotel') {
      j.items = j.items.filter(function (i) {
        if (i.type === 'hotel' && i.status === 'selected') { replaced = i.title; return false; } return true;
      });
    }
    if (x.legKey) {   // one mode per leg: picking the bus replaces a previously selected cab for the same leg
      j.items = j.items.filter(function (i) { var y = D().get(i.refId); if (i.status === 'selected' && y && y.legKey === x.legKey) { replaced = i.title; return false; } return true; });
    }
    var item = { id: OT.uid('IT'), type: x.type, refId: x.id, partnerId: x.partnerId, title: x.name, provider: x.provider, price: v.livePrice,
      listedPrice: x.price, when: slot.when, endWhen: slot.endWhen, status: 'selected', verification: v.verdict, city: x.city, addedAt: new Date().toISOString(),
      priceAccepted: v.livePrice === x.price };
    if (x.leg && x.basis === 'person') item.pax = j.passengers;
    j.items.push(item);
    OT.store.set('journey', j);
    var r = OT.agents.readiness(j).score;
    if (!opts.quiet) OT.toast(replaced ? t('res.replaced', '{a} replaced {b} · Trip Readiness {r}%', { a: x.name, b: replaced, r: r }) : t('res.addedToast', 'Added to My Journey · Trip Readiness {r}%', { r: r }), 'success');
    refresh();
    return item;
  }
  function removeItem(refId) {
    OT.store.update('journey', function (j) { j.items = (j.items || []).filter(function (i) { return !(i.refId === refId && i.status === 'selected'); }); return j; });
    refresh();
  }
  /** Re-apply the visible budget range (no new agent run): recommend again and update "x of y hotels within budget". */
  function applyBudget(run) {
    var j = OT.store.get('journey') || {};
    run.intent.budget = j.budget || OT.budget.MAX; run.intent.budgetMin = j.budgetMin || 0;
    run.rec = OT.agents.recommend(run.verified, run.intent);
    if (root) {
      var avail = run.verified.filter(function (v) { return v.item.type === 'hotel' && v.verdict !== 'unavailable'; }).length;
      OT.budget.count(root, 'rb', run.rec.byType.hotel.length, avail);
    }
  }
  function refresh() {
    if (!root || !OT.state.lastRun) return;
    var main = root.querySelector('#res-main');
    if (main) { var y = window.scrollY; main.innerHTML = resultsHTML(OT.state.lastRun); bindMain(); window.scrollTo(0, y); }
    var tray = root.querySelector('#res-tray'); if (tray) tray.innerHTML = trayHTML();
  }
  function setTab(ty) {
    OT.state.resTab = ty;
    if (!root) return;
    OT.$$('[data-tab]', root).forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === ty ? 'true' : 'false'); });
    OT.$$('[data-panel]', root).forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== ty; });
  }

  function bindMain() {
    if (!root) return;
    var main = root.querySelector('#res-main');
    OT.$$('[data-tab]', main).forEach(function (b) { b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); }); });
    OT.$$('[data-add]', main).forEach(function (b) { b.addEventListener('click', function () { addItem(b.getAttribute('data-add')); }); });
    OT.$$('[data-remove]', main).forEach(function (b) { b.addEventListener('click', function () { removeItem(b.getAttribute('data-remove')); }); });
    OT.$$('[data-dismiss]', main).forEach(function (b) {
      b.addEventListener('click', function () {
        OT.state.dismissed = OT.state.dismissed || {}; OT.state.dismissed[b.getAttribute('data-dismiss')] = true;
        var run = OT.state.lastRun; run.rec = OT.agents.recommend(run.verified, run.intent); refresh();
        OT.toast(t('res.dismissedToast', 'Dismissed. It will not be shown again this session.'), 'info');
      });
    });
    OT.$$('[data-undismiss]', main).forEach(function (b) {
      b.addEventListener('click', function () {
        delete OT.state.dismissed[b.getAttribute('data-undismiss')];
        var run = OT.state.lastRun; run.rec = OT.agents.recommend(run.verified, run.intent); refresh();
      });
    });
    OT.$$('[data-recheck]', main).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-recheck');
        b.disabled = true; b.textContent = t('res.rechecking', 'Re-checking…');
        OT.sleep(700).then(function () {
          OT.agents.recheck(id);
          var run = OT.state.lastRun;
          run.verified = run.verified.map(function (v) { return v.item.id === id ? OT.agents.verifyOne(v.item) : v; });
          run.rec = OT.agents.recommend(run.verified, run.intent);
          OT.store.update('journey', function (j) { (j.items || []).forEach(function (i) { if (i.refId === id && i.status === 'selected') i.verification = OT.agents.verifyOne(D().get(id)).verdict; }); return j; });
          refresh();
          OT.toast(t('res.recheckedToast', 'Re-checked at source just now.'), 'success');
        });
      });
    });
    if (lastLeg && OT.transportUI) { var pick = function (o) { addItem(o.item.id); }; pick.meter = function () { refresh(); }; OT.transportUI.bind(main, lastLeg, pick); }
    OT.$$('[data-meter-ref]', main).forEach(function (b) { b.addEventListener('click', function () { addItem(b.getAttribute('data-meter-ref')); }); });
    OT.$$('[data-meter-off]', main).forEach(function (b) {
      b.addEventListener('click', function () {
        var r = OT.meter.list().filter(function (m) { return m.refId === b.getAttribute('data-meter-off'); })[0];
        if (r) OT.meter.remove(r.id);
        refresh();
      });
    });
    var sp = root.querySelector('#speak-sum');
    if (sp) sp.addEventListener('click', function () { OT.lang.speak(OT.agents.summarize(OT.state.lastRun, L()), L()); });
  }

  /** A long-weekend package booked from "For you": once the train is booked, add its hotel, cab and sight. */
  function applyPackage(to) {
    var pk = OT.state.applyPackage;
    if (!pk || pk.to !== to) return;
    OT.state.applyPackage = null;
    var j = OT.store.get('journey');
    if (j && pk.nights) OT.store.update('journey', function (x) { x.nights = pk.nights; return x; });
    var added = [];
    [pk.hotel, pk.cab, pk.sight].forEach(function (ref) {
      if (!ref) return;
      var jj = OT.store.get('journey');
      if (jj && (jj.items || []).some(function (i) { return i.refId === ref && i.status !== 'cancelled'; })) return;
      var it = addItem(ref, { quiet: true }); if (it) added.push(it.title);
    });
    if (added.length) { OT.toast(t('res.pkgAdded', 'Package added to My Journey: {list}', { list: added.join(', ') }), 'success'); refresh(); }
  }

  function render(el, params) {
    root = el;
    var q = params.query || {};
    var j = OT.store.get('journey');
    var to = q.to || (j && j.scenario) || 'CDG';
    if (!D().stations[to]) to = 'CDG';
    if (D().ensureCity) D().ensureCity(to);
    var isTrip = j && !j.train && j.kind === 'trip' && j.scenario === to;
    if (!isTrip && (!j || !j.train || (j.scenario !== to && j.train.to !== to))) { j = D().scenarios[to] ? D().makeJourney(to, {}) : D().plannedJourney(to, {}); OT.store.set('journey', j); }
    if (q.max || q.min) { OT.store.update('journey', function (x) { if (q.max) x.budget = +q.max; if (q.min) x.budgetMin = +q.min; return x; }); j = OT.store.get('journey'); }
    var lang = L();
    var query = q.q || t('search.autoQuery', 'Hotel, cab, food and sightseeing near {city} station within {budget}', { city: D().stationName(to, lang), budget: OT.inr(j.budget) });
    var key = [query, to, JSON.stringify(j.prefs)].join('|');
    var tr = j.train || { no: '', name: '', from: '', to: to, date: j.start || D().defaultDate(), status: 'NONE' };

    el.innerHTML = '<div class="container page results-page">' +
      '<div class="page-head"><div><p class="ot-eyebrow">' + (j.train ? OT.icon('train', 14) + ' <bdi class="keep">' + tr.no + '</bdi> ' + OT.esc(tr.name) + ' · <bdi class="keep">' + tr.from + '</bdi> → <bdi class="keep">' + tr.to + '</bdi> · <bdi class="keep">' + OT.esc(OT.fmtDate(tr.date)) + '</bdi>'
        : OT.icon('route', 14) + ' ' + OT.esc(OT.trip.title(j)) + ' · <bdi class="keep">' + OT.esc(OT.fmtDate(tr.date)) + '</bdi>') + '</p>' +
      '<h1>' + OT.esc(t('res.title', 'Verified options near {city}', { city: D().stationName(to, lang) })) + '</h1>' +
      '<p>' + OT.esc(t('res.sub', 'Every price and timing comes from a provider source with a check time. Nothing is invented.')) + '</p>' +
      (tr.status === 'PLANNED' ? '<p class="note note-warn small">' + OT.icon('train', 14) + ' ' + OT.esc(t('res.planned', 'Suggested train, not booked yet.')) + ' <a href="#/' + OT.trains.path({ from: tr.from, to: tr.to, date: tr.date, pax: j.passengers }) + '">' + OT.esc(t('res.bookTrain', 'Book the train first')) + '</a></p>' : '') + '</div>' +
      '<div class="row-wrap"><a class="btn btn-ghost btn-sm" href="#/home?to=' + to + '">' + OT.icon('edit', 15) + OT.esc(t('res.edit', 'Edit search')) + '</a>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="rerun">' + OT.icon('refresh', 15) + OT.esc(t('res.rerun', 'Run agents again')) + '</button></div></div>' +
      (OT.trainHold ? OT.trainHold.banner(j) : '') +
      '<div class="card res-filter" id="res-filter">' + OT.budget.html({ id: 'rb', lo: j.budgetMin || OT.budget.MIN, hi: j.budget || OT.budget.MAX }) + '</div>' +
      '<div class="res-grid">' +
      '<aside class="trace-panel card" id="trace" aria-live="polite" data-tour="trace"></aside>' +
      '<section class="res-main" id="res-main">' + skeleton() + '</section>' +
      '</div></div>' +
      '<div class="res-tray" id="res-tray">' + trayHTML() + '</div>';

    var traceEl = el.querySelector('#trace');
    el.querySelector('#rerun').addEventListener('click', function () { OT.state.lastRun = null; OT.router.render(); });
    OT.budget.bind(el, 'rb', function (lo, hi) {
      OT.store.update('journey', function (x) { if (x) { x.budget = hi; x.budgetMin = lo; } return x; });
      var run = OT.state.lastRun;
      if (run && run.done) { applyBudget(run); refresh(); }
    });

    var cached = OT.state.lastRun;
    if (cached && cached.done && cached.key === key) {
      applyBudget(cached);
      traceEl.innerHTML = traceHTML(cached, cached.steps, true);
      el.querySelector('#res-main').innerHTML = resultsHTML(cached);
      bindMain();
      applyPackage(to);
      return;
    }
    var my = ++token;
    OT.state.running = true;
    OT.state.resTab = 'hotel';
    traceEl.innerHTML = traceHTML({}, [], false);
    OT.agents.run(query, {
      lang: lang,
      intent: { to: to, budget: j.budget, budgetMin: j.budgetMin, prefs: j.prefs, nearStation: !!(j.prefs && j.prefs.nearStation), date: tr.date }, train: j.train, trip: !j.train,
      onStep: function (s, steps) {
        if (my !== token || !root) return;
        traceEl.innerHTML = traceHTML({}, steps, false);
        var list = traceEl.querySelector('.tr-list');
        if (list && window.innerWidth > 960) list.scrollTop = list.scrollHeight;
      }
    }).then(function (run) {
      run.key = key;
      OT.state.running = false;
      if (my !== token || !root) return;
      applyBudget(run);
      traceEl.innerHTML = traceHTML(run, run.steps, true);
      el.querySelector('#res-main').innerHTML = resultsHTML(run);
      bindMain();
      var tray = el.querySelector('#res-tray'); if (tray) tray.innerHTML = trayHTML();
      applyPackage(to);
    }).catch(function (e) {
      OT.state.running = false;
      console.error('[OT] agent run failed', e);
      if (my !== token || !root) return;
      el.querySelector('#res-main').innerHTML = '<div class="card empty-state">' + OT.icon('alert', 28) + '<p>' + OT.esc(t('res.failed', 'The agents could not finish. Please try again.')) + '</p></div>';
    });
  }

  OT.resultsUI = { card: function (v, opts) { return cardHTML(v, null, opts); } };

  OT.registerView('results', {
    title: function () { return OT.t('res.titleShort', 'Recommendations'); },
    section: 'home',
    render: render,
    onLeave: function () { token++; root = null; OT.state.running = false; },
    add: addItem,
    tab: setTab,
    applyBudget: applyBudget,
    refresh: refresh
  });
})();
