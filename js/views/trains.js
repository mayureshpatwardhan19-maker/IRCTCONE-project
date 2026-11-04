/* IRCTC OneTrip — v1.1 train search + booking (SIMULATED). Final booking happens on IRCTC.
 *   #/trains?from=CDG&to=CSMT&date=YYYY-MM-DD&cls=3A&pax=2[&heard=…]   search results, filters, sort
 *   #/trains/book?no=…&from=…&to=…&date=…&cls=…&pax=…                 passengers, fare, human-in-the-loop pay
 *   #/trains/ticket?pnr=…                                             e-ticket (CNF / RAC / WL + chance) -> plan the stay
 * v1.2.1 return trains (flight-style One way | Round trip):
 *   #/trains?…&trip=round&ret=YYYY-MM-DD                 outward list (step 1 of 2)
 *   #/trains?…&trip=round&ret=…&step=ret&ono=&ocls=      return list B → A on the return date (step 2 of 2)
 *   #/trains/book?…&rno=&rcls=&ret=                      one passenger form, one payment, two PNRs
 *   #/trains?from=B&to=A&date=…&attach=return            "Add return train" from My Journey: the booked train joins the SAME journey
 * Also exposes OT.trains.picker()/bindPicker() — the station typeahead (any script) used by home.
 */
