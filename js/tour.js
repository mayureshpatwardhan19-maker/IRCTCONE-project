/* IRCTC OneTrip — guided jury demo (~3 minutes). OT.tour.start()
 * The tour DRIVES the app (routes, sample voice query, adds items, pays, asks the assistant), so the
 * presenter can just press Next. Captions are presenter notes (kept in English on purpose).
 * Steps on Builder B's pages route there and point at the page heading if no specific hook exists.
 */
(function () {
  'use strict';
  var OT = window.OT;
  var T = OT.tour = {};
  var root, spot, card, idx = -1, active = false, busy = false, done = {}, savedUser, raf = 0, curTarget = null;

  function waitFor(fn, ms) {
    var t0 = Date.now(); ms = ms || 8000;
    return new Promise(function (resolve) {
      (function poll() {
        var v = null; try { v = fn(); } catch (e) { v = null; }
        if (v) return resolve(v);
        if (Date.now() - t0 > ms) return resolve(null);
        setTimeout(poll, 100);
      })();
    });
  }
  function find(sel) {
    var list = [].concat(sel || []);
    for (var i = 0; i < list.length; i++) {
      var el = typeof list[i] === 'function' ? list[i]() : document.querySelector(list[i]);
      if (el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)) return el;
    }
    return null;
  }
  function route() { var c = OT.router.current(); return c && c.name; }
  function go(path, name) { OT.go(path); return waitFor(function () { return route() === (name || path.split('?')[0].split('/')[0]); }, 4000); }
  function view(n) { return OT.views[n] || {}; }

  function xmasIndex() {
    var l = OT.data.demand.longWeekends(null, 3), i;
    for (i = 0; i < l.length; i++) if (l[i].holiday.name === 'Christmas') return i;
    return 0;
  }
  var VOICE_HI = 'क्रिसमस पर दिल्ली से चंडीगढ़ की ट्रेन बुक करो';
  function clickPrimaryInModal() { var b = document.querySelector('.modal-backdrop .modal-foot .btn-primary'); if (b) b.click(); }

  var steps = [
    { title: 'Welcome to IRCTC OneTrip', text: 'A rail-first trip platform that complements IRCTC ticketing: find and book the train, then plan everything after it, in your language. Everything is simulated sample data. This tour drives the app for you: just press Next.',
      target: '.brand', enter: function () { return go('home'); } },
    { title: 'Demo personas: one-click sign-in', text: 'Four traveller personas from our survey segments (family, pilgrim, student, business) plus a tourism partner and an admin/bank analyst. Each has a home city, language, preferences and past trips. You can also switch persona from the header.',
      target: '[data-tour="personas"]', enter: function () { return go('login'); } },
    { title: 'Signed in as Sunita, in Hindi', text: 'Sunita’s profile switches the UI to Hindi and loads “For you”: a long-weekend detector on a sample holiday calendar. Christmas falls on a Friday, so it is a 3-day weekend; Guru Nanak Jayanti on a Tuesday becomes 4 days with one leave day.',
      target: '[data-tour="for-you"]', enter: function () {
        if (OT.auth && OT.auth.signInPersona) OT.auth.signInPersona('sunita', { quiet: true });
        OT.state.fyLw = xmasIndex();
        return waitFor(function () { return route() === 'home' && document.querySelector('[data-tour="for-you"]'); }, 4000).then(function () {
          var slot = document.querySelector('#for-you-slot'); if (slot && OT.forYou) OT.forYou.render(slot, { place: 'home' });
        });
      } },
    { title: 'Trending from New Delhi + a package', text: 'Aggregated, anonymised IRCTC demand: how many travellers from Sunita’s home city booked each route for that weekend, the growth vs a normal weekend, and how early seats fill. Each trend becomes a train + hotel + cab + sight package priced from the verified catalogue. “Why am I seeing this?” and the consent switch keep it DPDP-compliant.',
      target: ['[data-trend="CDG"] .fy-pkg', '[data-tour="for-you"]'], enter: function () {
        var el = document.querySelector('[data-trend="CDG"]'); if (el) el.scrollIntoView({ block: 'center' });
        return OT.sleep(200);
      } },
    { title: 'Or just say it, in Hindi', text: 'Sunita speaks: “क्रिसमस पर दिल्ली से चंडीगढ़ की ट्रेन बुक करो” (book a Delhi to Chandigarh train on Christmas). Simulated ASR types it out and the live parse shows exactly what was understood: intent, from, to and date.',
      target: '[data-tour="voice"]', enter: function () { return go('home').then(function () { return view('home').sample ? view('home').sample('hi', VOICE_HI) : null; }); } },
    { title: 'Step 1 · Train search results', text: 'Every station pair gets a deterministic simulated timetable: Shatabdi, Vande Bharat, Express and more, with running days, class-wise fares and seat status (AVAILABLE, RAC, waitlist with a chance of confirmation, REGRET). Each train carries a verification badge, source and check time. Like a flight search, the form has a One way | Round trip toggle: Round trip asks for a return date and books both trains with one payment. Final booking happens on IRCTC — simulated here.',
      target: ['.trn[data-train="12011"]', '[data-tour="trains"]'], enter: function () {
        var u = OT.forYou && OT.forYou.persona();
        var lws = OT.data.demand.longWeekends(null, 3), lw = lws[xmasIndex()];
        if (u && lw) {
          var tr = OT.data.demand.trends(u.homeCity, lw, u).filter(function (x) { return x.to === 'CDG'; })[0];
          var pk = tr && OT.data.demand.pkg(u, tr, lw);
          if (pk) OT.state.pendingPackage = { to: pk.to, from: pk.from, date: pk.date, ret: pk.returnDate, nights: pk.nights, hotel: pk.hotel && pk.hotel.id, cab: pk.cab && pk.cab.id, sight: pk.sight && pk.sight.id, cls: pk.cls, pax: pk.pax };
        }
        var p = view('home').submit ? view('home').submit() : Promise.resolve();
        return p.then(function () { return waitFor(function () { return route() === 'trains' && document.querySelector('.trn'); }, 5000); });
      } },
    { title: 'Step 2 · Passengers, prefilled', text: 'Choosing 12011 Kalka Shatabdi in AC Chair Car opens the passenger form, prefilled from Sunita’s profile (3 travellers, seat preferences), with an itemised fare: base fare, reservation, superfast charge, GST and a simulated convenience fee.',
      target: '[data-tour="pax"]', enter: function () {
        var b = document.querySelector('.trn[data-train="12011"] [data-book="CC"]') || document.querySelector('.cls-tile:not([disabled])');
        if (b) b.click();
        return waitFor(function () { return document.querySelector('[data-tour="pax"]'); }, 4000);
      } },
    { title: 'Or: add the stay first, pay once', text: 'Right below “Pay”, a second choice: “Add hotel, transport, food & sightseeing — pay once at the end”. The train (or both trains of a round trip) then waits in the trip unpaid, with no PNR; the planning screen opens, and checkout charges trains and services in one payment and issues the PNR. For this demo we pay for the train now.',
      target: '[data-tour="pay-later"]', enter: function () {
        var el = document.querySelector('[data-tour="pay-later"]'); if (el) el.scrollIntoView({ block: 'center' });
        return OT.sleep(200);
      } },
    { title: 'Human-in-the-loop payment', text: 'Nothing is booked until the traveller confirms. Train number, stations, date, class, names and the total are shown exactly as booked (never translated).',
      target: '.modal', enter: function () {
        var b = document.querySelector('#trn-pay'); if (b) b.click();
        return waitFor(function () { return document.querySelector('.modal-backdrop.show .modal'); }, 3000);
      } },
    { title: 'Payment successful', text: 'A Google-Pay-style success screen: the check draws in, the amount in large type, who was paid, UPI reference, transaction ID, time and the PNR. A soft chime plays unless muted; animations are skipped for people who prefer reduced motion.',
      target: ['.ps-card', '[data-tour="pay-success"]'], enter: function () {
        clickPrimaryInModal();
        return waitFor(function () { return document.querySelector('.ps-overlay.show .ps-card'); }, 6000);
      } },
    { title: 'PNR issued, journey created', text: 'A simulated PNR and e-ticket with berth status (CNF / RAC / WL with a chance of confirmation). The ticket automatically becomes the first item of My Journey, and it can be cancelled later with railway-style refund rules.',
      target: '[data-tour="ticket"]', enter: function () {
        if (OT.paySuccess) OT.paySuccess.close(true);
        return waitFor(function () { return document.querySelector('[data-tour="ticket"]'); }, 6000);
      } },
    { title: 'Step 3 · Agents plan the stay', text: '“Now plan your stay in Chandigarh” runs the orchestrator: Multilingual → Research → Verification → Recommendation → Itinerary, with tool calls, sources and timings.',
      target: '[data-tour="trace"]', enter: function () {
        OT.state.lastRun = null;
        var a = document.querySelector('#plan-stay'); if (a) a.click(); else OT.go('results?to=CDG');
        return waitFor(function () { return route() === 'results' && document.querySelector('.tr-step'); }, 5000);
      } },
    { title: 'Verified package items added', text: 'The Verification Agent re-checks every record at the provider: a changed price is flagged, stale data needs a re-check, a sold-out hotel is hidden. The package’s verified hotel (Hotel Shivalik View, partner P-101), station cab and heritage walk are added automatically. Prices come from the catalogue, never from the AI.',
      target: '[data-ref="H-CDG-01"]', enter: function () {
        return waitFor(function () { return OT.state.lastRun && OT.state.lastRun.done && document.querySelector('[data-ref="H-CDG-01"]'); }, 15000)
          .then(function () {
            if (view('results').tab) view('results').tab('hotel');
            var j = OT.store.get('journey');
            if (j && !j.items.some(function (i) { return i.refId === 'H-CDG-01'; }) && view('results').add) view('results').add('H-CDG-01');
            if (j && !j.items.some(function (i) { return i.refId === 'C-CDG-01'; }) && view('results').add) view('results').add('C-CDG-01', { quiet: true });
          });
      } },
    { title: 'Station → hotel: every way, side by side', text: 'Not just cabs: cab, auto-rickshaw, city bus, metro, e-rickshaw and walking, compared for Sunita’s party of 3 with price (total and per person), time, wait, comfort, luggage, door-to-door, CO₂ and honest availability: “No metro in Chandigarh”. Badges mark the cheapest, the fastest and the best for her group.',
      target: ['[data-tour="transport-compare"]'], enter: function () {
        if (view('results').tab) view('results').tab('cab');
        return OT.sleep(250);
      } },
    { title: 'My Journey: the train comes first', text: 'One dashboard. The booked train is the first node of the railway route-line timeline (navy), local legs follow in saffron. The Itinerary Agent flags a conflict: arrival 11:05 vs hotel check-in 14:00.',
      target: ['[data-tour="conflict"]', '[data-tour="timeline"]'], enter: function () { return go('journey').then(function () { return waitFor(function () { return document.querySelector('[data-tour="timeline"]'); }, 3000); }); } },
    { title: 'Resolved, readiness rises', text: 'We leave bags at the station cloakroom. The conflict turns green and the weighted Trip Readiness ring climbs, with every point explained. The only open item is the return journey.',
      target: '[data-tour="readiness"]', enter: function () {
        if (view('journey').fix) view('journey').fix('cloak');
        return OT.sleep(400);
      } },
    { title: 'Add the return train', text: 'After the hotel and cab, My Journey offers “Add return train”: the search opens the other way (Chandigarh → New Delhi) on the hotel check-out date, pre-filled. Whatever is booked here joins the SAME journey with its own PNR. Autos and e-rickshaws, by contrast, are never booked: they show “≈ ₹ on meter, pay the driver”.',
      target: ['[data-attach-note]', '[data-tour="trains"]'], enter: function () {
        var path = view('journey').addReturnPath && view('journey').addReturnPath();
        if (!path) return OT.sleep(100);
        return go(path, 'trains').then(function () { return waitFor(function () { return document.querySelector('.trn'); }, 4000); });
      } },
    { title: 'Return booked: two PNRs, one journey', text: 'Picking the return train reuses the passengers, shows the fare, asks for confirmation and pays (simulated). The return is the last stop on the railway timeline, gets its own cancellable entry in Bookings & refunds, and the Trip Readiness “Return journey” check is now complete.',
      target: ['[data-ev="rdep"]', '[data-tour="readiness"]'], enter: function () {
        var tile = document.querySelector('.trn .cls-tile:not([disabled])');
        if (!tile) return go('journey');
        tile.click();
        return waitFor(function () { return document.querySelector('#trn-pay'); }, 4000).then(function (b) {
          if (!b) return null;
          b.click();
          return waitFor(function () { return document.querySelector('.modal-backdrop.show .modal-foot .btn-primary'); }, 3000);
        }).then(function (ok) {
          if (!ok) return null;
          clickPrimaryInModal();
          return waitFor(function () { return document.querySelector('.ps-overlay.show .ps-card'); }, 6000);
        }).then(function () {
          if (OT.paySuccess) OT.paySuccess.close(true);
          return route() === 'journey' ? null : go('journey');
        }).then(function () { return waitFor(function () { return document.querySelector('[data-tour="readiness"]'); }, 3000); });
      } },
    { title: 'Review & pay the stay (simulated)', text: 'Itemised hotel, cab and sight with GST shown. The train ticket appears separately as already paid, so it is never charged twice. Payment details are masked demo values.',
      target: '[data-tour="co-items"]', enter: function () { return go('checkout'); } },
    { title: 'Confirm again: human in the loop', text: 'Agents propose; the traveller decides. PNR, train number, dates and amounts stay untranslated in the confirmation.',
      target: '.modal', enter: function () {
        if (view('checkout').pay) view('checkout').pay();
        return waitFor(function () { return document.querySelector('.modal-backdrop.show .modal'); }, 3000);
      } },
    { title: 'Paid, plus a one-page itinerary', text: 'Booking references and a simulated UPI reference are issued and partner P-101 is notified. “Your one-page itinerary” gives an A4 PDF (print view), a PNG drawn on a canvas, one-tap WhatsApp (opens the chat for the signed-in traveller\u2019s number with the itinerary already typed) and email.',
      target: [function () { return window.innerWidth >= 1000 ? document.querySelector('.ps-overlay.show .ps-card') : null; }, '[data-tour="itin-snapshot"]', '.ps-card'], enter: function () {
        clickPrimaryInModal();
        return waitFor(function () { return document.querySelector('.ps-overlay.show [data-tour="itin-snapshot"]'); }, 6000);
      } },
    { title: 'Assistant answers in Hindi, aloud', text: 'The Customer Support Agent answers a refund question in Hindi, cites the policy it used, keeps the English original one tap away, and reads the reply aloud (or shows the text if this device has no Hindi voice).',
      target: '.asst-drawer', enter: function () {
        if (OT.paySuccess) OT.paySuccess.close(true);
        if (!OT.assistant) return null;
        OT.assistant.open();
        return OT.assistant.ask('मेरा रिफंड कब आएगा?', { speak: true })
          .then(function () { return waitFor(function () { return document.querySelector('.say-card.show'); }, 1800); });
      } },
    { title: 'Partner dashboard sees the booking', text: 'Logged in as Hotel Shivalik View (P-101), the partner sees the new booking highlighted as “New via OneTrip” and its KPIs update.',
      target: ['[data-tour="partner-bookings"]', function () { var l = document.querySelector('#view .pill-live'); return l && (l.closest('tr') || l); }, '#view h1', '.page-head'], enter: function () {
        if (OT.assistant) OT.assistant.close();
        if (OT.lang) OT.lang.stop();
        OT.store.set('user', { name: 'Rajinder Singh', email: 'p101.shivalik@demo.onetrip', role: 'partner', partnerId: 'P-101', org: 'Hotel Shivalik View', personaId: 'partner', simulated: true });
        return go('partner/bookings', 'partner');
      } },
    { title: 'Admin & Bank: long-weekend demand forecast', text: 'The data-monetisation side: aggregated route demand for upcoming long weekends (who books what, how early seats fill), which IRCTC can turn into partner insights, capacity planning and packages, under consent and k-anonymity.',
      target: ['[data-tour="lw-forecast"]', '[data-tour="admin-language"]', '#view h1', '.page-head'], enter: function () {
        OT.store.set('user', { name: 'Ananya Rao', email: 'admin@demo.onetrip', role: 'admin', personaId: 'admin', org: 'IRCTC OneTrip Admin · Partner Bank (sample)', simulated: true });
        return go('admin/demand', 'admin');
      } },
    { title: 'The business case', text: 'Survey evidence (N=52), personas, the five case questions, the bank’s role, financial products, revenue model and social-mandate guardrails. End of the tour.',
      target: ['#view h1', '.page-head'], enter: function () { return go('insights'); } }
  ];

  function build() {
    root = document.getElementById('tour-root');
    if (!root) { root = document.createElement('div'); root.id = 'tour-root'; document.body.appendChild(root); }
    root.innerHTML = '<div class="tour-spot" aria-hidden="true"></div>' +
      '<div class="tour-card" role="dialog" aria-live="polite" aria-label="Guided demo">' +
      '<div class="tour-top"><span class="tour-kicker">Guided demo · presenter notes</span><span class="tour-count"></span>' +
      '<button type="button" class="icon-btn tour-x" aria-label="Exit tour">' + OT.icon('x', 16) + '</button></div>' +
      '<h3 class="tour-title"></h3><p class="tour-text"></p>' +
      '<div class="tour-bar"><span></span></div>' +
      '<div class="tour-nav"><button type="button" class="btn btn-ghost btn-sm tour-back">' + OT.icon('arrowLeft', 15) + 'Back</button>' +
      '<span class="tour-busy xs muted"></span>' +
      '<button type="button" class="btn btn-primary btn-sm tour-next">Next' + OT.icon('arrowRight', 15) + '</button></div></div>';
    spot = root.querySelector('.tour-spot'); card = root.querySelector('.tour-card');
    root.querySelector('.tour-x').addEventListener('click', T.end);
    root.querySelector('.tour-next').addEventListener('click', T.next);
    root.querySelector('.tour-back').addEventListener('click', T.back);
  }

  function place() {
    if (!active || !card) return;
    var el = curTarget && document.body.contains(curTarget) ? curTarget : null;
    var vw = window.innerWidth, vh = window.innerHeight, mobile = vw < 700;
    if (!el) { spot.style.opacity = '0'; } else {
      var r = el.getBoundingClientRect(), pad = 6;
      var top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad);
      var w = Math.min(vw - left - 4, r.width + pad * 2), h = Math.min(vh - top - 4, r.height + pad * 2);
      spot.style.opacity = '1';
      spot.style.transform = 'translate(' + left + 'px,' + top + 'px)';
      spot.style.width = Math.max(0, w) + 'px'; spot.style.height = Math.max(0, h) + 'px';
    }
    card.classList.toggle('tour-mobile', mobile);
    if (mobile) { card.style.left = ''; card.style.top = ''; return; }
    var cw = card.offsetWidth, ch = card.offsetHeight, cx, cy;
    if (el) {
      var rr = el.getBoundingClientRect();
      cy = rr.bottom + 14; cx = Math.min(Math.max(12, rr.left), vw - cw - 12);
      if (cy + ch > vh - 12) cy = rr.top - ch - 14;
      if (cy < 12) { cy = Math.min(vh - ch - 12, Math.max(12, rr.top + 12)); cx = rr.right + 14 + cw < vw ? rr.right + 14 : Math.max(12, rr.left - cw - 14); if (cx < 12) { cx = vw - cw - 12; cy = vh - ch - 12; } }
    } else { cx = (vw - cw) / 2; cy = vh - ch - 24; }
    card.style.left = Math.round(cx) + 'px'; card.style.top = Math.round(Math.max(12, cy)) + 'px';
  }
  function loop() { cancelAnimationFrame(raf); raf = requestAnimationFrame(function () { place(); }); }

  function show(i) {
    var s = steps[i];
    idx = i;
    card.querySelector('.tour-count').textContent = (i + 1) + ' / ' + steps.length;
    card.querySelector('.tour-title').textContent = s.title;
    card.querySelector('.tour-text').textContent = s.text;
    card.querySelector('.tour-bar span').style.width = Math.round((i + 1) / steps.length * 100) + '%';
    card.querySelector('.tour-back').disabled = i === 0;
    card.querySelector('.tour-next').innerHTML = i === steps.length - 1 ? 'Finish' + OT.icon('check', 15) : 'Next' + OT.icon('arrowRight', 15);
  }

  function setBusy(b) {
    busy = b;
    if (!card) return;
    card.querySelector('.tour-next').disabled = b;
    card.querySelector('.tour-busy').innerHTML = b ? '<span class="spinner"></span> working…' : '';
  }

  function run(i, fresh) {
    var s = steps[i];
    show(i);
    curTarget = null; place();
    setBusy(true);
    var p;
    if (fresh && !done[i]) { done[i] = true; try { p = Promise.resolve(s.enter && s.enter()); } catch (e) { console.error(e); p = Promise.resolve(); } }
    else p = s.hash && location.hash !== s.hash ? (location.hash = s.hash, OT.sleep(350)) : Promise.resolve();
    return p.catch(function (e) { console.error('[OT] tour step failed', e); }).then(function () {
      if (!active || idx !== i) return;
      if (fresh) s.hash = location.hash;
      return waitFor(function () { return find(s.target); }, 2500);
    }).then(function (el) {
      if (!active || idx !== i) return;
      curTarget = el || null;
      if (el && el.scrollIntoView && !el.closest('.asst-drawer') && !el.closest('.modal') && !el.closest('.app-header')) {
        try { el.scrollIntoView({ block: el.offsetHeight > window.innerHeight * 0.7 ? 'start' : 'center', behavior: 'auto' }); } catch (e) { el.scrollIntoView(); }
        // phone: inside the payment pop-up, lift the target above the tour card so the card never hides it
        var ov = el.closest('.ps-overlay');
        if (ov && card && window.innerWidth < 700) {
          var top = card.getBoundingClientRect().top, rr = el.getBoundingClientRect(), need = Math.min(rr.bottom, rr.top + window.innerHeight * 0.5) - (top - 12);
          if (need > 0) ov.scrollTop += need;
        }
      }
      setBusy(false);
      place();
      setTimeout(place, 350);
    });
  }

  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) T.end();
    if (e.key === 'ArrowRight' && !busy && !/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''))) T.next();
    if (e.key === 'ArrowLeft' && !busy && !/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''))) T.back();
  }

  T.start = function () {
    if (active) T.end();
    savedUser = OT.store.get('user');
    // fresh, deterministic demo state (bookings history is kept)
    OT.state.lastRun = null; OT.state.dismissed = {}; OT.state.lastCheckout = null; OT.state.resTab = 'hotel'; OT.state.homeDraft = '';
    OT.state.pendingPackage = null; OT.state.applyPackage = null; OT.state.fyLw = 0; OT.state.stay = null;
    OT.store.set('journey', undefined);
    OT.store.set('user', undefined);
    if (OT.shell && OT.shell.userMenu) OT.shell.userMenu(false);
    if (OT.paySuccess) OT.paySuccess.close(true);
    if (OT.assistant) { OT.assistant.close(); OT.assistant.reset(); }
    if (OT.i18n.lang() !== 'en') OT.i18n.setLang('en');
    done = {}; steps.forEach(function (s) { s.hash = null; });
    build();
    active = true;
    document.body.classList.add('touring');
    window.addEventListener('resize', loop); window.addEventListener('scroll', loop, true);
    document.addEventListener('keydown', onKey);
    return run(0, true);
  };
  T.next = function () {
    if (!active || busy) return Promise.resolve();
    if (OT.lang) OT.lang.stop();
    if (idx >= steps.length - 1) { T.end(); return Promise.resolve(); }
    return run(idx + 1, true);
  };
  T.back = function () { if (!active || busy || idx <= 0) return Promise.resolve(); return run(idx - 1, false); };
  T.end = function () {
    if (!active) return;
    active = false;
    if (OT.lang) OT.lang.stop();
    document.body.classList.remove('touring');
    window.removeEventListener('resize', loop); window.removeEventListener('scroll', loop, true);
    document.removeEventListener('keydown', onKey);
    if (root) root.innerHTML = '';
    OT.store.set('user', savedUser);
  };
  T.isActive = function () { return active; };
  T.step = function () { return idx; };
  T.steps = steps;
})();
