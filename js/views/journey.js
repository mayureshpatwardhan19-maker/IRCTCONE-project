/* IRCTC OneTrip — My Journey: Trip Readiness ring, railway route-line timeline, conflict flags,
 * add/remove/retime items, consolidated itinerary, play itinerary aloud. (Builder A)
 */
(function () {
  'use strict';
  var OT = window.OT;
  var D = function () { return OT.data.travel; };
  var root = null;
  function t(k, fb, v) { return OT.t(k, fb, v); }
  function L() { return OT.i18n.lang(); }
  function keep(v) { return OT.lang.keep(v); }
  function tm(iso) { return iso ? String(iso).slice(11, 16) : ''; }

  var PART_LABEL = {
    ticket: ['ready.ticket', 'Train ticket'], stay: ['ready.stay', 'Stay'], transfer: ['ready.transfer', 'Station transfer'],
    meal: ['ready.meal', 'Meal'], ret: ['ready.return', 'Return journey'], conflicts: ['ready.conflicts', 'Timing conflicts resolved']
  };
  var STATE_LABEL = {
    booked: ['ready.s.booked', 'Booked'], planned: ['ready.s.planned', 'Planned (80%)'], confirm: ['ready.s.confirm', 'Needs confirmation (50%)'],
    missing: ['ready.s.missing', 'Missing'], open: ['ready.s.open', 'Open conflict'], cancelled: ['ready.s.cancelled', 'Cancelled'],
    meter: ['ready.s.meter', 'Auto on meter (no booking needed)'], unpaid: ['hold.ready', 'In your trip, not paid yet (80%)']
  };

  /* ---------------- Readiness ring ---------------- */
  function ringHTML(score, from) {
    var r = 52, c = 2 * Math.PI * r;
    var off = c * (1 - score / 100), off0 = c * (1 - (from == null ? score : from) / 100);
    var tone = score >= 80 ? 'ok' : score >= 50 ? 'mid' : 'low';
    return '<div class="ring ring-' + tone + '" role="img" aria-label="' + OT.esc(t('ready.aria', 'Trip Readiness {s} percent', { s: score })) + '">' +
      '<svg viewBox="0 0 120 120" width="132" height="132"><circle class="ring-bg" cx="60" cy="60" r="' + r + '"/>' +
      '<circle class="ring-fg" cx="60" cy="60" r="' + r + '" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off0.toFixed(1) + '" data-to="' + off.toFixed(1) + '" transform="rotate(-90 60 60)"/></svg>' +
      '<div class="ring-val"><strong data-count-from="' + (from == null ? score : from) + '" data-count-to="' + score + '">' + (from == null ? score : from) + '</strong><span>%</span></div></div>';
  }
  function animateRing(el) {
    var fg = el.querySelector('.ring-fg'), num = el.querySelector('[data-count-to]');
    if (!fg) return;
    requestAnimationFrame(function () { requestAnimationFrame(function () { fg.style.strokeDashoffset = fg.getAttribute('data-to'); }); });
    var a = +num.getAttribute('data-count-from'), b = +num.getAttribute('data-count-to');
    if (a === b) return;
    var t0 = performance.now();
    (function step(now) {
      var p = Math.min(1, (now - t0) / 800);
      num.textContent = Math.round(a + (b - a) * p);
      if (p < 1 && document.body.contains(num)) requestAnimationFrame(step);
    })(t0);
  }

  function readinessHTML(j, rd, from) {
    return '<div class="card readiness" data-tour="readiness"><div class="card-head"><h2 class="h3">' + OT.esc(t('ready.title', 'Trip Readiness')) + '</h2>' +
      '<span class="xs muted">' + OT.esc(t('ready.formula', 'Weighted checklist')) + '</span></div>' +
      '<div class="ready-wrap">' + ringHTML(rd.score, from) +
      '<ul class="ready-list">' + rd.parts.map(function (p) {
        var ic = p.state === 'booked' || p.state === 'meter' ? 'checkCircle' : p.state === 'missing' ? 'minus' : 'alert';
        var cls = p.state === 'booked' || p.state === 'meter' ? 'ok' : p.state === 'planned' || p.state === 'unpaid' ? 'plan' : p.state === 'missing' ? 'miss' : 'warn';
        var hint = '';
        if (p.state === 'missing') {
          if (p.id === 'ret') hint = j.train && j.train.status !== 'PLANNED' && j.train.status !== 'CANCELLED' ? '<a class="xs" href="#/' + addReturnPath(j) + '" data-add-return>' + OT.esc(t('ret.add', 'Add return train')) + '</a>' : '';
          else if (rd.trip && p.id === 'transfer') hint = '<a class="xs" href="#/transport?city=' + j.scenario + '&date=' + (j.start || '') + '">' + OT.esc(t('ready.add', 'Add')) + '</a>';
          else if (rd.trip && p.id === 'meal') hint = '<a class="xs" href="#/food?city=' + j.scenario + '&date=' + (j.start || '') + '">' + OT.esc(t('ready.add', 'Add')) + '</a>';
          else if (p.id !== 'ticket') hint = '<a class="xs" href="#/results?to=' + j.scenario + '" data-goto-tab="' + ({ stay: 'hotel', transfer: 'cab', meal: 'food' }[p.id] || 'hotel') + '">' + OT.esc(t('ready.add', 'Add')) + '</a>';
        }
        var pl = rd.trip && p.id === 'transfer' ? ['ready.local', 'Local transport'] : PART_LABEL[p.id];
        return '<li class="rl-' + cls + '">' + OT.icon(ic, 15) + '<span class="rl-name">' + OT.esc(t(pl[0], pl[1])) +
          '<small>' + OT.esc(t(STATE_LABEL[p.state][0], STATE_LABEL[p.state][1])) + '</small></span>' + hint +
          '<span class="rl-pts"><bdi>' + (Math.round(p.pts * 10) / 10) + '</bdi>/' + p.w + '</span></li>';
      }).join('') + '</ul></div>' +
      '<p class="xs muted ready-note">' + OT.esc(rd.trip ? t('ready.explainTrip', 'No train in this trip, so readiness counts stay 42, local transport 33, meal 17 and conflicts 8 (booked = full points, planned = 80%, needs confirmation = 50%). Add a train any time.') : t('ready.explain', 'Booked = full points, planned = 80%, needs confirmation = 50%. Weights: ticket 30, stay 25, transfer 20, meal 10, return 10, conflicts 5.')) + '</p></div>';
  }

  /* ---------------- Timeline (railway route line) ---------------- */
  function fixesFor(c, j) {
    var city = j.scenario, arrDate = j.train.arrDate || j.train.date, out = [];
    var hotel = (j.items || []).filter(function (i) { return i.id === c.hotelItemId; })[0];
    var hx = hotel && D().get(hotel.refId);
    if (hx && hx.earlyCheckIn) out.push({ k: 'early', label: t('tl.fixEarly', 'Request early check-in (+{fee}, hotel must confirm)', { fee: OT.inr(hx.earlyCheckIn.fee) }) });
    var cloak = D().byCity(city, 'sight').filter(function (x) { return x.service === 'cloakroom'; })[0];
    if (cloak) out.push({ k: 'cloak', ref: cloak.id, label: t('tl.fixCloak', 'Leave bags at the station cloakroom ({fee}/bag)', { fee: OT.inr(cloak.price) }) });
    var arrM = OT.agents.time.toMin(j.train.arr), ciM = OT.agents.time.toMin(hx ? hx.checkIn : '14:00');
    var visit = D().byCity(city, 'sight').filter(function (x) {
      if (x.service || x.day) return false; var m = OT.agents.time.toMin(x.slot); return m > arrM && m < ciM;
    }).sort(function (a, b) { return (b.tags.indexOf('gapFill') >= 0) - (a.tags.indexOf('gapFill') >= 0); })[0];
    if (visit) out.push({ k: 'visit', ref: visit.id, label: t('tl.fixVisit', 'Visit {name} in the gap', { name: visit.name }) });
    return out;
  }

  function conflictHTML(c, j) {
    if (c.kind === 'gap') {
      var head = t('tl.conflict', 'Arrival {arr} vs check-in {checkin}: {gap} wait', { arr: c.arr, checkin: c.checkIn, gap: OT.agents.time.fmtGap(c.gapMin) });
      if (c.resolved) {
        var how = { early: t('tl.resEarly', 'early check-in requested (awaiting hotel confirmation)'), cloak: t('tl.resCloak', 'bags at the station cloakroom'), visit: t('tl.resVisit', 'a visit planned in the gap') }[c.how];
        return '<div class="tl-conflict resolved" data-conflict="' + c.id + '">' + OT.icon('checkCircle', 18) + '<div><strong>' + OT.lang.highlight(head) + '</strong>' +
          '<p class="small">' + OT.esc(t('tl.resolved', 'Resolved: {how}.', { how: how })) + '</p></div></div>';
      }
      return '<div class="tl-conflict" data-conflict="' + c.id + '" data-tour="conflict">' + OT.icon('alert', 18) + '<div><strong>' + OT.lang.highlight(head) + '</strong>' +
        '<p class="small">' + OT.esc(t('tl.conflictWhy', 'Itinerary Agent: your train arrives before the hotel\'s standard check-in. Choose one:')) + '</p>' +
        '<div class="fixes">' + fixesFor(c, j).map(function (f) { return '<button type="button" class="btn btn-ghost btn-sm" data-fix="' + f.k + '"' + (f.ref ? ' data-ref="' + f.ref + '"' : '') + '><span>' + OT.lang.highlight(f.label) + '</span></button>'; }).join('') + '</div></div></div>';
    }
    if (c.kind === 'retCheckout') {
      var rh = t('ret.conflict', 'Return train leaves {date} {dep}, before hotel check-out {checkout}', { date: OT.fmtDate(c.date), dep: c.dep, checkout: (c.checkoutDate !== c.date ? OT.fmtDate(c.checkoutDate) + ' ' : '') + c.checkout });
      if (c.resolved) return '<div class="tl-conflict resolved" data-conflict="' + c.id + '">' + OT.icon('checkCircle', 18) + '<div><strong>' + OT.lang.highlight(rh) + '</strong><p class="small">' + OT.esc(t('ret.resolved', 'Resolved: you will check out early to catch the train.')) + '</p></div></div>';
      return '<div class="tl-conflict" data-conflict="' + c.id + '">' + OT.icon('alert', 18) + '<div><strong>' + OT.lang.highlight(rh) + '</strong>' +
        '<p class="small">' + OT.esc(t('ret.conflictWhy', 'Itinerary Agent: you would still be booked into the hotel when the train leaves. Check out early, or cancel the return in Bookings & refunds and pick a later train.')) + '</p>' +
        '<div class="fixes"><button type="button" class="btn btn-ghost btn-sm" data-fix-ret="' + c.hotelItemId + '"><span>' + OT.esc(t('ret.fixEarly', 'I’ll check out early')) + '</span></button>' +
        '<a class="btn btn-ghost btn-sm" href="#/bookings">' + OT.esc(t('nav.bookings', 'Bookings & refunds')) + '</a></div></div></div>';
    }
    var msg = c.kind === 'cabEarly' ? t('tl.cabEarly', 'This pickup is before your train arrives. Change the time.') : c.kind === 'retBeforeArr' ? t('ret.beforeArr', 'The return train leaves before your outward train arrives. Cancel it in Bookings & refunds and pick a later date.') : t('tl.beforeArr', 'This is planned before your train arrives. Change the time.');
    return '<div class="tl-conflict" data-conflict="' + c.id + '">' + OT.icon('alert', 18) + '<div><strong>' + OT.esc(msg) + '</strong></div></div>';
  }

  function nodeHTML(e, j, conflictsAfter) {
    var it = e.item, isStation = !!e.station;
    var badge = '';
    if (it) {
      badge = OT.badge(it.status === 'confirmed' ? 'confirmed' : 'pending', it.status === 'confirmed' ? null : t('status.selected', 'Planned')) +
        (it.verification && it.verification !== 'verified' ? ' ' + OT.badge(it.verification) : ' ' + OT.badge('verified'));
    } else if (e.kind === 'dep' || e.kind === 'arr') badge = statusBadge(j.train) + (e.kind === 'dep' && j.pnr ? ' <span class="xs muted">PNR ' + keep(j.pnr) + '</span>' : '') + ' ' + OT.simTag(t('tl.sampleTiming', 'SAMPLE TIMING'));
    else if (e.kind === 'rdep' || e.kind === 'rarr') badge = statusBadge(j.returnTrain || {}) + (e.kind === 'rdep' && j.returnTrain && j.returnTrain.pnr ? ' <span class="xs muted">PNR ' + keep(j.returnTrain.pnr) + '</span>' : '') + ' ' + OT.simTag();
    else if (e.meter) badge = '<span class="badge b-info" data-meter-badge>' + OT.icon('info', 12) + '<span>' + OT.esc(t('tx.meterBadge', 'Pay on meter')) + '</span></span>';
    var actions = '';
    if (e.meter) actions = '<div class="tl-actions"><span class="xs muted">' + OT.esc(OT.meter.note(e.meter)) + '</span><button type="button" class="btn btn-link small" data-remove-meter="' + e.meter.id + '">' + OT.icon('trash', 14) + ' ' + OT.esc(t('common.remove', 'Remove')) + '</button></div>';
    if (it && e.kind !== 'checkout') {
      var x = D().get(it.refId) || {};
      actions = '<div class="tl-actions">' +
        (it.status === 'selected' && e.kind !== 'stop' ? '<label class="tl-time"><span class="sr-only">' + OT.esc(t('tl.changeTime', 'Change time')) + '</span><input type="time" class="input input-sm" value="' + tm(e.kind === 'checkin' ? it.when : it.when) + '" data-retime="' + it.id + '"' + (e.kind === 'checkin' ? ' disabled title="' + OT.esc(t('tl.fixedCheckin', 'Check-in time is set by the hotel')) + '"' : '') + '></label>' : '') +
        (it.status === 'selected' ? '<button type="button" class="btn btn-link small" data-remove-item="' + it.id + '">' + OT.icon('trash', 14) + ' ' + OT.esc(t('common.remove', 'Remove')) + '</button>' : '') +
        (it.bookingRef ? '<span class="xs muted">' + OT.esc(t('tl.ref', 'Ref')) + ' ' + keep(it.bookingRef) + '</span>' : '') +
        '<span class="xs muted">' + keep(OT.inr(it.price)) + (x.basis ? ' ' + OT.esc({ night: t('res.perNight', 'per night'), person: t('res.perPerson', 'per person'), trip: t('res.perTrip', 'per trip'), bag: t('res.perBag', 'per bag/day') }[x.basis]) : '') + '</span>' +
        '</div>';
    }
    return '<li class="tl-row k-' + e.kind + (e.seg ? ' seg-' + e.seg : '') + (isStation ? ' is-station' : '') + '" data-ev="' + OT.esc(e.id) + '">' +
      '<div class="tl-rail"><span class="tl-node">' + (isStation ? '<bdi class="keep">' + OT.esc(e.station) + '</bdi>' : OT.icon(e.icon, 14)) + '</span></div>' +
      '<div class="tl-card">' +
      '<div class="tl-when">' + (e.when ? keep(tm(e.when)) + ' <span class="xs muted">' + keep(OT.fmtDate(e.when)) + '</span>' : '<span class="muted xs">' + OT.esc(t('tl.noTime', 'Time not set')) + '</span>') + '</div>' +
      '<div class="tl-main"><strong>' + OT.lang.highlight(e.title) + '</strong>' + (e.sub ? '<span class="small muted">' + OT.lang.highlight(e.sub) + '</span>' : '') + '</div>' +
      '<div class="tl-badges">' + badge + '</div>' + actions +
      '</div></li>' +
      conflictsAfter.map(function (c) { return '<li class="tl-row tl-conf-row seg-local"><div class="tl-rail"></div><div class="tl-card-c">' + conflictHTML(c, j) + '</div></li>'; }).join('');
  }

  function timelineHTML(j) {
    var it = OT.agents.itinerary(j);
    var byAfter = {};
    it.conflicts.forEach(function (c) {
      var key = c.after === 'arr' ? 'arr' : c.after;
      (byAfter[key] = byAfter[key] || []).push(c);
    });
    var rows = it.events.map(function (e) {
      var after = (byAfter[e.id] || []).concat(e.itemId && e.kind !== 'checkin' && e.kind !== 'checkout' ? (byAfter[e.itemId] || []) : []);
      return nodeHTML(e, j, after);
    }).join('');
    var addTrain = j.train ? '' : '<li class="tl-row tl-ghost tl-addtrain"><div class="tl-rail"><span class="tl-node">' + OT.icon('train', 14) + '</span></div><div class="tl-card">' +
      '<div class="tl-main"><strong>' + OT.esc(t('trip.noTrain', 'No train in this trip yet')) + '</strong><span class="small muted">' + OT.esc(t('trip.noTrainSub', 'Coming by train? Add it and everything here is re-timed around the arrival.')) + '</span></div>' +
      '<div class="tl-actions"><a class="btn btn-ghost btn-sm" href="#/' + addTrainPath(j) + '">' + OT.icon('plus', 14) + OT.esc(t('trip.addTrain', 'Add a train to this trip')) + '</a></div></div></li>';
    var canRet = j.train && j.train.status !== 'PLANNED' && j.train.status !== 'CANCELLED' && !OT.agents.liveReturn(j);
    var sample = !j.bookedViaOneTrip && !(j.train && j.train.held) && j.returnOption;
    var ghost = !canRet ? '' :
      '<li class="tl-row tl-ghost tl-addreturn" data-tour="add-return"><div class="tl-rail"><span class="tl-node">' + OT.icon('plus', 14) + '</span></div><div class="tl-card">' +
      '<div class="tl-main"><strong>' + OT.esc(t('ret.none', 'No return train yet')) + '</strong><span class="small muted">' +
      OT.lang.highlight(t('ret.hint', 'Going back to {city}? Search trains on {date} and the return joins this journey.', { city: D().stationName(j.train.from, L()), date: OT.fmtDate(returnDate(j)) })) +
      (sample ? ' · ' + OT.lang.highlight(t('tl.returnHint', 'Sample return: {no} {name}, {date} {dep} (PNR {pnr})', { no: j.returnOption.no, name: j.returnOption.name, date: OT.fmtDate(j.returnOption.date), dep: j.returnOption.dep, pnr: j.returnOption.pnr })) : '') + '</span></div>' +
      '<div class="tl-actions"><a class="btn btn-accent btn-sm" href="#/' + addReturnPath(j) + '" data-add-return>' + OT.icon('train', 14) + OT.esc(t('ret.add', 'Add return train')) + '</a>' +
      (sample ? '<button type="button" class="btn btn-ghost btn-sm" data-link-return>' + OT.esc(t('ready.linkReturn', 'Link return PNR')) + '</button>' : '') + '</div></div></li>';
    return '<div class="card timeline-card" data-tour="timeline"><div class="card-head"><h2 class="h3">' + OT.icon('route', 18) + ' ' + OT.esc(t('tl.title', 'Journey timeline')) + '</h2>' +
      '<div class="tl-legend xs"><span class="lg-train"></span>' + OT.esc(t('tl.legendTrain', 'Train')) + '<span class="lg-local"></span>' + OT.esc(t('tl.legendLocal', 'Local')) + '</div></div>' +
      '<ol class="tl">' + addTrain + rows + ghost + '</ol>' + (!it.events.length ? '<p class="small muted">' + OT.esc(t('trip.emptyTl', 'Nothing booked yet. Add a hotel, local transport, food or sights.')) + '</p>' : '') + '</div>';
  }

  /** Ticket status badge: CNF / RAC / WL (+ chance) / PLANNED (not booked) / CANCELLED. */
  function statusBadge(tr) {
    var s = tr.status || 'CNF';
    if (s === 'CNF') return OT.badge('confirmed', t('status.cnf', 'CNF'));
    if (s === 'PLANNED') return OT.badge('pending', t('trip.notBooked', 'Not booked yet'));
    if (s === 'HELD') return '<span data-unpaid-badge>' + OT.badge('pending', t('hold.badgeLong', 'Not paid yet — pay at checkout')) + '</span>';
    if (s === 'CANCELLED') return OT.badge('cancelled');
    return OT.badge('pending', s + (tr.chance != null ? ' · ' + t('trn.chance', '{p}% chance', { p: tr.chance }) : ''));
  }
  /** Return date: the hotel check-out day, else the trip end, else arrival + nights (never before today or the arrival). */
  function returnDate(j) {
    var tr = j.train, arr = tr.arrDate || tr.date;
    var stay = (j.items || []).filter(function (i) { return i.type === 'hotel' && i.status !== 'cancelled' && i.endWhen; })[0];
    var d = stay ? String(stay.endWhen).slice(0, 10) : j.end && j.end > arr ? j.end : D().addDays(arr, j.nights || 2);
    if (d < arr) d = arr;
    var R = OT.data.rail; if (R.daysTo(d) < 0) d = OT.trains.tomorrow();
    return d;
  }
  /** "Add return train": the train search B → A on the check-out date, attached to this journey when booked. */
  function addReturnPath(j) {
    var tr = j.train;
    return OT.trains.path({ from: tr.to, to: tr.from, date: returnDate(j), cls: tr.cls, pax: j.passengers, attach: 'return' });
  }
  function addTrainPath(j) {
    var u = OT.store.get('user') || {}, from = u.homeCity && u.homeCity !== j.scenario ? u.homeCity : (j.scenario === 'NDLS' ? 'CSMT' : 'NDLS');
    // arrive the day the stay starts: search the evening before when that is still ahead, else the start day itself
    var R = OT.data.rail, d = !j.start ? OT.trains.tomorrow() : R.daysTo(D().addDays(j.start, -1)) >= 1 ? D().addDays(j.start, -1) : R.daysTo(j.start) >= 0 ? j.start : OT.trains.tomorrow();
    return OT.trains.path({ from: from, to: j.scenario, date: d, pax: j.passengers });
  }
  /** v1.2: a trip without a train (standalone bookings). */
  function stayHTML(j) {
    var city = D().stationName(j.scenario, L());
    return '<div class="ticket card trip-card" data-tour="trip-card"><div class="ticket-main"><div class="ticket-train"><span class="xs muted">' + OT.esc(t('trip.kind', 'Trip')) + '</span><strong>' + OT.esc(OT.trip.title(j)) + '</strong></div>' +
      '<div class="trip-dates">' + OT.icon('calendar', 16) + ' <bdi class="keep">' + OT.esc(OT.fmtDate(j.start)) + (j.end && j.end !== j.start ? ' – ' + OT.esc(OT.fmtDate(j.end)) : '') + '</bdi></div></div>' +
      '<div class="trip-cta"><p class="small muted">' + OT.esc(t('trip.noTrainLong', 'Booked on its own, no train needed. Travelling to {city} by train? Add it and your stay, transport and meals line up with the arrival.', { city: city })) + '</p>' +
      '<a class="btn btn-accent btn-sm" id="add-train" href="#/' + addTrainPath(j) + '">' + OT.icon('train', 15) + OT.esc(t('trip.addTrain', 'Add a train to this trip')) + '</a></div></div>';
  }
  function tripHTML(j) {
    if (!j.train) return stayHTML(j);
    var tr = j.train, lang = L();
    return '<div class="ticket card" data-tour="ticket">' +
      '<div class="ticket-main">' +
      '<div class="ticket-train"><span class="xs muted">' + OT.esc(t('trip.train', 'Train')) + '</span><strong>' + keep(tr.no) + ' ' + OT.esc(tr.name) + '</strong></div>' +
      '<div class="ticket-route">' +
      '<div><span class="tk-code">' + keep(tr.from) + '</span><span class="small">' + OT.esc(D().stationName(tr.from, lang)) + '</span><span class="tk-time">' + keep(tr.dep) + '</span></div>' +
      '<div class="tk-line" aria-hidden="true"><span></span>' + OT.icon('train', 16) + '<span></span></div>' +
      '<div class="tk-r"><span class="tk-code">' + keep(tr.to) + '</span><span class="small">' + OT.esc(D().stationName(tr.to, lang)) + '</span><span class="tk-time">' + keep(tr.arr) + '</span></div>' +
      '</div></div>' +
      '<dl class="ticket-meta small">' +
      '<div><dt>PNR</dt><dd>' + (j.pnr ? keep(j.pnr) : '—') + '</dd></div>' +
      '<div><dt>' + OT.esc(t('trip.date', 'Date')) + '</dt><dd>' + keep(OT.fmtDate(tr.date)) + '</dd></div>' +
      '<div><dt>' + OT.esc(t('trip.class', 'Class')) + '</dt><dd>' + keep(tr.cls) + '</dd></div>' +
      '<div><dt>' + OT.esc(t('trip.seats', 'Coach / seats')) + '</dt><dd>' + (tr.seats && tr.seats.length ? keep(tr.coach) + ' · ' + keep(tr.seats.join(', ')) : '—') + '</dd></div>' +
      '<div><dt>' + OT.esc(t('trip.status', 'Status')) + '</dt><dd>' + statusBadge(tr) + '</dd></div>' +
      '</dl>' +
      returnCardHTML(j) + holdNoteHTML(j) +
      (tr.status === 'CANCELLED' && (j.items || []).some(function (i) { return i.status === 'confirmed'; }) ? '<p class="note note-warn small ticket-note" data-train-cancelled>' + OT.icon('alert', 14) + ' ' + OT.esc(t('trip.cancelledNote', 'Your train is cancelled, but your hotel, cab or other bookings below are still active. Cancel them in Bookings & refunds if you are no longer travelling.')) + ' <a href="#/bookings">' + OT.esc(t('nav.bookings', 'Bookings & refunds')) + '</a></p>' : '') +
      (tr.status === 'PLANNED' ? '<p class="ticket-note"><a class="btn btn-accent btn-sm" href="#/' + OT.trains.path({ from: tr.from, to: tr.to, date: tr.date, pax: j.passengers }) + '">' + OT.icon('train', 15) + OT.esc(t('trip.bookNow', 'Book this train')) + '</a></p>' : '') +
      '<p class="xs muted ticket-note">' + OT.icon('info', 12) + ' ' + OT.esc(tr.held ? t('hold.note', 'Kept in your trip, not booked yet: the PNR and seats are issued when you pay at checkout (simulated IRCTC gateway).') : j.bookedViaOneTrip ? t('trip.noteBooked', 'Booked in OneTrip on the simulated IRCTC gateway (final booking happens on IRCTC). Manage or cancel it in Bookings & refunds.') : tr.status === 'PLANNED' ? t('trip.notePlanned', 'Suggested train from the simulated timetable; not booked.') : t('trip.note', 'Sample ticket, booked on IRCTC. OneTrip never re-books or re-charges your train.')) +
      ' <a href="https://www.irctc.co.in/" target="_blank" rel="noopener">' + OT.esc(t('home.irctc', 'Continue to IRCTC ticketing')) + ' ↗</a></p></div>';
  }

  /** v1.2.2: unpaid train(s) kept in the trip: badge, amount, "Review & pay for everything", change / remove. */
  function holdNoteHTML(j) {
    var H = OT.trainHold, h = H && H.get(j); if (!h) return '';
    var round = h.legs.length > 1 || h.legs.some(function (l) { return l.leg === 'return'; });
    var bad = h.legs.map(H.problem).filter(Boolean);
    return '<div class="hold-note' + (bad.length ? ' is-bad' : '') + '" data-hold-note>' +
      '<div class="hn-head">' + OT.badge('pending', t('hold.badgeLong', 'Not paid yet — pay at checkout')) + '<strong>' + keep(OT.inr(H.amount(j))) + '</strong></div>' +
      '<p class="small">' + OT.esc(h.legs.length > 1 ? t('hold.noteTwo', 'Both trains are in your trip but not paid yet. Add what you need, then pay for the trains and services together; the PNRs are issued then.') : t('hold.noteOne', 'This train is in your trip but not paid yet. Add what you need, then pay for the train and services together; the PNR is issued then.')) + '</p>' +
      (bad.length ? '<p class="note note-warn small" role="alert" data-hold-problem>' + OT.icon('alert', 14) + ' ' + OT.esc(bad[0]) + '</p>' : '') +
      '<div class="hn-actions"><a class="btn btn-accent" href="#/checkout" data-pay-all>' + OT.icon('wallet', 16) + OT.esc(t('hold.payAll', 'Review & pay for everything')) + '</a>' +
      h.legs.map(function (l) {
        return '<a class="btn btn-ghost btn-sm" href="#/' + H.searchPath(l, j) + '">' + OT.esc(round ? t('hold.changeLeg', 'Change {leg} train', { leg: H.label(l, true).toLowerCase() }) : t('hold.change', 'Choose another train')) + '</a>';
      }).join('') +
      '<button type="button" class="btn btn-link small" data-hold-remove="outward">' + OT.icon('trash', 14) + ' ' + OT.esc(t('hold.removeTrain', 'Remove train from trip')) + '</button></div></div>';
  }
  /** Compact second ticket for the booked return train. */
  function returnCardHTML(j) {
    var r = OT.agents.liveReturn(j); if (!r) return '';
    return '<div class="ret-ticket" data-return-ticket><span class="xs muted">' + OT.icon('train', 13) + ' ' + OT.esc(t('ret.title', 'Return train')) + '</span>' +
      '<strong>' + keep(r.no) + ' ' + OT.esc(r.name) + '</strong><span class="small">' + keep(r.from) + ' ' + keep(r.dep) + ' → ' + keep(r.to) + ' ' + keep(r.arr) + ' · ' + keep(OT.fmtDate(r.date)) + (r.cls ? ' · ' + keep(r.cls) : '') + '</span>' +
      '<span class="small">' + (r.pnr ? 'PNR ' + keep(r.pnr) + ' ' : '') + statusBadge(r) + (r.held ? ' <button type="button" class="btn btn-link xs" data-hold-remove="return">' + OT.esc(t('hold.remove', 'Remove from trip')) + '</button>' : '') + '</span></div>';
  }
  function costHTML(j) {
    var items = (j.items || []).filter(function (i) { return i.status !== 'cancelled'; });
    var unpaid = items.filter(function (i) { return i.status === 'selected'; });
    var tot = items.reduce(function (s, i) { return s + OT.agents.lineFor(i, j).amount; }, 0);
    var due = unpaid.reduce(function (s, i) { return s + OT.agents.lineFor(i, j).amount; }, 0);
    var rt = OT.agents.liveReturn(j), meters = OT.meter ? OT.meter.list(j) : [];
    var H = OT.trainHold, h = H && H.get(j), held = h ? H.amount(j) : 0;
    var heldOut = h && h.legs.filter(function (l) { return l.leg !== 'return'; })[0], heldRet = h && h.legs.filter(function (l) { return l.leg === 'return'; })[0];
    due += held;
    return '<div class="card cost"><div class="card-head"><h2 class="h3">' + OT.esc(t('journey.cost', 'Trip cost')) + '</h2>' + OT.simTag() + '</div>' +
      '<div class="cost-rows small">' + (!j.train ? '' :
      heldOut ? '<div data-cost-held><span>' + OT.esc(t('hold.costTrain', 'Train ticket (not paid yet)')) + '</span>' + keep(OT.inr(H.legAmount(heldOut, h.method))) + '</div>' :
      j.train.status === 'CANCELLED' ? '<div><span>' + OT.esc(t('journey.ticketCancelled', 'Train ticket (cancelled, refund as per railway rules)')) + '</span><s>' + keep(OT.inr(j.train.fare)) + '</s></div>'
        : '<div><span>' + OT.esc(t('journey.ticketPaid', 'Train ticket (paid on IRCTC)')) + '</span>' + keep(OT.inr(j.train.fare)) + '</div>') +
      (heldRet ? '<div data-cost-held-return><span>' + OT.esc(t('hold.costReturn', 'Return train (not paid yet)')) + '</span>' + keep(OT.inr(H.legAmount(heldRet, h.method))) + '</div>' :
      rt && rt.fare ? '<div data-cost-return><span>' + OT.esc(rt.bookedViaOneTrip ? t('ret.costPaid', 'Return train (paid, PNR {pnr})', { pnr: rt.pnr }) : t('ret.costIrctc', 'Return train (on IRCTC, PNR {pnr})', { pnr: rt.pnr })) + '</span>' + keep(OT.inr(rt.fare)) + '</div>' : '') +
      '<div><span>' + OT.esc(t('journey.services', 'OneTrip services ({n})', { n: items.length })) + '</span>' + keep(OT.inr(tot)) + '</div>' +
      (meters.length ? '<div class="muted" data-cost-meter><span>' + OT.esc(t('tx.costMeter', 'Autos on meter ({n}), paid to the driver, not charged here', { n: meters.length })) + '</span>≈ ' + keep(OT.inr(OT.meter.total(j))) + '</div>' : '') +
      '<div class="due"><span>' + OT.esc(t('journey.due', 'To pay now')) + '</span><strong>' + keep(OT.inr(due)) + '</strong></div></div>' +
      (h ? '<a class="btn btn-accent btn-block" href="#/checkout" data-tour="to-checkout" data-pay-all>' + OT.icon('wallet', 17) + OT.esc(t('hold.payAllN', 'Review & pay for everything ({n})', { n: unpaid.length + h.legs.length })) + '</a>' :
        unpaid.length ? '<a class="btn btn-primary btn-block" href="#/checkout" data-tour="to-checkout">' + OT.icon('wallet', 17) + OT.esc(t('journey.checkout', 'Review & pay ({n})', { n: unpaid.length })) + '</a>'
        : items.length ? '<a class="btn btn-ghost btn-block" href="#/bookings">' + OT.esc(t('nav.bookings', 'Bookings & refunds')) + '</a>' : '') +
      '<a class="btn btn-ghost btn-block mt8" href="#/results?to=' + j.scenario + '">' + OT.icon('plus', 16) + OT.esc(t('journey.addMore', 'Add hotel, cab, food or sights')) + '</a></div>';
  }

  function emptyHTML() {
    return '<div class="container page"><div class="card empty-state journey-empty">' + OT.icon('route', 40) +
      '<h1 class="h2">' + OT.esc(t('journey.emptyTitle', 'No journey yet')) + '</h1>' +
      '<p class="muted">' + OT.esc(t('journey.empty', 'Plan a trip around your train: tell us where you are going, or load the sample trip to see how it works.')) + '</p>' +
      '<div class="row-wrap center"><a class="btn btn-primary" href="#/home">' + OT.icon('search', 16) + OT.esc(t('nav.plan', 'Plan trip')) + '</a>' +
      '<button type="button" class="btn btn-ghost" id="load-sample">' + OT.icon('train', 16) + OT.esc(t('journey.loadSample', 'Load sample trip (New Delhi → Chandigarh)')) + '</button></div></div></div>';
  }

  /* ---------------- actions ---------------- */
  function save(fn) { OT.store.update('journey', function (j) { fn(j); return j; }); if (root) render(root); }
  function fix(kind, ref) {
    var j = OT.store.get('journey'); if (!j) return;
    var c = OT.agents.itinerary(j).conflicts.filter(function (x) { return x.kind === 'gap' && !x.resolved; })[0];
    if (!c) return;
    if (kind === 'early') {
      save(function (jj) { jj.items.forEach(function (i) { if (i.id === c.hotelItemId) { i.earlyCheckIn = true; i.earlyTime = OT.agents.time.fromMin(OT.agents.time.toMin(jj.train.arr) + 30); } }); });
      OT.toast(t('tl.earlyToast', 'Early check-in requested. The hotel must confirm; we will show it as pending.'), 'info');
      return;
    }
    var fl = fixesFor(c, j).filter(function (f) { return f.k === kind; })[0];
    ref = ref || (fl && fl.ref);
    var x = D().get(ref); if (!x) return;
    var slot = OT.agents.slotFor(x, j);
    if (kind === 'cloak') slot.when = OT.agents.time.addMinIso((j.train.arrDate || j.train.date) + 'T' + j.train.arr, 10);
    save(function (jj) {
      jj.items.push({ id: OT.uid('IT'), type: x.type, refId: x.id, partnerId: x.partnerId, title: x.name, provider: x.provider, price: x.price, listedPrice: x.price,
        when: slot.when, endWhen: slot.endWhen, status: 'selected', verification: OT.agents.verifyOne(x).verdict, city: x.city, addedAt: new Date().toISOString(), priceAccepted: true, fixFor: c.id });
    });
    OT.toast(t('tl.fixedToast', 'Conflict resolved: {name} added to your timeline.', { name: x.name }), 'success');
  }
  function linkReturn() {
    var j = OT.store.get('journey'); if (!j) return;
    save(function (jj) { jj.returnTrain = JSON.parse(JSON.stringify(jj.returnOption)); jj.returnTrain.status = 'CNF'; });
    OT.toast(t('tl.returnToast', 'Return train {no} linked (sample PNR {pnr}).', { no: j.returnOption.no, pnr: j.returnOption.pnr }), 'success');
  }
  function playAloud() {
    var j = OT.store.get('journey'); if (!j) return;
    var it = OT.agents.itinerary(j);
    var text = t('tl.speakIntro', 'Your journey on {date}.', { date: OT.fmtDate(j.train ? j.train.date : j.start) }) + ' ' +
      it.events.map(function (e) { return (e.when ? tm(e.when) + ', ' : '') + e.title + '.'; }).join(' ') +
      (it.conflicts.some(function (c) { return !c.resolved; }) ? ' ' + t('tl.speakConflict', 'There is a timing conflict to resolve.') : '');
    OT.lang.speak(text, L());
  }
  function consolidated() {
    var j = OT.store.get('journey'); if (!j) return;
    var it = OT.agents.itinerary(j), tr = j.train || { no: '', name: OT.trip.title(j), from: j.scenario, to: j.scenario, date: j.start };
    var rows = it.events.map(function (e) {
      var i = e.item, x = i && D().get(i.refId);
      return '<tr><td class="nowrap">' + (e.when ? keep(OT.fmtDate(e.when)) + ' ' + keep(tm(e.when)) : '—') + '</td><td>' + OT.lang.highlight(e.title) + '</td>' +
        '<td class="small">' + OT.esc(x ? x.provider : (e.kind.indexOf('dep') >= 0 || e.kind.indexOf('arr') >= 0 ? 'Indian Railways / IRCTC' : e.meter ? t('tx.payDriver', 'paid to the driver') : '')) + '</td>' +
        '<td>' + (i ? OT.badge(i.status === 'confirmed' ? 'confirmed' : 'pending', i.status === 'confirmed' ? null : t('status.selected', 'Planned')) : e.meter ? OT.badge('info', t('tx.meterBadge', 'Pay on meter')) : ((e.kind === 'dep' || e.kind === 'arr') && j.train.held) || ((e.kind === 'rdep' || e.kind === 'rarr') && j.returnTrain && j.returnTrain.held) ? OT.badge('pending', t('hold.badge', 'Not paid yet')) : OT.badge('confirmed', t('status.cnf', 'CNF'))) + '</td>' +
        '<td class="small">' + (i && i.bookingRef ? keep(i.bookingRef) : (e.kind === 'dep' || e.kind === 'arr' ? (j.pnr ? 'PNR ' + keep(j.pnr) : OT.esc(t('hold.badge', 'Not paid yet'))) : e.kind === 'rdep' && j.returnTrain ? (j.returnTrain.pnr ? 'PNR ' + keep(j.returnTrain.pnr) : OT.esc(t('hold.badge', 'Not paid yet'))) : e.meter ? OT.esc(OT.meter.approx(e.meter)) : '')) + '</td></tr>';
    }).join('');
    OT.modal({
      title: t('journey.itinTitle', 'Consolidated itinerary'), wide: true,
      body: '<p class="small muted">' + OT.lang.highlight(t('journey.itinSub', '{no} {name} · {from} → {to} · {date} · {n} travellers (sample data)', { no: tr.no, name: tr.name, from: tr.from, to: tr.to, date: OT.fmtDate(tr.date), n: j.passengers })) + '</p>' +
        '<div class="table-wrap"><table class="table"><thead><tr><th>' + OT.esc(t('itin.when', 'When')) + '</th><th>' + OT.esc(t('itin.what', 'What')) + '</th><th>' + OT.esc(t('itin.provider', 'Provider')) + '</th><th>' + OT.esc(t('itin.status', 'Status')) + '</th><th>' + OT.esc(t('itin.ref', 'Ref')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>',
      actions: [{ label: t('journey.print', 'Print'), kind: 'ghost', onClick: function () { window.print(); } }, { label: t('common.close', 'Close'), kind: 'primary' }]
    });
  }

  function render(el) {
    root = el;
    if (OT.meter) OT.meter.migrate();
    var j = OT.store.get('journey');
    if (!j || (!j.train && j.kind !== 'trip')) {
      el.innerHTML = emptyHTML();
      el.querySelector('#load-sample').addEventListener('click', function () { OT.store.set('journey', D().makeJourney('CDG', {})); render(el); });
      return;
    }
    var rd = OT.agents.readiness(j);
    var from = OT.state.lastReadiness != null && OT.state.lastReadinessJ === j.id ? OT.state.lastReadiness : null;
    OT.state.lastReadiness = rd.score; OT.state.lastReadinessJ = j.id;
    var tr = j.train;
    var head = tr ? OT.esc(D().stationName(tr.from, L())) + ' → ' + OT.esc(D().stationName(tr.to, L())) : OT.esc(OT.trip.title(j));
    var sub = tr ? t('journey.sub', '{date} · {n} travellers · hotel budget {b}/night', { date: OT.fmtDate(tr.date), n: j.passengers, b: OT.inr(j.budget) })
      : t('journey.subTrip', '{date} · {n} travellers · hotel budget {b}/night', { date: OT.fmtDate(j.start) + (j.end && j.end !== j.start ? ' – ' + OT.fmtDate(j.end) : ''), n: j.passengers, b: OT.budget.text(j.budgetMin || OT.budget.MIN, j.budget || OT.budget.MAX) });
    el.innerHTML = '<div class="container page journey-page">' +
      '<div class="page-head"><div><p class="ot-eyebrow">' + OT.icon('route', 14) + ' ' + OT.esc(t('journey.eyebrow', 'One journey. One dashboard.')) + '</p>' +
      '<h1>' + OT.esc(t('journey.title', 'My Journey')) + ': ' + head + '</h1>' +
      '<p>' + OT.lang.highlight(sub) + '</p></div>' +
      '<div class="row-wrap"><button type="button" class="btn btn-ghost btn-sm" id="j-play">' + OT.icon('speaker', 16) + OT.esc(t('tl.play', 'Play itinerary aloud')) + '</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="j-itin">' + OT.icon('layers', 16) + OT.esc(t('journey.itinBtn', 'Consolidated itinerary')) + '</button></div></div>' +
      tripHTML(j) +
      '<div class="journey-grid"><div class="j-side">' + readinessHTML(j, rd, from) + costHTML(j) + (OT.itinerary ? OT.itinerary.cardHTML() : '') + '</div>' +
      '<div class="j-main">' + timelineHTML(j) + '</div></div></div><div id="fy-journey"></div>';
    animateRing(el.querySelector('.ring'));
    if (OT.forYou) OT.forYou.render(el.querySelector('#fy-journey'), { place: 'journey' });
    bind(el);
  }

  function bind(el) {
    if (OT.itinerary) OT.itinerary.bindCard(el);
    el.querySelector('#j-play').addEventListener('click', playAloud);
    el.querySelector('#j-itin').addEventListener('click', consolidated);
    OT.$$('[data-fix]', el).forEach(function (b) { b.addEventListener('click', function () { fix(b.getAttribute('data-fix'), b.getAttribute('data-ref')); }); });
    OT.$$('[data-link-return]', el).forEach(function (b) { b.addEventListener('click', linkReturn); });
    OT.$$('[data-hold-remove]', el).forEach(function (b) {
      b.addEventListener('click', function () { OT.trainHold.remove(b.getAttribute('data-hold-remove')).then(function (ok) { if (ok && root) render(root); }); });
    });
    OT.$$('[data-remove-meter]', el).forEach(function (b) {
      b.addEventListener('click', function () { OT.meter.remove(b.getAttribute('data-remove-meter')); OT.toast(t('journey.removed', 'Removed from your journey.'), 'info'); if (root) render(root); });
    });
    OT.$$('[data-fix-ret]', el).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-fix-ret');
        save(function (j) { j.items.forEach(function (i) { if (i.id === id) i.earlyCheckout = true; }); });
        OT.toast(t('ret.fixedToast', 'Noted: early check-out before the return train.'), 'success');
      });
    });
    OT.$$('[data-goto-tab]', el).forEach(function (a) { a.addEventListener('click', function () { OT.state.resTab = a.getAttribute('data-goto-tab'); }); });
    OT.$$('[data-remove-item]', el).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-remove-item');
        save(function (j) { j.items = j.items.filter(function (i) { return i.id !== id; }); });
        OT.toast(t('journey.removed', 'Removed from your journey.'), 'info');
      });
    });
    OT.$$('[data-retime]', el).forEach(function (inp) {
      inp.addEventListener('change', function () {
        var id = inp.getAttribute('data-retime'), v = inp.value;
        if (!/^\d{2}:\d{2}$/.test(v)) return;
        save(function (j) { j.items.forEach(function (i) { if (i.id === id && i.when) { var dur = i.endWhen ? (OT.agents.time.isoMs(i.endWhen) - OT.agents.time.isoMs(i.when)) / 60000 : 0; i.when = i.when.slice(0, 11) + v; if (dur) i.endWhen = OT.agents.time.addMinIso(i.when, dur); } }); });
      });
    });
  }

  OT.registerView('journey', {
    title: function () { return OT.t('nav.journey', 'My Journey'); },
    section: 'journey',
    render: function (el) { render(el); },
    onLeave: function () { root = null; },
    fix: fix,
    linkReturn: linkReturn,
    addReturnPath: function () { var j = OT.store.get('journey'); return j && j.train ? addReturnPath(j) : null; },
    play: playAloud
  });
})();