(function () {
  'use strict';
  var OT = window.OT;
  var R = function () { return OT.data.rail; }, D = function () { return OT.data.travel; };
  var root = null, busy = false, method = 'upi';
  var filt = { slot: '', sort: 'dep', availOnly: false, showAll: false };
  function t(k, fb, v) { return OT.t(k, fb, v); }
  function L() { return OT.i18n.lang(); }
  function keep(v) { return OT.lang.keep(v); }
  function sname(code) { return D().stationName(code, L()); }
  function qs(o) { return Object.keys(o).filter(function (k) { return o[k] != null && o[k] !== ''; }).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&'); }
  function tomorrow() { var d = new Date(); d.setDate(d.getDate() + 1); return R().ymd(d); }
  function dur(m) { return Math.floor(m / 60) + ' ' + t('time.h', 'h') + ' ' + (m % 60) + ' ' + t('time.min', 'min'); }
  function wd(dateStr) { return R().parseYmd(dateStr).toLocaleDateString('en-IN', { weekday: 'short' }); }
  var DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  var SLOTS = [['', 'trn.anyTime', 'Any time'], ['0', 'trn.slot0', 'Early (00–06)'], ['1', 'trn.slot1', 'Morning (06–12)'], ['2', 'trn.slot2', 'Afternoon (12–18)'], ['3', 'trn.slot3', 'Night (18–24)']];
  var CLS_LIST = ['1A', '2A', '3A', '3E', 'SL', 'CC', 'EC'];

  /* ---------------- station typeahead ---------------- */
  function picker(id, code, label) {
    var s = code && D().stations[code];
    return '<div class="field st-pick" data-picker="' + id + '"><label for="' + id + '">' + OT.esc(label) + '</label>' +
      '<input id="' + id + '" class="input" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="' + id + '-list" ' +
      'placeholder="' + OT.esc(t('trn.pickPh', 'City or station, any language')) + '" value="' + (s ? OT.esc(sname(code) + ' (' + code + ')') : '') + '" data-code="' + OT.esc(code || '') + '">' +
      '<ul class="st-list" id="' + id + '-list" role="listbox" hidden></ul></div>';
  }
  function bindPicker(scope, id, onChange) {
    var inp = scope.querySelector('#' + id), list = scope.querySelector('#' + id + '-list');
    if (!inp || !list) return;
    var items = [], act = -1;
    function close() { list.hidden = true; inp.setAttribute('aria-expanded', 'false'); act = -1; }
    function pick(code) {
      inp.value = sname(code) + ' (' + code + ')'; inp.setAttribute('data-code', code); close();
      if (onChange) onChange(code);
    }
    function show() {
      var q = inp.value.replace(/\s*\([A-Z]+\)\s*$/, '');
      items = R().find(q === (inp.getAttribute('data-code') ? sname(inp.getAttribute('data-code')) : '') ? '' : q, L());
      list.innerHTML = items.map(function (s, i) {
        return '<li role="option" id="' + id + '-o' + i + '" data-code="' + s.code + '"' + (i === act ? ' aria-selected="true"' : '') + '><strong>' + OT.esc(sname(s.code)) + '</strong>' +
          (L() !== 'en' ? ' <span class="xs muted">' + OT.esc(s.names.en) + '</span>' : '') + ' <bdi class="keep">' + s.code + '</bdi></li>';
      }).join('') || '<li class="muted xs">' + OT.esc(t('trn.noStation', 'No station found')) + '</li>';
      list.hidden = false; inp.setAttribute('aria-expanded', 'true');
    }
    inp.addEventListener('focus', function () { inp.select(); show(); });
    inp.addEventListener('input', function () { inp.setAttribute('data-code', ''); act = -1; show(); });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (list.hidden) show(); act = Math.max(0, Math.min(items.length - 1, act + (e.key === 'ArrowDown' ? 1 : -1))); show(); }
      else if (e.key === 'Enter' && !list.hidden && items.length) { e.preventDefault(); pick(items[Math.max(0, act)].code); }
      else if (e.key === 'Escape') close();
    });
    inp.addEventListener('blur', function () {
      setTimeout(function () {
        if (!inp.getAttribute('data-code') && items.length && inp.value.trim()) pick(items[0].code);
        close();
      }, 160);
    });
    list.addEventListener('mousedown', function (e) { var li = e.target.closest('[data-code]'); if (li) { e.preventDefault(); pick(li.getAttribute('data-code')); } });
  }
  function codeOf(scope, id) { var i = scope.querySelector('#' + id); return i ? i.getAttribute('data-code') || '' : ''; }
  function setCode(scope, id, code) { var i = scope.querySelector('#' + id); if (i && code && D().stations[code]) { i.setAttribute('data-code', code); i.value = sname(code) + ' (' + code + ')'; } }

  /** Chips for a parsed command (used by home and the trains banner). */
  function heardChips(cmd, opts) {
    opts = opts || {};
    var c = [];
    var intentName = { train: t('cmd.train', 'Train search'), hotel: t('tabs.hotel', 'Hotels'), cab: t('tabs.cab', 'Cabs'), food: t('tabs.food', 'Food'), sight: t('tabs.sight', 'Sightseeing'),
      refund: t('asst.c.refund', 'Refund status'), cancel: t('asst.c.cancel', 'Cancel a booking'), status: t('asst.c.status', 'Booking status'), pnr: t('asst.c.pnr', 'My PNR'), human: t('asst.c.human', 'Talk to a human') }[cmd.intent];
    c.push('<span class="pp-chip pp-intent">' + OT.icon('target', 12) + ' ' + OT.esc(t('cmd.intent', 'Intent')) + ': ' + OT.esc(intentName || t('cmd.unknown', 'not understood')) + '</span>');
    var cc = function (code) { return sname(code).indexOf(code) >= 0 ? '' : ' <bdi class="keep">' + code + '</bdi>'; };
    if (cmd.from) c.push('<span class="pp-chip">' + OT.esc(t('search.from', 'From')) + ': ' + OT.esc(sname(cmd.from)) + cc(cmd.from) + (cmd.fromAssumed ? ' <span class="xs">(' + OT.esc(t('cmd.home', 'home city')) + ')</span>' : '') + '</span>');
    if (cmd.to) c.push('<span class="pp-chip">' + OT.esc(t('search.to', 'To')) + ': ' + OT.esc(sname(cmd.to)) + cc(cmd.to) + '</span>');
    if (cmd.intent === 'train' || cmd.date) c.push('<span class="pp-chip">' + OT.icon('calendar', 12) + ' ' + (cmd.date ? '<bdi class="keep">' + OT.esc(OT.fmtDate(cmd.date)) + '</bdi>' : OT.esc(t('cmd.noDate', 'date not said: tomorrow'))) + '</span>');
    if (cmd.ret || cmd.round) c.push('<span class="pp-chip pp-ret" data-chip-return>' + OT.icon('refresh', 12) + ' ' + OT.esc(t('cmd.return', 'Return')) + ': ' + (cmd.ret ? '<bdi class="keep">' + OT.esc(OT.fmtDate(cmd.ret)) + '</bdi>' : OT.esc(t('cmd.retNoDate', 'date not said: 2 days later'))) + '</span>');
    if (cmd.cls) c.push('<span class="pp-chip"><bdi class="keep">' + cmd.cls + '</bdi></span>');
    if (cmd.pax) c.push('<span class="pp-chip">' + OT.icon('users', 12) + ' ' + cmd.pax + '</span>');
    if (opts.budget) c.push('<span class="pp-chip">' + OT.icon('rupee', 12) + ' <bdi class="keep">' + OT.esc(OT.inr(opts.budget)) + '</bdi></span>');
    return c.join('');
  }

  /* ---------------- One way | Round trip (v1.2.1) ---------------- */
  /** Segmented toggle + depart/return date pair. ids: prefix + '-date', '-ret', '-trip'. */
  function tripToggle(prefix, round) {
    return '<div class="trip-type" role="radiogroup" id="' + prefix + '-trip" aria-label="' + OT.esc(t('ret.tripType', 'Trip type')) + '" data-tour="trip-type">' +
      [['one', 'ret.oneWay', 'One way'], ['round', 'ret.round', 'Round trip']].map(function (o) {
        var on = (o[0] === 'round') === !!round;
        return '<button type="button" role="radio" class="tt-opt" data-trip="' + o[0] + '" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '">' + OT.icon(o[0] === 'round' ? 'refresh' : 'arrowRight', 14) + '<span>' + OT.esc(t(o[1], o[2])) + '</span></button>';
      }).join('') + '</div>';
  }
  function datePair(prefix, date, ret, round, label) {
    var min = R().ymd(new Date());
    return '<div class="field date-pair' + (round ? ' is-round' : '') + '" data-date-pair="' + prefix + '">' +
      '<div class="dp-cell"><label for="' + prefix + '-date">' + OT.esc(label || t('search.date', 'Travel date')) + '</label><input id="' + prefix + '-date" class="input" type="date" min="' + min + '" value="' + OT.esc(date) + '"></div>' +
      '<div class="dp-cell dp-ret"' + (round ? '' : ' hidden') + '><label for="' + prefix + '-ret">' + OT.esc(t('ret.date', 'Return date')) + '</label><input id="' + prefix + '-ret" class="input" type="date" min="' + OT.esc(date || min) + '" value="' + OT.esc(ret || D().addDays(date || min, 2)) + '"></div></div>';
  }
  function isRound(scope, prefix) { var b = scope.querySelector('#' + prefix + '-trip [data-trip="round"]'); return !!b && b.getAttribute('aria-checked') === 'true'; }
  function setRound(scope, prefix, on) {
    OT.$$('#' + prefix + '-trip [data-trip]', scope).forEach(function (b) { var me = (b.getAttribute('data-trip') === 'round') === !!on; b.setAttribute('aria-checked', me ? 'true' : 'false'); b.tabIndex = me ? 0 : -1; });
    var pair = scope.querySelector('[data-date-pair="' + prefix + '"]'); if (!pair) return;
    pair.classList.toggle('is-round', !!on);
    var rc = pair.querySelector('.dp-ret'); if (rc) rc.hidden = !on;
    var d = scope.querySelector('#' + prefix + '-date'), r = scope.querySelector('#' + prefix + '-ret');
    if (on && d && r && d.value && (!r.value || r.value < d.value)) r.value = D().addDays(d.value, 2);
  }
  function bindTrip(scope, prefix) {
    OT.$$('#' + prefix + '-trip [data-trip]', scope).forEach(function (b) {
      b.addEventListener('click', function () { setRound(scope, prefix, b.getAttribute('data-trip') === 'round'); });
      b.addEventListener('keydown', function (e) {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) < 0) return;
        e.preventDefault(); var on = !isRound(scope, prefix); setRound(scope, prefix, on);
        var nb = scope.querySelector('#' + prefix + '-trip [data-trip="' + (on ? 'round' : 'one') + '"]'); if (nb) nb.focus();
      });
    });
    var d = scope.querySelector('#' + prefix + '-date'), r = scope.querySelector('#' + prefix + '-ret');
    if (d && r) d.addEventListener('change', function () {
      if (d.value) r.min = d.value;
      if (d.value && (!r.value || r.value < d.value)) r.value = D().addDays(d.value, 2);
    });
  }
  /** Validate the date pair: '' when fine, else a message. */
  function tripError(scope, prefix) {
    var d = scope.querySelector('#' + prefix + '-date'), r = scope.querySelector('#' + prefix + '-ret');
    if (!d || !d.value) return t('search.noDate', 'Please choose a travel date.');
    if (R().daysTo(d.value) < 0) return t('trn.errPast', 'That date is in the past. Pick today or a later date.');
    if (!isRound(scope, prefix)) return '';
    if (!r || !r.value) return t('ret.errNone', 'Choose a return date, or switch to One way.');
    if (r.value < d.value) return t('ret.errBefore', 'The return date cannot be before the departure date.');
    return '';
  }
  function tripVals(scope, prefix) { var round = isRound(scope, prefix), r = scope.querySelector('#' + prefix + '-ret'); return { trip: round ? 'round' : '', ret: round && r ? r.value : '' }; }

  /* ---------------- search ---------------- */
  function availCls(a) { return a.state === 'AVAILABLE' ? 'st-ok' : a.state === 'RAC' ? 'st-rac' : a.state === 'WL' ? 'st-wl' : 'st-no'; }
  function availLabel(a) {
    if (a.state === 'AVAILABLE') return t('trn.avail', 'Available') + ' ' + a.n;
    if (a.state === 'RAC') return 'RAC ' + a.n;
    if (a.state === 'WL') return 'GNWL ' + a.n;
    if (a.state === 'DEPARTED') return t('trn.departed', 'Departed');
    return t('trn.regret', 'Regret (full)');
  }
  function trainCard(tr, q) {
    var arrD = tr.arrOffset ? ' <span class="xs muted">+' + tr.arrOffset + ' ' + OT.esc(t('trn.day', 'day')) + '</span>' : '';
    var tiles = tr.classes.filter(function (c) { return !q.cls || c.cls === q.cls; }).map(function (c) {
      var ch = R().chance(c.avail, tr.date), dis = c.avail.state === 'REGRET' || c.avail.state === 'DEPARTED' || !tr.runs;
      return '<button type="button" class="cls-tile ' + availCls(c.avail) + '" data-book="' + c.cls + '"' + (dis ? ' disabled' : '') + ' aria-label="' + OT.esc(c.cls + ' ' + OT.inr(c.fare.total) + ' ' + c.avail.label) + '">' +
        '<span class="ct-top"><bdi class="keep ct-cls">' + c.cls + '</bdi><bdi class="keep ct-fare">' + OT.esc(OT.inr(c.fare.total)) + '</bdi></span>' +
        '<span class="ct-av">' + OT.esc(availLabel(c.avail)) + '</span>' +
        (c.avail.state === 'WL' || c.avail.state === 'RAC' ? '<span class="ct-ch">' + OT.esc(t('trn.chance', '{p}% chance', { p: ch })) + '</span>' : '') + '</button>';
    }).join('');
    return '<article class="trn' + (tr.runs ? '' : ' not-running') + '" data-train="' + tr.no + '">' +
      '<div class="trn-head"><div class="trn-id"><strong><bdi class="keep">' + tr.no + '</bdi> ' + OT.esc(tr.name) + '</strong>' +
      '<span class="lbl' + (/Rajdhani|Shatabdi|Vande|Duronto/.test(tr.type) ? ' lbl-irctc' : '') + '">' + OT.esc(tr.type) + '</span>' + OT.simTag() + '</div>' +
      '<div class="trn-days" aria-label="' + OT.esc(t('trn.runsOn', 'Runs on')) + '">' + DAYS.map(function (d, i) { return '<i class="' + (tr.days.charAt(i) === '1' ? 'on' : '') + '">' + d + '</i>'; }).join('') + '</div></div>' +
      '<div class="trn-times"><div><b><bdi class="keep">' + tr.dep + '</bdi></b><span class="small"><bdi class="keep">' + tr.from + '</bdi> · ' + OT.esc(sname(tr.from)) + '</span></div>' +
      '<div class="trn-dur"><span class="xs muted">' + OT.esc(dur(tr.dur)) + ' · ' + tr.km + ' km</span><i></i></div>' +
      '<div class="r"><b><bdi class="keep">' + tr.arr + '</bdi>' + arrD + '</b><span class="small"><bdi class="keep">' + tr.to + '</bdi> · ' + OT.esc(sname(tr.to)) + '</span></div></div>' +
      (tr.runs ? '' : '<p class="note note-warn small">' + OT.icon('calendar', 14) + ' ' + OT.esc(t('trn.notRun', 'Does not run on {d}.', { d: wd(tr.date) })) + '</p>') +
      '<div class="trn-classes">' + (tiles || '<span class="muted small">' + OT.esc(t('trn.noCls', 'This class is not available on this train.')) + '</span>') + '</div>' +
      '<div class="offer-badges">' + OT.badge(tr.verdict) + tr.flags.map(function (f) { return '<span class="xs text-warn">' + OT.icon('alert', 12) + ' ' + OT.esc(t(f.key, f.en)) + '</span>'; }).join('') + '</div>' +
      '<div class="source-line">' + OT.icon('info', 12) + '<span>' + OT.esc(t('res.source', 'Source')) + ': ' + OT.esc(tr.source.name) + '</span><span><bdi class="keep">' + OT.esc(tr.source.ref) + '</bdi></span>' +
      '<span>' + OT.esc(t('res.checked', 'checked')) + ' ' + OT.esc(OT.stamp(new Date(tr.source.checkedAt))) + ' (' + OT.esc(OT.agents.time.agoLabel(tr.source.checkedAt)) + ')</span></div></article>';
  }
  function slotOf(tr) { return String(Math.floor(R().toMin(tr.dep) / 360)); }
  function sorted(list, q) {
    var l = list.filter(function (tr) {
      if (!filt.showAll && !tr.runs) return false;
      if (filt.slot && slotOf(tr) !== filt.slot) return false;
      if (q.cls && tr.cls.indexOf(q.cls) < 0) return false;
      if (filt.availOnly && !tr.classes.some(function (c) { return (!q.cls || c.cls === q.cls) && c.avail.state === 'AVAILABLE'; })) return false;
      return true;
    });
    var minFare = function (tr) { return Math.min.apply(null, tr.classes.map(function (c) { return c.fare.total; })); };
    var key = { dep: function (x) { return R().toMin(x.dep); }, arr: function (x) { return R().toMin(x.dep) + x.dur; }, dur: function (x) { return x.dur; }, fare: minFare }[filt.sort];
    return l.sort(function (a, b) { return key(a) - key(b); });
  }

  function searchForm(q) {
    var round = q.trip === 'round';
    return '<form class="card trn-form" id="trn-form" novalidate>' + (q.attach ? '' : tripToggle('ts', round)) +
      '<div class="trn-form-grid">' + picker('ts-from', q.from, t('search.from', 'From')) +
      '<button type="button" class="icon-btn swap" id="ts-swap" aria-label="' + OT.esc(t('trn.swap', 'Swap stations')) + '">' + OT.icon('refresh', 16) + '</button>' +
      picker('ts-to', q.to, t('search.to', 'To')) +
      datePair('ts', q.date, q.ret, round && !q.attach, round ? t('ret.depart', 'Departure date') : null) +
      '<div class="field"><label for="ts-cls">' + OT.esc(t('trn.class', 'Class')) + '</label><select id="ts-cls" class="input"><option value="">' + OT.esc(t('trn.allCls', 'All classes')) + '</option>' +
      CLS_LIST.map(function (c) { return '<option value="' + c + '"' + (q.cls === c ? ' selected' : '') + '>' + c + ' · ' + OT.esc(R().classes[c].name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="ts-pax">' + OT.esc(t('search.pax', 'Travellers')) + '</label><select id="ts-pax" class="input">' + [1, 2, 3, 4, 5, 6].map(function (n) { return '<option' + (n === +q.pax ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div>' +
      '<button type="submit" class="btn btn-primary" id="ts-go">' + OT.icon('search', 16) + OT.esc(t('trn.search', 'Search trains')) + '</button></div>' +
      '<p class="form-error hidden" id="ts-err" role="alert"></p></form>';
  }

  function renderSearch(el, q) {
    var u = OT.store.get('user') || {};
    q.from = q.from || u.homeCity || '';
    q.date = q.date || tomorrow();
    q.pax = q.pax || (u.party ? u.party.length : 1);
    if (q.trip === 'round' && (!q.ret || q.ret < q.date)) q.ret = D().addDays(q.date, 2);
    var retStep = q.trip === 'round' && q.step === 'ret' && q.ono;
    var sFrom = retStep ? q.to : q.from, sTo = retStep ? q.from : q.to, sDate = retStep ? q.ret : q.date;
    var list = q.from && q.to ? R().search(sFrom, sTo, sDate) : [];
    var shown = sorted(list, q);
    var hidden = list.filter(function (tr) { return !tr.runs; }).length;
    var cmd = q.heard ? OT.agents.parseCommand(q.heard) : null;
    el.innerHTML = '<div class="container page trains-page">' +
      '<div class="page-head"><div><p class="ot-eyebrow">' + OT.icon(retStep ? 'refresh' : 'train', 14) + ' ' + OT.esc(retStep ? t('ret.step2', 'Round trip · step 2 of 2 · pick your return train') : q.trip === 'round' ? t('ret.step1', 'Round trip · step 1 of 2 · pick your outward train') : q.attach ? t('ret.attachStep', 'Add your return train · it joins your journey') : t('trn.step', 'Step 1 · Find your train')) + '</p>' +
      '<h1>' + (q.from && q.to ? OT.esc(sname(sFrom)) + ' → ' + OT.esc(sname(sTo)) : OT.esc(t('trn.title', 'Find trains'))) + '</h1>' +
      '<p>' + OT.esc(t('trn.sub', 'Simulated timetable and availability. Final booking happens on IRCTC — simulated here.')) + ' ' + OT.simTag() + '</p></div></div>' +
      (cmd ? '<div class="heard card-flat" data-tour="heard"><span class="xs muted">' + OT.icon('mic', 12) + ' ' + OT.esc(t('cmd.heard', 'I heard')) + ':</span> <span class="q-text" lang="' + OT.esc(OT.lang.detect(q.heard).code) + '">“' + OT.lang.highlight(q.heard) + '”</span>' +
        '<div class="parse-preview">' + heardChips(cmd) + '</div></div>' : '') +
      (retStep ? outwardPickHTML(q) : '') + (q.attach ? attachNoteHTML() : '') +
      searchForm(q) +
      (q.from && q.to ? '<div class="trn-bar">' +
        '<div class="date-nav"><button type="button" class="btn btn-ghost btn-sm" data-day="-1" aria-label="' + OT.esc(t('trn.prevDay', 'Previous day')) + '">' + OT.icon('arrowLeft', 14) + '</button>' +
        '<strong><bdi class="keep">' + OT.esc(OT.fmtDate(sDate)) + '</bdi> · ' + OT.esc(wd(sDate)) + '</strong>' +
        (q.trip === 'round' ? '<span class="pp-chip pp-ret" data-round-chip>' + OT.icon('refresh', 12) + ' ' + OT.esc(retStep ? t('ret.outOn', 'Outward {d}', { d: OT.fmtDate(q.date) }) : t('ret.backOn', 'Return {d}', { d: OT.fmtDate(q.ret) })) + '</span>' : '') +
        '<button type="button" class="btn btn-ghost btn-sm" data-day="1" aria-label="' + OT.esc(t('trn.nextDay', 'Next day')) + '">' + OT.icon('arrowRight', 14) + '</button></div>' +
        '<div class="chips" role="group" aria-label="' + OT.esc(t('trn.depTime', 'Departure time')) + '">' + SLOTS.map(function (s) { return '<button type="button" class="chip" data-slot="' + s[0] + '" aria-pressed="' + (filt.slot === s[0]) + '">' + OT.esc(t(s[1], s[2])) + '</button>'; }).join('') + '</div>' +
        '<label class="check small"><input type="checkbox" id="tf-avail"' + (filt.availOnly ? ' checked' : '') + '> ' + OT.esc(t('trn.availOnly', 'Available only')) + '</label>' +
        '<label class="small sort-by">' + OT.esc(t('trn.sort', 'Sort')) + ' <select id="tf-sort" class="input input-sm">' + [['dep', 'trn.sDep', 'Departure'], ['arr', 'trn.sArr', 'Arrival'], ['dur', 'trn.sDur', 'Duration'], ['fare', 'trn.sFare', 'Lowest fare']].map(function (s) { return '<option value="' + s[0] + '"' + (filt.sort === s[0] ? ' selected' : '') + '>' + OT.esc(t(s[1], s[2])) + '</option>'; }).join('') + '</select></label></div>' +
        '<p class="small muted trn-count">' + OT.esc(t('trn.count', '{n} of {m} trains shown', { n: shown.length, m: list.length })) +
        (hidden ? ' · <button type="button" class="btn-link small" id="tf-all">' + OT.esc(filt.showAll ? t('trn.hideNot', 'Hide trains not running that day') : t('trn.showNot', 'Show {n} not running that day', { n: hidden })) + '</button>' : '') + '</p>' +
        '<div class="trn-list" data-tour="trains"' + (retStep ? ' data-return-list' : '') + '>' + (shown.length ? shown.map(function (tr) { return trainCard(tr, q); }).join('') :
          '<div class="card empty-state">' + OT.icon('train', 30) + '<p class="muted">' + OT.esc(t('trn.none', 'No trains match these filters. Try another date or clear the filters.')) + '</p></div>') + '</div>'
        : '<div class="card empty-state">' + OT.icon('search', 30) + '<p class="muted">' + OT.esc(t('trn.pick', 'Pick both stations to see trains.')) + '</p></div>') +
      '<p class="xs muted mt12">' + OT.esc(t('trn.disclaimer', 'Train numbers, timings, fares and seat availability are simulated for this academic prototype (a few real train names are used for realism). Check IRCTC before travel.')) + '</p>' +
      '</div>';
    bindSearch(el, q);
  }
  function go(q) { OT.go('trains?' + qs({ from: q.from, to: q.to, date: q.date, cls: q.cls, pax: q.pax, heard: q.heard, pkg: q.pkg, trip: q.trip, ret: q.trip === 'round' ? q.ret : '', step: q.step, ono: q.ono, ocls: q.ocls, attach: q.attach })); }
  /** Step 2 header: the outward train already chosen, with "Change". */
  function outwardPickHTML(q) {
    var tr = R().train(q.ono, q.from, q.to, q.date);
    if (!tr) return '';
    var c = tr.classes.filter(function (x) { return x.cls === q.ocls; })[0] || tr.classes[0];
    return '<div class="card-flat ret-out" data-outward-pick>' + OT.icon('checkCircle', 18) + '<div><span class="xs muted">' + OT.esc(t('ret.outPicked', 'Outward train chosen')) + '</span>' +
      '<strong><bdi class="keep">' + tr.no + '</bdi> ' + OT.esc(tr.name) + '</strong><span class="small"><bdi class="keep">' + tr.from + ' ' + tr.dep + '</bdi> → <bdi class="keep">' + tr.to + ' ' + tr.arr + '</bdi> · <bdi class="keep">' + OT.esc(OT.fmtDate(tr.date)) + '</bdi> · <bdi class="keep">' + c.cls + '</bdi> · <bdi class="keep">' + OT.esc(OT.inr(c.fare.total)) + '</bdi></span></div>' +
      '<a class="btn btn-ghost btn-sm" href="#/trains?' + qs({ from: q.from, to: q.to, date: q.date, cls: q.cls, pax: q.pax, trip: 'round', ret: q.ret, pkg: q.pkg }) + '">' + OT.esc(t('ret.change', 'Change')) + '</a></div>';
  }
  function attachNoteHTML() {
    var j = OT.store.get('journey');
    if (!j || !j.train) return '';
    return '<div class="card-flat ret-out" data-attach-note>' + OT.icon('route', 18) + '<div><span class="xs muted">' + OT.esc(t('ret.attachTo', 'Joins your journey')) + '</span><strong>' + OT.esc(sname(j.train.from)) + ' → ' + OT.esc(sname(j.train.to)) + ' · PNR <bdi class="keep">' + OT.esc(j.pnr || '—') + '</bdi></strong>' +
      '<span class="small">' + OT.esc(t('ret.attachSub', 'The return you book here appears last on your My Journey timeline, with its own PNR.')) + '</span></div></div>';
  }
  function bindSearch(el, q) {
    bindPicker(el, 'ts-from'); bindPicker(el, 'ts-to'); bindTrip(el, 'ts');
    el.querySelector('#ts-swap').addEventListener('click', function () { var a = codeOf(el, 'ts-from'), b = codeOf(el, 'ts-to'); setCode(el, 'ts-from', b); setCode(el, 'ts-to', a); });
    el.querySelector('#trn-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = codeOf(el, 'ts-from'), to = codeOf(el, 'ts-to'), err = el.querySelector('#ts-err');
      var msg = !f || !to ? t('trn.errPick', 'Pick a From and a To station from the list.') : f === to ? t('trn.errSame', 'From and To must be different stations.') : tripError(el, 'ts');
      if (msg) { err.textContent = msg; err.classList.remove('hidden'); return; }
      var tv = tripVals(el, 'ts');
      go({ from: f, to: to, date: el.querySelector('#ts-date').value, cls: el.querySelector('#ts-cls').value, pax: el.querySelector('#ts-pax').value, pkg: q.pkg, trip: tv.trip, ret: tv.ret, attach: q.attach });
    });
    OT.$$('[data-day]', el).forEach(function (b) {
      b.addEventListener('click', function () {
        var retStep = q.trip === 'round' && q.step === 'ret' && q.ono;
        if (retStep) { var r = D().addDays(q.ret, +b.getAttribute('data-day')); if (r < q.date || R().daysTo(r) < 0) { OT.toast(t('ret.errBefore', 'The return date cannot be before the departure date.'), 'error'); return; } go(Object.assign({}, q, { ret: r, heard: '' })); return; }
        var d = D().addDays(q.date, +b.getAttribute('data-day')); if (R().daysTo(d) < 0) return;
        var nq = Object.assign({}, q, { date: d, heard: '' }); if (nq.trip === 'round' && nq.ret < d) nq.ret = d;
        go(nq);
      });
    });
    OT.$$('[data-slot]', el).forEach(function (b) { b.addEventListener('click', function () { filt.slot = b.getAttribute('data-slot'); renderSearch(el, q); }); });
    var av = el.querySelector('#tf-avail'); if (av) av.addEventListener('change', function () { filt.availOnly = av.checked; renderSearch(el, q); });
    var so = el.querySelector('#tf-sort'); if (so) so.addEventListener('change', function () { filt.sort = so.value; renderSearch(el, q); });
    var all = el.querySelector('#tf-all'); if (all) all.addEventListener('click', function () { filt.showAll = !filt.showAll; renderSearch(el, q); });
    OT.$$('[data-book]', el).forEach(function (b) {
      b.addEventListener('click', function () {
        var no = b.closest('[data-train]').getAttribute('data-train'), cls = b.getAttribute('data-book');
        if (q.trip === 'round' && q.step === 'ret' && q.ono) { OT.go('trains/book?' + qs({ no: q.ono, from: q.from, to: q.to, date: q.date, cls: q.ocls, pax: q.pax, pkg: q.pkg, rno: no, rcls: cls, ret: q.ret })); return; }
        if (q.trip === 'round') { go(Object.assign({}, q, { step: 'ret', ono: no, ocls: cls, heard: '' })); return; }
        OT.go('trains/book?' + qs({ no: no, from: q.from, to: q.to, date: q.date, cls: cls, pax: q.pax, pkg: q.pkg, attach: q.attach }));
      });
    });
  }

  /* ---------------- book ---------------- */
  var GENDER = [['F', 'trn.gF', 'Female'], ['M', 'trn.gM', 'Male'], ['T', 'trn.gT', 'Transgender']];
  var PREF_SL = [['NP', 'trn.pNP', 'No preference'], ['LB', 'trn.pLB', 'Lower'], ['MB', 'trn.pMB', 'Middle'], ['UB', 'trn.pUB', 'Upper'], ['SL', 'trn.pSL', 'Side lower'], ['SU', 'trn.pSU', 'Side upper']];
  var PREF_CC = [['NP', 'trn.pNP', 'No preference'], ['W', 'trn.pW', 'Window'], ['A', 'trn.pA', 'Aisle']];
  var bookState = null;
  function paxRow(p, i, cls) {
    var prefs = ['CC', 'EC'].indexOf(cls) >= 0 ? PREF_CC : PREF_SL;
    var pv = prefs.some(function (x) { return x[0] === p.pref; }) ? p.pref : 'NP';
    return '<fieldset class="pax-row" data-pax="' + i + '"><legend class="xs muted">' + OT.esc(t('trn.passenger', 'Passenger {n}', { n: i + 1 })) + '</legend>' +
      '<div class="field"><label for="px-n' + i + '">' + OT.esc(t('auth.name', 'Full name')) + '</label><input id="px-n' + i + '" class="input" data-f="name" value="' + OT.esc(p.name || '') + '" autocomplete="off"></div>' +
      '<div class="field"><label for="px-a' + i + '">' + OT.esc(t('trn.age', 'Age')) + '</label><input id="px-a' + i + '" class="input" data-f="age" type="number" min="1" max="120" inputmode="numeric" value="' + OT.esc(p.age || '') + '"></div>' +
      '<div class="field"><label for="px-g' + i + '">' + OT.esc(t('trn.gender', 'Gender')) + '</label><select id="px-g' + i + '" class="input" data-f="gender">' + GENDER.map(function (g) { return '<option value="' + g[0] + '"' + (p.gender === g[0] ? ' selected' : '') + '>' + OT.esc(t(g[1], g[2])) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="px-p' + i + '">' + OT.esc(t('trn.pref', 'Berth / seat')) + '</label><select id="px-p' + i + '" class="input" data-f="pref">' + prefs.map(function (g) { return '<option value="' + g[0] + '"' + (pv === g[0] ? ' selected' : '') + '>' + OT.esc(t(g[1], g[2])) + '</option>'; }).join('') + '</select></div>' +
      '<button type="button" class="icon-btn px-del" data-del="' + i + '" aria-label="' + OT.esc(t('common.remove', 'Remove')) + '">' + OT.icon('trash', 15) + '</button></fieldset>';
  }
  function readPax(el) {
    return OT.$$('.pax-row', el).map(function (row) {
      var o = {}; OT.$$('[data-f]', row).forEach(function (f) { o[f.getAttribute('data-f')] = f.value.trim(); }); o.age = +o.age || ''; return o;
    });
  }
  function renderBook(el, q) {
    var tr = R().train(q.no, q.from, q.to, q.date);
    if (!tr) { el.innerHTML = '<div class="container page"><div class="card empty-state">' + OT.icon('alert', 30) + '<p>' + OT.esc(t('trn.gone', 'This train is not in the timetable for that date.')) + '</p><a class="btn btn-primary" href="#/trains">' + OT.esc(t('trn.title', 'Find trains')) + '</a></div></div>'; return; }
    var c = tr.classes.filter(function (x) { return x.cls === q.cls; })[0] || tr.classes[0];
    var rtr = q.rno ? R().train(q.rno, q.to, q.from, q.ret) : null, rc = rtr ? rtr.classes.filter(function (x) { return x.cls === q.rcls; })[0] || rtr.classes[0] : null;
    if (q.rno && !rtr) { el.innerHTML = '<div class="container page"><div class="card empty-state">' + OT.icon('alert', 30) + '<p>' + OT.esc(t('trn.gone', 'This train is not in the timetable for that date.')) + '</p><a class="btn btn-primary" href="#/trains">' + OT.esc(t('trn.title', 'Find trains')) + '</a></div></div>'; return; }
    var u = OT.store.get('user') || {};
    var key = [q.no, q.date, c.cls, q.rno || '', q.ret || ''].join('|');
    if (!bookState || bookState.key !== key) {
      var party = (u.party || [{ name: u.name || '', age: '', gender: 'F', pref: 'NP' }]).slice(0, +q.pax || 1);
      while (party.length < (+q.pax || 1)) party.push({ name: '', age: '', gender: 'M', pref: 'NP' });
      bookState = { key: key, pax: party.map(function (p) { return Object.assign({}, p); }) };
    }
    var n = bookState.pax.length, f = c.fare, conv = method === 'card' ? 35 : 20, nT = rtr ? 2 : 1;
    var ch = R().chance(c.avail, tr.date);
    var grand = f.total * n + conv + (rc ? rc.fare.total * n + conv : 0);
    el.innerHTML = '<div class="container page trains-book">' +
      '<div class="page-head"><div><p class="ot-eyebrow">' + OT.icon('shield', 14) + ' ' + OT.esc(t('trn.bookEyebrow', 'Step 2 · Passengers & payment · nothing is booked until you confirm')) + '</p>' +
      '<h1>' + OT.esc(rtr ? t('ret.bookTitle', 'Book trains {no} + {rno}', { no: tr.no, rno: rtr.no }) : t('trn.bookTitle', 'Book train {no}', { no: tr.no })) + '</h1><p>' + OT.esc(t('trn.sub', 'Simulated timetable and availability. Final booking happens on IRCTC — simulated here.')) + '</p></div>' +
      '<a class="btn btn-ghost btn-sm" href="#/trains?' + (rtr ? qs({ from: q.from, to: q.to, date: q.date, pax: q.pax, pkg: q.pkg, trip: 'round', ret: q.ret, step: 'ret', ono: q.no, ocls: q.cls }) : qs({ from: q.from, to: q.to, date: q.date, pax: q.pax, pkg: q.pkg, attach: q.attach })) + '">' + OT.icon('arrowLeft', 15) + OT.esc(t('trn.back', 'Back to trains')) + '</a></div>' +
      '<div class="co-grid"><div class="j-side-main">' +
      '<div class="card trn-sum" data-tour="trn-sum"><strong><bdi class="keep">' + tr.no + '</bdi> ' + OT.esc(tr.name) + '</strong>' +
      '<div class="trn-times"><div><b><bdi class="keep">' + tr.dep + '</bdi></b><span class="small"><bdi class="keep">' + tr.from + '</bdi> · <bdi class="keep">' + OT.esc(OT.fmtDate(tr.date)) + '</bdi></span></div>' +
      '<div class="trn-dur"><span class="xs muted">' + OT.esc(dur(tr.dur)) + '</span><i></i></div>' +
      '<div class="r"><b><bdi class="keep">' + tr.arr + '</bdi></b><span class="small"><bdi class="keep">' + tr.to + '</bdi> · <bdi class="keep">' + OT.esc(OT.fmtDate(D().addDays(tr.date, tr.arrOffset))) + '</bdi></span></div></div>' +
      '<div class="row-wrap"><span class="cls-tile static ' + availCls(c.avail) + '"><span class="ct-top"><bdi class="keep ct-cls">' + c.cls + '</bdi><span>' + OT.esc(R().classes[c.cls].name) + '</span></span><span class="ct-av">' + OT.esc(availLabel(c.avail)) + '</span></span>' +
      (c.avail.state !== 'AVAILABLE' ? '<span class="small">' + OT.esc(t('trn.chanceLong', 'Chance of confirmation (simulated estimate): {p}%', { p: ch })) + '</span>' : '') + OT.badge(tr.verdict) + '</div>' +
      (rtr ? '' : q.attach ? '<p class="xs muted">' + OT.icon('route', 12) + ' ' + OT.esc(t('ret.attachSub', 'The return you book here appears last on your My Journey timeline, with its own PNR.')) + '</p>' : '') + '</div>' +
      (rtr ? retSumHTML(rtr, rc) : '') +
      '<form class="card" id="pax-form" novalidate data-tour="pax"><div class="card-head"><h2 class="h3">' + OT.esc(t('trn.passengers', 'Passengers')) + '</h2>' +
      (u.name ? '<span class="xs muted">' + OT.esc(t('trn.prefilled', 'Prefilled from {name}’s profile', { name: u.name })) + '</span>' : '') + '</div>' +
      bookState.pax.map(function (p, i) { return paxRow(p, i, c.cls); }).join('') +
      (n < 6 ? '<button type="button" class="btn btn-ghost btn-sm" id="px-add">' + OT.icon('plus', 14) + OT.esc(t('trn.addPax', 'Add passenger')) + '</button>' : '') +
      '<p class="form-error hidden" id="px-err" role="alert"></p></form></div>' +
      '<div class="co-pay"><div class="card" data-tour="trn-fare"><h2 class="h3">' + OT.esc(t('trn.fare', 'Fare summary')) + ' ' + OT.simTag() + '</h2>' +
      (rtr ? '<div class="co-totals small fare-legs" data-fare-legs>' +
        '<div data-fare-out><span>' + OT.esc(t('ret.fareOut', 'Outward {no} · {cls} × {n}', { no: tr.no, cls: c.cls, n: n })) + '</span>' + keep(OT.inr(f.total * n + conv)) + '</div>' +
        '<div data-fare-ret><span>' + OT.esc(t('ret.fareRet', 'Return {no} · {cls} × {n}', { no: rtr.no, cls: rc.cls, n: n })) + '</span>' + keep(OT.inr(rc.fare.total * n + conv)) + '</div>' +
        '<div class="muted"><span>' + OT.esc(t('ret.fareIncl', 'each incl. reservation, GST and a {c} convenience fee (simulated)', { c: OT.inr(conv) })) + '</span></div>' +
        '<div class="grand"><span>' + OT.esc(t('co.total', 'Total payable now')) + '</span><strong>' + keep(OT.inr(grand)) + '</strong></div></div>' :
      '<div class="co-totals small">' +
      '<div><span>' + OT.esc(t('trn.base', 'Base fare')) + ' × ' + n + '</span>' + keep(OT.inr(f.base * n)) + '</div>' +
      '<div><span>' + OT.esc(t('trn.resv', 'Reservation charge')) + '</span>' + keep(OT.inr(f.res * n)) + '</div>' +
      (f.sf ? '<div><span>' + OT.esc(t('trn.sf', 'Superfast charge')) + '</span>' + keep(OT.inr(f.sf * n)) + '</div>' : '') +
      (f.gst ? '<div><span>GST</span>' + keep(OT.inr(f.gst * n)) + '</div>' : '') +
      '<div><span>' + OT.esc(t('trn.conv', 'Convenience fee (simulated)')) + '</span>' + keep(OT.inr(conv)) + '</div>' +
      '<div class="grand"><span>' + OT.esc(t('co.total', 'Total payable now')) + '</span><strong>' + keep(OT.inr(f.total * n + conv)) + '</strong></div></div>') +
      '<div class="pay-methods mt12" role="radiogroup">' + [['upi', 'rupee', 'pay.upi', 'UPI (simulated)'], ['card', 'card', 'pay.card', 'Card (simulated)']].map(function (m) {
        return '<label class="pay-m' + (method === m[0] ? ' on' : '') + '"><input type="radio" name="tpm" value="' + m[0] + '"' + (method === m[0] ? ' checked' : '') + '>' + OT.icon(m[1], 18) + '<span><strong>' + OT.esc(t(m[2], m[3])) + '</strong><span class="xs muted">' + (m[0] === 'upi' ? 'traveller@upi-sim' : 'XXXX XXXX XXXX 4242') + '</span></span></label>';
      }).join('') + '</div>' +
      '<p class="xs muted">' + OT.esc(t('trn.irctcNote', 'Final booking happens on IRCTC — simulated here. No money moves.')) + '</p>' +
      '<button type="button" class="btn btn-accent btn-lg btn-block" id="trn-pay">' + OT.icon('lock', 18) + OT.esc(nT > 1 ? t('ret.pay', 'Pay {amt} once & book both (simulated)', { amt: OT.inr(grand) }) : t('trn.pay', 'Pay {amt} & book (simulated)', { amt: OT.inr(grand) })) + '</button>' +
      holdChoiceHTML(q) + '</div></div></div></div>';
    bindBook(el, q, tr, c);
  }
  /** v1.2.2: the second choice under "Pay": keep the train(s) in the trip unpaid, add services, pay once at checkout. */
  function holdChoiceHTML(q) {
    var attach = q.attach === 'return' && !q.rno;
    return '<div class="hold-choice" data-tour="pay-later"><div class="hold-or" role="separator"><span>' + OT.esc(t('hold.or', 'or')) + '</span></div>' +
      '<button type="button" class="btn btn-ghost btn-lg btn-block hold-btn" id="trn-hold">' + OT.icon('layers', 18) + '<span>' + OT.esc(attach ? t('hold.btnAttach', 'Add to my trip and pay later at checkout, with everything else') : t('hold.btn', 'Add hotel, transport, food & sightseeing — pay once at the end')) + '</span></button>' +
      '<p class="xs muted hold-hint">' + OT.icon('info', 12) + ' ' + OT.esc(t('hold.hint', 'Your train choice is kept in your trip; you pay for everything together at checkout and the PNR is issued then.')) + '</p></div>';
  }
  function retSumHTML(tr, c) {
    return '<div class="card trn-sum trn-sum-ret" data-return-sum><span class="xs muted">' + OT.icon('refresh', 12) + ' ' + OT.esc(t('ret.title', 'Return train')) + '</span><strong><bdi class="keep">' + tr.no + '</bdi> ' + OT.esc(tr.name) + '</strong>' +
      '<div class="trn-times"><div><b><bdi class="keep">' + tr.dep + '</bdi></b><span class="small"><bdi class="keep">' + tr.from + '</bdi> · <bdi class="keep">' + OT.esc(OT.fmtDate(tr.date)) + '</bdi></span></div>' +
      '<div class="trn-dur"><span class="xs muted">' + OT.esc(dur(tr.dur)) + '</span><i></i></div>' +
      '<div class="r"><b><bdi class="keep">' + tr.arr + '</bdi></b><span class="small"><bdi class="keep">' + tr.to + '</bdi> · <bdi class="keep">' + OT.esc(OT.fmtDate(D().addDays(tr.date, tr.arrOffset))) + '</bdi></span></div></div>' +
      '<div class="row-wrap"><span class="cls-tile static ' + availCls(c.avail) + '"><span class="ct-top"><bdi class="keep ct-cls">' + c.cls + '</bdi><span>' + OT.esc(R().classes[c.cls].name) + '</span></span><span class="ct-av">' + OT.esc(availLabel(c.avail)) + '</span></span>' +
      (c.avail.state !== 'AVAILABLE' ? '<span class="small">' + OT.esc(t('trn.chanceLong', 'Chance of confirmation (simulated estimate): {p}%', { p: R().chance(c.avail, tr.date) })) + '</span>' : '') + OT.badge(tr.verdict) + '</div></div>';
  }
  /** A booked return ticket -> journey.returnTrain (+ the same fields the timeline, itinerary and readiness read). */
  function returnFromTicket(tk, ref) {
    var cnf = (tk.passengers || []).filter(function (p) { return p.coach; })[0];
    return { no: tk.no, name: tk.name, from: tk.from, to: tk.to, date: tk.date, dep: tk.dep, arr: tk.arr, arrDate: tk.arrDate, cls: tk.cls, coach: cnf ? cnf.coach : '—',
      seats: (tk.passengers || []).map(function (p) { return p.berth ? String(p.berth) : p.status; }), status: tk.status, chance: tk.chance, fare: tk.total, pnr: tk.pnr, ref: ref, bookedViaOneTrip: true };
  }
  function trainBooking(tk, ref, j, n, extra, methodLabel) {
    var u = OT.store.get('user') || {};
    return Object.assign({ ref: ref, journeyId: j.id, itemId: null, refId: null, type: 'train', partnerId: 'IRCTC', title: tk.no + ' ' + tk.name, provider: 'IRCTC (simulated)',
      amount: tk.total, status: 'confirmed', paidAt: tk.bookedAt, method: methodLabel || (method === 'card' ? 'Card (simulated)' : 'UPI (simulated)'), city: tk.to, when: tk.date + 'T' + tk.dep,
      txn: tk.txn, pnr: tk.pnr, lang: L(), guest: u.name || ((tk.passengers || [])[0] || {}).name, pax: n, ticket: tk, simulated: true }, extra || {});
  }
  function bindBook(el, q, tr, c) {
    var sync = function () { bookState.pax = readPax(el); };
    var add = el.querySelector('#px-add');
    if (add) add.addEventListener('click', function () { sync(); bookState.pax.push({ name: '', age: '', gender: 'M', pref: 'NP' }); q.pax = bookState.pax.length; renderBook(el, q); });
    OT.$$('[data-del]', el).forEach(function (b) { b.addEventListener('click', function () { sync(); if (bookState.pax.length < 2) return; bookState.pax.splice(+b.getAttribute('data-del'), 1); q.pax = bookState.pax.length; renderBook(el, q); }); });
    OT.$$('input[name="tpm"]', el).forEach(function (r) { r.addEventListener('change', function () { sync(); method = r.value; renderBook(el, q); }); });
    el.querySelector('#trn-pay').addEventListener('click', function () { pay(q); });
    var hb = el.querySelector('#trn-hold'); if (hb) hb.addEventListener('click', function () { holdForLater(q); });
  }
  /** Same passenger check as Pay: '' when fine, else shows the error and returns false. */
  function paxValid(el) {
    bookState.pax = readPax(el);
    var bad = bookState.pax.filter(function (p) { return !p.name || p.name.length < 2 || !(p.age >= 1 && p.age <= 120); });
    var err = el.querySelector('#px-err');
    if (bad.length) { err.textContent = t('trn.errPax', 'Enter a name and an age (1–120) for every passenger.'); err.classList.remove('hidden'); try { err.scrollIntoView({ block: 'center' }); } catch (e) { /* noop */ } return false; }
    err.classList.add('hidden');
    return true;
  }
  function code5() { var c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = ''; for (var i = 0; i < 5; i++) s += c.charAt(Math.floor(Math.random() * c.length)); return s; }
  function pay(q) {
    if (busy || !root) return Promise.resolve(false);
    var el = root, tr = R().train(q.no, q.from, q.to, q.date);
    var c = tr && tr.classes.filter(function (x) { return x.cls === q.cls; })[0];
    if (!c) return Promise.resolve(false);
    var rtr = q.rno ? R().train(q.rno, q.to, q.from, q.ret) : null, rc = rtr && rtr.classes.filter(function (x) { return x.cls === q.rcls; })[0];
    if (q.rno && !rc) return Promise.resolve(false);
    var attach = q.attach === 'return' && !rtr;
    if (!paxValid(el)) return Promise.resolve(false);
    var n = bookState.pax.length, conv = method === 'card' ? 35 : 20, total = c.fare.total * n + conv + (rc ? rc.fare.total * n + conv : 0);
    var lines = [
      OT.esc(t('trip.train', 'Train')) + ': ' + keep(tr.no) + ' ' + OT.esc(tr.name),
      keep(tr.from) + ' ' + keep(tr.dep) + ' → ' + keep(tr.to) + ' ' + keep(tr.arr) + ' · ' + keep(OT.fmtDate(tr.date)) + ' · ' + keep(c.cls),
      OT.esc(t('trn.passengers', 'Passengers')) + ': ' + bookState.pax.map(function (p) { return OT.esc(p.name) + ' (' + p.age + ')'; }).join(', '),
      OT.esc(t('trn.status', 'Booking status')) + ': ' + OT.esc(availLabel(c.avail))
    ].concat(rtr ? [
      OT.esc(t('ret.title', 'Return train')) + ': ' + keep(rtr.no) + ' ' + OT.esc(rtr.name),
      keep(rtr.from) + ' ' + keep(rtr.dep) + ' → ' + keep(rtr.to) + ' ' + keep(rtr.arr) + ' · ' + keep(OT.fmtDate(rtr.date)) + ' · ' + keep(rc.cls) + ' · ' + OT.esc(availLabel(rc.avail))
    ] : []).concat([
      OT.esc(t('co.cTotal', 'Total')) + ': <strong>' + keep(OT.inr(total)) + '</strong> · ' + OT.esc(method === 'card' ? 'Card (simulated)' : 'UPI (simulated)')
    ]);
    busy = true;
    return OT.confirmAction({
      title: rtr ? t('ret.cTitle', 'Confirm both trains and one payment') : t('trn.cTitle', 'Confirm train booking and payment'),
      intro: t('co.cIntro', 'Please check these details. PNR, train number, dates and amounts are shown exactly as booked (never translated).'),
      lines: lines, note: OT.esc(t('trn.irctcNote', 'Final booking happens on IRCTC — simulated here. No money moves.')),
      confirmLabel: t('co.cOk', 'Confirm & pay {amt}', { amt: OT.inr(total) })
    }).then(function (ok) {
      if (!ok) { busy = false; return false; }
      OT.state.payPending = true;
      var b = root && root.querySelector('#trn-pay');
      if (b) { b.disabled = true; b.innerHTML = '<span class="spinner"></span> ' + OT.esc(t('trn.processing', 'Booking on the simulated IRCTC gateway…')); }
      return OT.sleep(900).then(function () {
        var tk = R().book({ no: tr.no, from: tr.from, to: tr.to, date: tr.date, cls: c.cls, passengers: bookState.pax, method: method });
        var ref = 'OT-TRN-' + code5();
        tk.ref = ref; tk.txn = 'SIM-TXN-' + code5() + code5().slice(0, 3);
        if (attach) return attachReturn(tk, n, q);
        var rtk = null;
        if (rtr) { rtk = R().book({ no: rtr.no, from: rtr.from, to: rtr.to, date: rtr.date, cls: rc.cls, passengers: bookState.pax, method: method }); rtk.ref = 'OT-TRN-' + code5(); rtk.txn = tk.txn; rtk.leg = 'return'; }
        var pp = q.pkg && OT.state.pendingPackage, nights = pp ? pp.nights : 2;
        // the traveller may pick a different date than the package suggested: the stay still ends on the package's return date
        if (pp && pp.ret) nights = Math.max(1, Math.round((R().parseYmd(pp.ret) - R().parseYmd(tk.arrDate)) / 86400000));
        if (rtk) nights = Math.max(1, Math.round((R().parseYmd(rtk.date) - R().parseYmd(tk.arrDate)) / 86400000));
        var prev = OT.store.get('journey');
        var j = D().journeyFromTicket(tk, { nights: nights });
        // "Add a train to this trip": a standalone trip to the same city keeps its hotel, transport, food and sights
        // (v1.2.2: so does a trip whose train was kept unpaid for checkout: paying now replaces that train)
        if (prev && prev.scenario === tk.to && ((!prev.train && prev.kind === 'trip') || (prev.hold && !prev.pnr))) {
          j.items = (prev.items || []).slice(); j.budget = prev.budget || j.budget; j.budgetMin = prev.budgetMin; j.id = prev.id;
          if (prev.end) j.nights = Math.max(1, Math.round((R().parseYmd(prev.end) - R().parseYmd(tk.arrDate)) / 86400000)) || j.nights;
          if (prev.meterRides) j.meterRides = prev.meterRides.slice();
          if (!rtk) carryReturn(prev, j, tk.arrDate, method);
        }
        if (rtk) { j.returnTrain = returnFromTicket(rtk, rtk.ref); j.roundTrip = true; }
        OT.store.set('journey', j);
        OT.store.update('bookings', function (l) {
          var add = [trainBooking(tk, ref, j, n, rtk ? { leg: 'outward' } : null)];
          if (rtk) add.push(trainBooking(rtk, rtk.ref, j, n, { leg: 'return', title: t('ret.bkTitle', 'Return: {no} {name}', { no: rtk.no, name: rtk.name }) }));
          return (l || []).concat(add);
        });
        OT.state.lastRun = null; OT.state.lastCheckout = null; bookState = null; busy = false;
        OT.emit('train:booked', tk);
        OT.go('trains/ticket?pnr=' + tk.pnr);
        OT.paySuccess.show({
          amount: tk.total + (rtk ? rtk.total : 0), method: method === 'card' ? 'Card (simulated)' : 'UPI (simulated)', txn: tk.txn, at: tk.bookedAt, viewHref: 'journey',
          paidTo: t('ps2.irctc', 'IRCTC (simulated gateway) via OneTrip'),
          refs: rtk ? [{ icon: 'train', label: t('ret.outLbl', 'Outward') + ' · ' + tk.no + ' ' + tk.name + ' · ' + tk.status, ref: 'PNR ' + tk.pnr },
            { icon: 'train', label: t('ret.retLbl', 'Return') + ' · ' + rtk.no + ' ' + rtk.name + ' · ' + rtk.status, ref: 'PNR ' + rtk.pnr },
            { icon: 'checkCircle', label: t('ps2.bookingRef', 'OneTrip booking ref'), ref: ref }, { icon: 'checkCircle', label: t('ps2.bookingRef', 'OneTrip booking ref'), ref: rtk.ref }]
            : [{ icon: 'train', label: tk.no + ' ' + tk.name + ' · ' + tk.status, ref: 'PNR ' + tk.pnr }, { icon: 'checkCircle', label: t('ps2.bookingRef', 'OneTrip booking ref'), ref: ref }]
        });
        return tk;
      });
    });
  }

  /** "Add return train" from My Journey: the ticket becomes journey.returnTrain of the SAME journey. */
  function attachReturn(tk, n, q) {
    var j = OT.store.get('journey');
    tk.leg = 'return';
    if (!j || !j.train) { busy = false; OT.toast(t('ret.noJourney', 'No journey to attach the return to. Book the outward train first.'), 'error'); return tk; }
    j.returnTrain = returnFromTicket(tk, tk.ref);
    if (j.hold) { j.hold.legs = (j.hold.legs || []).filter(function (l) { return l.leg !== 'return'; }); if (!j.hold.legs.length) delete j.hold; }
    OT.store.set('journey', j);
    OT.store.update('bookings', function (l) { return (l || []).concat([trainBooking(tk, tk.ref, j, n, { leg: 'return', title: t('ret.bkTitle', 'Return: {no} {name}', { no: tk.no, name: tk.name }) })]); });
    OT.state.lastCheckout = null; bookState = null; busy = false;
    OT.emit('train:booked', tk);
    OT.go('journey');
    OT.paySuccess.show({
      amount: tk.total, method: method === 'card' ? 'Card (simulated)' : 'UPI (simulated)', txn: tk.txn, at: tk.bookedAt, viewHref: 'journey',
      paidTo: t('ps2.irctc', 'IRCTC (simulated gateway) via OneTrip'),
      refs: [{ icon: 'train', label: t('ret.retLbl', 'Return') + ' · ' + tk.no + ' ' + tk.name + ' · ' + tk.status, ref: 'PNR ' + tk.pnr }, { icon: 'checkCircle', label: t('ps2.bookingRef', 'OneTrip booking ref'), ref: tk.ref }]
    });
    return tk;
  }

  /* ---------------- v1.2.2: keep the train(s) in the trip unpaid, pay once at checkout ----------------
   * journey.hold = { legs: [ { leg:'outward'|'return', no, name, type, from, to, date, dep, arr, arrDate, cls, farePerPax, chance, avail, pax:[…] } ], method, createdAt }
   * journey.train / journey.returnTrain carry status 'HELD' (no PNR, no booking) until checkout issues the tickets.
   * Unpaid legs are never in OT.store 'bookings', so Bookings & refunds, partner and admin GTV never count them.
   */
  function convFor(m) { return m === 'card' ? 35 : 20; }
  function legOf(tr, c, leg, pax) {
    return { leg: leg, no: tr.no, name: tr.name, type: tr.type, from: tr.from, to: tr.to, date: tr.date, dep: tr.dep, arr: tr.arr, arrDate: D().addDays(tr.date, tr.arrOffset),
      cls: c.cls, farePerPax: c.fare.total, chance: R().chance(c.avail, tr.date), avail: c.avail.label, pax: pax.map(function (p) { return { name: p.name, age: p.age, gender: p.gender, pref: p.pref }; }) };
  }
  function legAmount(l, m) { return l.farePerPax * ((l.pax || []).length || 1) + convFor(m); }
  function heldTrain(l, m) {
    return { no: l.no, name: l.name, from: l.from, fromName: R().stations[l.from] ? R().stations[l.from].names.en : l.from, to: l.to, toName: R().stations[l.to] ? R().stations[l.to].names.en : l.to,
      date: l.date, dep: l.dep, arr: l.arr, arrDate: l.arrDate, cls: l.cls, coach: '—', seats: [], status: 'HELD', fare: legAmount(l, m), chance: l.chance, held: true, pnr: null };
  }
  function holdOf(j) { j = j === undefined ? OT.store.get('journey') : j; return j && j.hold && Array.isArray(j.hold.legs) && j.hold.legs.length ? j.hold : null; }
  /** '' when the held leg can still be booked, else a clear message. */
  function legProblem(l) {
    var depMs = new Date(l.date + 'T' + l.dep + ':00').getTime();
    if (!(depMs > Date.now())) return t('hold.errLeft', 'Train {no} left on {date} at {dep}, so it can no longer be booked. Remove it from your trip or choose another train.', { no: l.no, date: OT.fmtDate(l.date), dep: l.dep });
    var tr = R().train(l.no, l.from, l.to, l.date), c = tr && tr.classes.filter(function (x) { return x.cls === l.cls; })[0];
    if (!c) return t('trn.gone', 'This train is not in the timetable for that date.');
    if (c.avail.state === 'DEPARTED') return t('hold.errClosed', 'Booking for train {no} has closed: it leaves at {dep} today. Remove it from your trip or choose another train.', { no: l.no, dep: l.dep });
    if (c.avail.state === 'REGRET') return t('hold.errFull', 'Train {no} ({cls}) is now full. Remove it from your trip or choose another train.', { no: l.no, cls: l.cls });
    return '';
  }
  function legLabel(l, round) { return round || l.leg === 'return' ? (l.leg === 'return' ? t('ret.retLbl', 'Return') : t('ret.outLbl', 'Outward')) : t('trip.train', 'Train'); }
  function holdSearchPath(l, j) {
    var out = l.leg !== 'return';
    return 'trains?' + qs({ from: l.from, to: l.to, date: l.date, cls: l.cls, pax: (l.pax || []).length || (j && j.passengers) || 1, attach: out ? '' : 'return' });
  }
  /** "Trains in your trip (not paid yet) · ₹X · Pay everything at checkout" */
  function holdBannerHTML(j, o) {
    var h = holdOf(j); if (!h) return '';
    o = o || {};
    var round = h.legs.length > 1, amt = h.legs.reduce(function (s, l) { return s + legAmount(l, h.method); }, 0);
    var bad = h.legs.map(legProblem).filter(Boolean);
    return '<div class="hold-banner' + (bad.length ? ' is-bad' : '') + '" data-hold-banner role="status">' + OT.icon('train', 20) +
      '<div class="hb-main"><strong>' + OT.esc(t('hold.banner', 'Trains in your trip (not paid yet) · {amt} · Pay everything at checkout', { amt: OT.inr(amt) })) + '</strong>' +
      h.legs.map(function (l) { return '<span class="small">' + OT.esc(legLabel(l, round)) + ': <bdi class="keep">' + l.no + '</bdi> ' + OT.esc(l.name) + ' · <bdi class="keep">' + l.from + ' ' + l.dep + '</bdi> → <bdi class="keep">' + l.to + ' ' + l.arr + '</bdi> · <bdi class="keep">' + OT.esc(OT.fmtDate(l.date)) + '</bdi> · <bdi class="keep">' + l.cls + '</bdi> × ' + (l.pax || []).length + '</span>'; }).join('') +
      (bad.length ? '<span class="small text-warn">' + OT.icon('alert', 12) + ' ' + OT.esc(bad[0]) + '</span>' : '') + '</div>' +
      (o.cta === false ? '' : '<a class="btn btn-accent btn-sm" href="#/checkout" data-hold-pay>' + OT.icon('wallet', 15) + OT.esc(t('hold.payAll', 'Review & pay for everything')) + '</a>') + '</div>';
  }

  /** v1.2.2 verify: "Change outward train" keeps the trip's return (held or paid) when the new outward arrives before it leaves. */
  function carryReturn(prev, j, arrDate, m) {
    var r = OT.agents.liveReturn(prev); if (!r || !(r.date >= arrDate)) return;
    var rl = holdOf(prev) ? prev.hold.legs.filter(function (l) { return l.leg === 'return'; })[0] : null;
    if (r.held && !rl) return;
    j.returnTrain = r; j.roundTrip = true;
    j.nights = Math.max(1, Math.round((R().parseYmd(r.date) - R().parseYmd(arrDate)) / 86400000));
    if (rl) {
      if (holdOf(j)) j.hold.legs = j.hold.legs.filter(function (l) { return l.leg !== 'return'; }).concat([rl]);
      else j.hold = { legs: [rl], method: m, createdAt: prev.hold.createdAt };
      j.returnTrain = heldTrain(rl, j.hold.method);
    }
  }
  function holdForLater(q) {
    if (busy || !root) return Promise.resolve(false);
    var el = root, tr = R().train(q.no, q.from, q.to, q.date);
    var c = tr && tr.classes.filter(function (x) { return x.cls === q.cls; })[0];
    if (!c) return Promise.resolve(false);
    var rtr = q.rno ? R().train(q.rno, q.to, q.from, q.ret) : null, rc = rtr && rtr.classes.filter(function (x) { return x.cls === q.rcls; })[0];
    if (q.rno && !rc) return Promise.resolve(false);
    if (!paxValid(el)) return Promise.resolve(false);
    var attach = q.attach === 'return' && !rtr, pax = bookState.pax;
    var legs = [legOf(tr, c, attach ? 'return' : 'outward', pax)];
    if (rtr) legs.push(legOf(rtr, rc, 'return', pax));
    var bad = legs.map(legProblem).filter(Boolean);
    if (bad.length) { var err = el.querySelector('#px-err'); err.textContent = bad[0]; err.classList.remove('hidden'); return Promise.resolve(false); }
    var now = new Date().toISOString(), j, to;
    if (attach) {
      j = OT.store.get('journey');
      if (!j || !j.train) { OT.toast(t('ret.noJourney', 'No journey to attach the return to. Book the outward train first.'), 'error'); return Promise.resolve(false); }
      var keepLegs = holdOf(j) ? j.hold.legs.filter(function (l) { return l.leg !== 'return'; }) : [];
      j.hold = { legs: keepLegs.concat(legs), method: method, createdAt: (j.hold && j.hold.createdAt) || now };
      j.returnTrain = heldTrain(legs[0], method);
      to = j.scenario;
    } else {
      var out = legs[0], n = pax.length;
      var pp = q.pkg && OT.state.pendingPackage, nights = pp ? pp.nights : 2;
      if (pp && pp.ret) nights = Math.max(1, Math.round((R().parseYmd(pp.ret) - R().parseYmd(out.arrDate)) / 86400000));
      if (rtr) nights = Math.max(1, Math.round((R().parseYmd(rtr.date) - R().parseYmd(out.arrDate)) / 86400000));
      var tk = { pnr: null, ref: null, no: out.no, name: out.name, from: out.from, to: out.to, fromName: heldTrain(out, method).fromName, toName: heldTrain(out, method).toName, date: out.date, dep: out.dep, arr: out.arr, arrDate: out.arrDate,
        cls: out.cls, status: 'HELD', chance: out.chance, passengers: out.pax.map(function () { return {}; }), total: legAmount(out, method) };
      var prev = OT.store.get('journey');
      j = D().journeyFromTicket(tk, { nights: nights });
      // no "Sample return … (PNR …)" / "Link return PNR" for an unpaid OneTrip train (that sample is for IRCTC-linked trips)
      j.pnr = null; j.ticketRef = null; j.bookedViaOneTrip = false; j.passengers = n; j.returnOption = null;
      // replace, never duplicate: the same trip (an earlier unpaid train, or a standalone stay in that city) keeps its services
      if (prev && prev.scenario === out.to && ((!prev.train && prev.kind === 'trip') || (holdOf(prev) && !prev.pnr))) {
        j.items = (prev.items || []).slice(); j.budget = prev.budget || j.budget; j.budgetMin = prev.budgetMin; j.id = prev.id; j.prefs = prev.prefs || j.prefs;
        if (prev.end && !prev.train) j.nights = Math.max(1, Math.round((R().parseYmd(prev.end) - R().parseYmd(out.arrDate)) / 86400000)) || j.nights;
        if (prev.meterRides) j.meterRides = prev.meterRides.slice();
      }
      j.train = heldTrain(out, method);
      j.hold = { legs: legs, method: method, createdAt: now };
      if (!rtr && prev && j.id === prev.id) carryReturn(prev, j, out.arrDate, method);
      if (rtr) { j.returnTrain = heldTrain(legs[1], method); j.roundTrip = true; }
      to = out.to;
      var pk = OT.state.pendingPackage;
      if (pk && pk.to === to) OT.state.applyPackage = pk;
      OT.state.pendingPackage = null;
      OT.state.lastRun = null;
    }
    OT.store.set('journey', j);
    OT.state.lastCheckout = null; bookState = null; busy = false;
    OT.emit('train:held', j.hold);
    OT.toast(legs.length > 1 ? t('hold.toast2', 'Both trains are in your trip, not paid yet. Add services, then pay once at checkout.') : t('hold.toast', 'Train added to your trip, not paid yet. Add services, then pay once at checkout.'), 'success');
    OT.go(attach ? 'journey' : 'results?to=' + to);
    return Promise.resolve(j);
  }

  /** Checkout: book every held leg with the checkout's payment (one transaction). Returns { tickets, bookings, refs }. */
  function issueHeld(m, methodLabel, txn) {
    var j = OT.store.get('journey'), h = holdOf(j);
    if (!h) return { tickets: [], bookings: [], refs: [] };
    var round = h.legs.length > 1 || h.legs.some(function (l) { return l.leg === 'return'; }) || !!(OT.agents.liveReturn(j) && !j.returnTrain.held);
    var out = { tickets: [], bookings: [], refs: [] };
    h.legs.forEach(function (l) {
      var tk = R().book({ no: l.no, from: l.from, to: l.to, date: l.date, cls: l.cls, passengers: l.pax, method: m === 'card' ? 'card' : 'upi' });
      tk.ref = 'OT-TRN-' + code5(); tk.txn = txn;
      if (l.leg === 'return') {
        tk.leg = 'return';
        j.returnTrain = returnFromTicket(tk, tk.ref);
      } else {
        var cnf = (tk.passengers || []).filter(function (p) { return p.coach; })[0];
        j.train = { no: tk.no, name: tk.name, from: tk.from, fromName: tk.fromName, to: tk.to, toName: tk.toName, date: tk.date, dep: tk.dep, arr: tk.arr, arrDate: tk.arrDate,
          cls: tk.cls, coach: cnf ? cnf.coach : '—', seats: (tk.passengers || []).map(function (p) { return p.berth ? String(p.berth) : p.status; }), status: tk.status, fare: tk.total, chance: tk.chance };
        j.pnr = tk.pnr; j.ticketRef = tk.ref; j.bookedViaOneTrip = true;
      }
      out.tickets.push(tk);
      out.bookings.push(trainBooking(tk, tk.ref, j, (l.pax || []).length || 1, l.leg === 'return' ? { leg: 'return', title: t('ret.bkTitle', 'Return: {no} {name}', { no: tk.no, name: tk.name }) } : round ? { leg: 'outward' } : null, methodLabel));
      out.refs.push({ icon: 'train', label: (round ? legLabel(l, true) + ' · ' : '') + tk.no + ' ' + tk.name + ' · ' + tk.status, ref: 'PNR ' + tk.pnr });
    });
    delete j.hold;
    OT.store.set('journey', j);
    out.tickets.forEach(function (tk) { OT.emit('train:booked', tk); });
    return out;
  }
  /** Remove an unpaid leg (the outward takes the held return with it). Asks first. */
  function removeHeld(leg) {
    var j = OT.store.get('journey'), h = holdOf(j);
    if (!h) return Promise.resolve(false);
    var drop = h.legs.filter(function (l) { return leg === 'return' ? l.leg === 'return' : true; });
    if (!drop.length) return Promise.resolve(false);
    var round = h.legs.length > 1, pr = OT.agents.liveReturn(j);
    // v1.2.2 verify: a PAID return cannot stay in a trip without its outward train: say so instead of hiding it from the journey
    if (leg !== 'return' && pr && !pr.held) {
      return OT.confirmAction({
        title: t('hold.rmPaidTitle', 'Your return train is already paid'),
        lines: [OT.esc(t('ret.retLbl', 'Return')) + ': ' + keep(pr.no) + ' ' + OT.esc(pr.name) + ' · PNR ' + keep(pr.pnr) + ' · ' + keep(OT.fmtDate(pr.date)),
          OT.esc(t('hold.rmPaidNote', 'The unpaid outward train cannot be removed on its own while the return is booked. Cancel the return in Bookings & refunds first (railway refund rules apply), or choose another outward train.'))],
        confirmLabel: t('nav.bookings', 'Bookings & refunds'), cancelLabel: t('hold.rmKeep', 'Keep it')
      }).then(function (ok) { if (ok) OT.go('bookings'); return false; });
    }
    return OT.confirmAction({
      title: drop.length > 1 ? t('hold.rmTitle2', 'Remove both unpaid trains from your trip?') : t('hold.rmTitle', 'Remove the unpaid train from your trip?'),
      lines: drop.map(function (l) { return OT.esc(legLabel(l, round)) + ': ' + keep(l.no) + ' ' + OT.esc(l.name) + ' · ' + keep(l.from) + ' → ' + keep(l.to) + ' · ' + keep(OT.fmtDate(l.date)) + ' · ' + keep(OT.inr(legAmount(l, h.method))); })
        .concat([OT.esc(t('hold.rmNote', 'Nothing was paid or booked for it, so there is nothing to refund. Your hotel, transport, food and sights stay in the trip.'))]),
      confirmLabel: t('hold.rmOk', 'Remove train'), cancelLabel: t('hold.rmKeep', 'Keep it'), danger: true
    }).then(function (ok) {
      if (!ok) return false;
      var jj = OT.store.get('journey'); if (!holdOf(jj)) return false;
      if (leg === 'return') {
        jj.hold.legs = jj.hold.legs.filter(function (l) { return l.leg !== 'return'; });
        if (jj.returnTrain && jj.returnTrain.held) jj.returnTrain = null;
        jj.roundTrip = false;
        if (!jj.hold.legs.length) delete jj.hold;
        OT.store.set('journey', jj);
      } else {
        var live = (jj.items || []).some(function (i) { return i.status !== 'cancelled'; }) || (jj.meterRides || []).length;
        if (!live) { OT.store.set('journey', undefined); }
        else {
          var arr = jj.train.arrDate || jj.train.date;
          var stay = (jj.items || []).filter(function (i) { return i.type === 'hotel' && i.status !== 'cancelled' && i.endWhen; })[0];
          jj.kind = 'trip'; jj.city = jj.scenario; jj.start = arr; jj.end = stay ? String(stay.endWhen).slice(0, 10) : D().addDays(arr, jj.nights || 1);
          jj.train = null; jj.pnr = null; jj.returnTrain = null; jj.returnOption = null; jj.roundTrip = false; delete jj.hold;
          OT.store.set('journey', jj);
        }
      }
      OT.state.lastRun = null;
      OT.toast(t('hold.removed', 'Unpaid train removed from your trip.'), 'info');
      return true;
    });
  }

  /* ---------------- ticket ---------------- */
  function findBooking(pnr) { return (OT.store.get('bookings', []) || []).filter(function (b) { return b.type === 'train' && b.pnr === pnr; })[0] || null; }
  function renderTicket(el, q) {
    var b = findBooking(q.pnr);
    if (!b) { el.innerHTML = '<div class="container page"><div class="card empty-state">' + OT.icon('train', 30) + '<p>' + OT.esc(t('trn.noTicket', 'Ticket not found in this browser.')) + '</p><a class="btn btn-primary" href="#/trains">' + OT.esc(t('trn.title', 'Find trains')) + '</a></div></div>'; return; }
    var tk = b.ticket, cancelled = b.status !== 'confirmed';
    var jr = OT.store.get('journey'); if (jr && jr.pnr !== tk.pnr) jr = null;
    if (b.leg === 'return') jr = null;
    var city = sname(tk.to);
    var st = tk.status === 'CNF' ? 'confirmed' : tk.status === 'REGRET' ? 'unavailable' : 'pending';
    el.innerHTML = '<div class="container page trains-ticket">' +
      '<div class="card eticket" data-tour="ticket">' +
      '<div class="et-head"><div><p class="ot-eyebrow">' + OT.icon('checkCircle', 14) + ' ' + OT.esc(t('trn.booked', 'Train booked (simulated)')) + '</p>' +
      '<h1 class="h2">PNR ' + keep(tk.pnr) + '</h1><p class="small muted">' + OT.esc(t('trn.ers', 'Electronic Reservation Slip (simulated) · Final booking happens on IRCTC — simulated here.')) + '</p></div>' +
      '<div class="et-status">' + OT.badge(cancelled ? 'cancelled' : st, cancelled ? null : tk.status) + '</div></div>' +
      '<div class="ticket-route et-route"><div><span class="tk-code">' + keep(tk.from) + '</span><span class="small">' + OT.esc(sname(tk.from)) + '</span><span class="tk-time">' + keep(tk.dep) + '</span><span class="xs muted">' + keep(OT.fmtDate(tk.date)) + '</span></div>' +
      '<div class="tk-line" aria-hidden="true"><span></span>' + OT.icon('train', 16) + '<span></span></div>' +
      '<div class="tk-r"><span class="tk-code">' + keep(tk.to) + '</span><span class="small">' + OT.esc(city) + '</span><span class="tk-time">' + keep(tk.arr) + '</span><span class="xs muted">' + keep(OT.fmtDate(tk.arrDate)) + '</span></div></div>' +
      '<dl class="ticket-meta small et-meta"><div><dt>' + OT.esc(t('trip.train', 'Train')) + '</dt><dd>' + keep(tk.no) + ' ' + OT.esc(tk.name) + '</dd></div>' +
      '<div><dt>' + OT.esc(t('trip.class', 'Class')) + '</dt><dd>' + keep(tk.cls) + ' · GN</dd></div><div><dt>' + OT.esc(t('trn.distance', 'Distance')) + '</dt><dd>' + tk.km + ' km</dd></div>' +
      '<div><dt>' + OT.esc(t('bk.txn', 'Transaction')) + '</dt><dd>' + keep(tk.txn) + '</dd></div><div><dt>' + OT.esc(t('co.cTotal', 'Total')) + '</dt><dd>' + keep(OT.inr(tk.total)) + '</dd></div></dl>' +
      '<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>' + OT.esc(t('auth.name', 'Full name')) + '</th><th>' + OT.esc(t('trn.age', 'Age')) + '</th><th>' + OT.esc(t('trn.status', 'Booking status')) + '</th></tr></thead><tbody>' +
      tk.passengers.map(function (p, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + OT.esc(p.name) + ' <span class="xs muted">' + OT.esc(p.gender) + '</span></td><td>' + OT.esc(p.age) + '</td><td><bdi class="keep">' + OT.esc(p.coach ? 'CNF/' + p.coach + '/' + p.berth + '/' + p.berthType : p.status) + '</bdi></td></tr>';
      }).join('') + '</tbody></table></div>' +
      (tk.status !== 'CNF' ? '<div class="chance"><div class="row between small"><strong>' + OT.esc(t('trn.chanceTitle', 'Chance of confirmation (simulated estimate)')) + '</strong><bdi>' + tk.chance + '%</bdi></div><div class="bar"><span style="width:' + tk.chance + '%"></span></div>' +
        '<p class="xs muted">' + OT.esc(t('trn.chanceNote', 'Based on waitlist position, days to travel and long-weekend demand. If it stays waitlisted at chart preparation, the fare is refunded automatically (railway rules).')) + '</p></div>' : '') +
      '</div>' +
      (jr && OT.agents.liveReturn(jr) ? (function (r) {
        return '<div class="card-flat ret-out" data-ticket-return>' + OT.icon('refresh', 18) + '<div><span class="xs muted">' + OT.esc(t('ret.title', 'Return train')) + '</span><strong>PNR <bdi class="keep">' + r.pnr + '</bdi> · <bdi class="keep">' + r.no + '</bdi> ' + OT.esc(r.name) + '</strong>' +
          '<span class="small"><bdi class="keep">' + r.from + ' ' + r.dep + '</bdi> → <bdi class="keep">' + r.to + ' ' + r.arr + '</bdi> · <bdi class="keep">' + OT.esc(OT.fmtDate(r.date)) + '</bdi> · <bdi class="keep">' + r.status + '</bdi></span></div>' +
          '<a class="btn btn-ghost btn-sm" href="#/trains/ticket?pnr=' + r.pnr + '">' + OT.esc(t('bk.eticket', 'View e-ticket')) + '</a></div>';
      })(OT.agents.liveReturn(jr)) : '') +
      (cancelled || b.leg === 'return' ? '' : '<div class="card plan-next" data-tour="plan-next"><div><h2 class="h3">' + OT.icon('route', 18) + ' ' + OT.esc(t('trn.nextTitle', 'Step 3 · Your train is in My Journey')) + '</h2>' +
        '<p class="small muted">' + OT.esc(t('trn.nextSub', 'AI agents can now research and verify a hotel, station cab, food and sights around your arrival at {arr} in {city}.', { arr: tk.arr, city: city })) + '</p>' +
        OT.budget.html({ id: 'pb', lo: (jr && jr.budgetMin) || OT.budget.MIN, hi: (jr && jr.budget) || 3000, count: false }) + '</div>' +
        '<a class="btn btn-accent btn-lg" id="plan-stay" href="#/results?to=' + tk.to + '">' + OT.icon('spark', 18) + OT.esc(t('trn.planStay', 'Now plan your stay & travel in {city}', { city: city })) + '</a></div>') +
      '<div class="row-wrap mt12"><a class="btn btn-ghost" href="#/journey">' + OT.icon('route', 16) + OT.esc(t('nav.journey', 'My Journey')) + '</a><a class="btn btn-ghost" href="#/bookings">' + OT.esc(t('nav.bookings', 'Bookings & refunds')) + '</a>' +
      '<button type="button" class="btn btn-ghost" onclick="window.print()">' + OT.esc(t('journey.print', 'Print')) + '</button></div></div>';
    OT.budget.bind(el, 'pb', function (lo, hi) { OT.store.update('journey', function (x) { if (x && x.pnr === tk.pnr) { x.budget = hi; x.budgetMin = lo; } return x; }); });
    var ps = el.querySelector('#plan-stay');
    if (ps) ps.addEventListener('click', function () {
      var pk = OT.state.pendingPackage;
      if (pk && pk.to === tk.to) OT.state.applyPackage = pk;
      OT.state.pendingPackage = null;
    });
  }

  function render(el, params) {
    root = el;
    var q = params.query || {};
    if (params.sub === 'book') return renderBook(el, q);
    if (params.sub === 'ticket') return renderTicket(el, q);
    return renderSearch(el, q);
  }

  OT.registerView('trains', {
    title: function () { return OT.t('nav.trains', 'Trains'); },
    section: 'trains',
    render: render,
    onLeave: function () { root = null; busy = false; },
    pay: pay,
    hold: holdForLater
  });
  OT.trainHold = { get: holdOf, legAmount: legAmount, conv: convFor, problem: legProblem, label: legLabel, banner: holdBannerHTML, issue: issueHeld, remove: removeHeld, searchPath: holdSearchPath,
    amount: function (j, m) { var h = holdOf(j); return h ? h.legs.reduce(function (s, l) { return s + legAmount(l, m || h.method); }, 0) : 0; } };
  OT.trains = { picker: picker, bindPicker: bindPicker, codeOf: codeOf, setCode: setCode, heardChips: heardChips, path: function (o) { return 'trains?' + qs(o); }, tomorrow: tomorrow,
    tripToggle: tripToggle, datePair: datePair, bindTrip: bindTrip, setRound: setRound, isRound: isRound, tripError: tripError, tripVals: tripVals };
})();
