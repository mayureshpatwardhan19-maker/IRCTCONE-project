/* IRCTC OneTrip — specialist agents (SIMULATED, deterministic rules over the sample catalogue).
 *
 * Agents never invent prices, availability, ratings or timings: every value comes from
 * OT.data.travel and carries its source + checkedAt. Gemini (optional) is used only for
 * language understanding / phrasing, and its output is validated against the catalogue.
 *
 *   OT.agents.defs                     agent registry (name, icon, role) for the Agent Trace
 *   OT.agents.parseQuery(text)         -> intent {to, budget, types[], nearStation, prefs, confidence}
 *   OT.agents.research(intent)         Research Agent      -> {records, sources, toolCalls}
 *   OT.agents.verify(records)          Verification Agent  -> [{item, verdict, flags, checks, livePrice}]
 *   OT.agents.recommend(verified, i)   Recommendation Agent-> {byType, hidden, filtered}
 *   OT.agents.slotFor(item, journey)   Itinerary helper    -> {when, endWhen}
 *   OT.agents.itinerary(journey)       Itinerary Agent     -> {events, conflicts}
 *   OT.agents.readiness(journey)       Trip Readiness      -> {score, parts}
 *   OT.agents.support(text, {lang})    Customer Support    -> Promise<{text, actions, escalated, ticket, citations, confidence, engine}>
 *   OT.agents.partnerDraftReply(enq)   Partner Agent       -> {text, textEn, lang, confidence, note}
 *   OT.agents.refundFor(booking)       policy-based refund calculation
 */
(function () {
  'use strict';
  var OT = window.OT;
  OT.agents = OT.agents || {};
  function T(k, fb, v) { return OT.t ? OT.t(k, fb, v) : fb; }
  function D() { return OT.data.travel; }

  OT.agents.defs = {
    orchestrator: { icon: 'layers', name: 'Orchestrator', role: 'Plans, assigns tasks, merges results' },
    multilingual: { icon: 'globe', name: 'Multilingual', role: 'ASR · NMT · TTS · token protection (BHASHINI-ready, simulated)' },
    research: { icon: 'search', name: 'Research', role: 'Queries provider sources, records source + time' },
    verification: { icon: 'shield', name: 'Verification', role: 'Independent re-check against provider source' },
    recommendation: { icon: 'target', name: 'Recommendation', role: 'Ranks by budget, preferences, distance' },
    itinerary: { icon: 'route', name: 'Itinerary', role: 'Builds the chronological plan, flags conflicts' },
    support: { icon: 'headset', name: 'Customer Support', role: 'Booking, cancellation, refund, PNR; escalates' },
    partner: { icon: 'store', name: 'Partner', role: 'Helps partners with listings and enquiries' }
  };
  OT.agents.name = function (id) { return T('agent.' + id, (OT.agents.defs[id] || {}).name || id); };

  /* ---------------- time helpers ---------------- */
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function toMin(hhmm) { var p = String(hhmm || '0:0').split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fromMin(m) { m = ((m % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function fmtDate(ymd) { if (!ymd) return ''; var p = String(ymd).slice(0, 10).split('-'); return (+p[2]) + ' ' + MON[(+p[1]) - 1] + ' ' + p[0]; }
  function fmtGap(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return (h ? h + ' ' + T('time.h', 'h') + (m ? ' ' : '') : '') + (m ? m + ' ' + T('time.min', 'min') : '');
  }
  function stamp(ts) { var d = new Date(ts); return OT.stamp ? OT.stamp(d) : d.toISOString(); }
  function agoLabel(iso) {
    var mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return T('time.minsAgo', '{n} min ago', { n: mins });
    return T('time.hoursAgo', '{n} h ago', { n: Math.round(mins / 6) / 10 });
  }
  function dt(dateStr, hhmm) { return dateStr + 'T' + hhmm; }
  function addMinIso(iso, mins) {
    var d = new Date(iso.length === 16 ? iso + ':00' : iso); d.setMinutes(d.getMinutes() + mins);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function isoMs(iso) { return new Date(String(iso).length === 16 ? iso + ':00' : iso).getTime(); }
  OT.agents.time = { toMin: toMin, fromMin: fromMin, fmtDate: fmtDate, fmtGap: fmtGap, agoLabel: agoLabel, addMinIso: addMinIso, isoMs: isoMs, stamp: stamp };
  OT.fmtDate = fmtDate;

  /* ---------------- Query understanding (11 languages, rule-based) ---------------- */
  var KW = {
    hotel: ['hotel', 'stay', 'room', 'lodge', 'होटल', 'कमरा', 'ठहर', 'रुकने', 'धर्मशाला', 'हॉटेल', 'राहण्', 'হোটেল', 'থাকার', 'ধর্মশালা', 'ஹோட்டல்', 'தங்கும்', 'விடுதி', 'அறை', 'లాడ్జ్', 'హోటల్', 'గది', 'ಹೋಟೆಲ್', 'ಕೊಠಡಿ', 'ഹോട്ടൽ', 'മുറി', 'હોટલ', 'હોટેલ', 'રૂમ', 'ਹੋਟਲ', 'ਕਮਰਾ', 'ହୋଟେଲ', 'ରହିବା'],
    cab: ['cab', 'taxi', 'auto', 'transfer', 'pickup', 'ride', 'टैक्सी', 'कैब', 'ऑटो', 'गाड़ी', 'गाडी', 'ট্যাক্সি', 'ক্যাব', 'গাড়ি', 'டாக்ஸி', 'கார்', 'ஆட்டோ', 'ట్యాక్సీ', 'క్యాబ్', 'ಟ್ಯಾಕ್ಸಿ', 'ಕ್ಯಾಬ್', 'ടാക്സി', 'ക്യാബ്', 'ટેક્સી', 'કેબ', 'ਟੈਕਸੀ', 'ਕੈਬ', 'ଟ୍ୟାକ୍ସି', 'ଗାଡ଼ି'],
    food: ['food', 'meal', 'thali', 'lunch', 'dinner', 'breakfast', 'catering', 'खाना', 'भोजन', 'थाली', 'नाश्ता', 'जेवण', 'খাবার', 'খাওয়া', 'சாப்பாடு', 'உணவு', 'భోజనం', 'ఆహారం', 'ಊಟ', 'ಆಹಾರ', 'ഭക്ഷണം', 'ભોજન', 'જમવા', 'ਖਾਣਾ', 'ਭੋਜਨ', 'ଖାଦ୍ୟ', 'ଖାଇବା'],
    sight: ['sight', 'visit', 'tour', 'temple', 'see', 'घूम', 'मंदिर', 'दर्शन', 'पर्यटन', 'फिर', 'ঘুর', 'মন্দির', 'দর্শন', 'சுற்றுலா', 'கோயில்', 'கோவில்', 'தரிசனம்', 'పర్యటన', 'ఆలయం', 'ಪ್ರವಾಸ', 'ದೇವಾಲಯ', 'ക്ഷേത്രം', 'സന്ദർശ', 'ફરવા', 'મંદિર', 'ਘੁੰਮ', 'ਮੰਦਰ', 'ବୁଲିବା', 'ମନ୍ଦିର']
  };
  var NEAR = ['station', 'railway', 'स्टेशन', 'रेलवे', 'স্টেশন', 'রেল', 'நிலைய', 'ஸ்டேஷன்', 'ரயில்', 'స్టేషన్', 'రైల్వే', 'ನಿಲ್ದಾಣ', 'ಸ್ಟೇಷನ್', 'സ്റ്റേഷൻ', 'റെയിൽവേ', 'સ્ટેશન', 'ਸਟੇਸ਼ਨ', 'ଷ୍ଟେସନ', 'near', 'पास', 'নজদীক', 'কাছে', 'அருகே', 'அருகில்', 'దగ్గర', 'ಹತ್ತಿರ', 'അടുത്ത്', 'નજીક', 'ਨੇੜੇ', 'ପାଖରେ', 'जवळ'];
  var VEG = ['veg', 'vegetarian', 'शाकाहारी', 'शुद्ध', 'নিরামিষ', 'சைவ', 'శాకాహార', 'ಸಸ್ಯಾಹಾರ', 'സസ്യാഹാര', 'શાકાહારી', 'ਸ਼ਾਕਾਹਾਰੀ', 'ନିରାମିଷ', 'शाकाहार'];
  var FAMILY = ['family', 'parents', 'kids', 'परिवार', 'बच्चे', 'পরিবার', 'குடும்ப', 'కుటుంబ', 'ಕುಟುಂಬ', 'കുടുംബ', 'પરિવાર', 'ਪਰਿਵਾਰ', 'ପରିବାର', 'कुटुंब'];
  var THOUSAND = ['thousand', 'hazaar', 'hazar', 'hajar', 'हज़ार', 'हजार', 'হাজার', 'ஆயிர', 'వేల', 'వెయ్యి', 'ಸಾವಿರ', 'ആയിര', 'હજાર', 'ਹਜ਼ਾਰ', 'ਹਜਾਰ', 'ହଜାର'];
  var UNITS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, ek: 1, do: 2, teen: 3, char: 4, paanch: 5, dhai: 2.5, dedh: 1.5,
    'एक': 1, 'दो': 2, 'दोन': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'पाच': 5, 'छह': 6, 'सात': 7, 'आठ': 8, 'ढाई': 2.5, 'डेढ़': 1.5, 'डेढ': 1.5, 'अडीच': 2.5, 'दीड': 1.5,
    'এক': 1, 'দুই': 2, 'দু': 2, 'তিন': 3, 'চার': 4, 'পাঁচ': 5, 'আড়াই': 2.5, 'দেড়': 1.5,
    'ஒரு': 1, 'இரண்டு': 2, 'ரெண்டு': 2, 'மூன்று': 3, 'நான்கு': 4, 'ஐந்து': 5,
    'ఒక': 1, 'రెండు': 2, 'మూడు': 3, 'నాలుగు': 4, 'ఐదు': 5,
    'ಒಂದು': 1, 'ಎರಡು': 2, 'ಮೂರು': 3, 'ನಾಲ್ಕು': 4, 'ಐದು': 5,
    'ഒരു': 1, 'രണ്ട്': 2, 'മൂന്ന്': 3, 'നാല്': 4, 'അഞ്ച്': 5,
    'એક': 1, 'બે': 2, 'ત્રણ': 3, 'ચાર': 4, 'પાંચ': 5, 'અઢી': 2.5, 'દોઢ': 1.5,
    'ਇੱਕ': 1, 'ਦੋ': 2, 'ਤਿੰਨ': 3, 'ਚਾਰ': 4, 'ਪੰਜ': 5, 'ਢਾਈ': 2.5, 'ਡੇਢ': 1.5,
    'ଏକ': 1, 'ଦୁଇ': 2, 'ତିନି': 3, 'ଚାରି': 4, 'ପାଞ୍ଚ': 5, 'ଅଢ଼େଇ': 2.5, 'ଦେଢ଼': 1.5
  };
  var COMPOUND = { 'இரண்டாயிர': 2000, 'ரெண்டாயிர': 2000, 'மூவாயிர': 3000, 'மூன்றாயிர': 3000, 'நாலாயிர': 4000, 'நான்காயிர': 4000, 'ஐயாயிர': 5000, 'ஆயிர': 1000,
    'രണ്ടായിര': 2000, 'മൂവായിര': 3000, 'നാലായിര': 4000, 'ആയിര': 1000, 'వెయ్యి': 1000 };
  var CURRENCY = /(rupees?|rs\.?|inr|रुपये|रुपए|रुपया|रूपये|টাকা|ரூபாய்|రూపాయ|ರೂಪಾಯಿ|രൂപ|રૂપિયા|ਰੁਪਏ|ଟଙ୍କା)/;

  function has(t, list) { for (var i = 0; i < list.length; i++) if (t.indexOf(list[i].toLowerCase()) >= 0) return list[i]; return null; }
  function parseBudget(t) {
    var m = t.match(/(?:₹|rs\.?\s?|inr\s?)\s*(\d[\d,]*)/);
    if (m) return +m[1].replace(/,/g, '');
    m = t.match(/(\d[\d,]*)\s*(k\b|हज़ार|हजार|thousand|হাজার)/);
    if (m) return +m[1].replace(/,/g, '') * 1000;
    m = t.match(new RegExp('(\\d[\\d,]*)\\s*' + CURRENCY.source));
    if (m) return +m[1].replace(/,/g, '');
    var words = t.split(/[\s,।.?!]+/);
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      for (var c in COMPOUND) {
        if (w.indexOf(c) === 0) {
          // "ஆயிரம்" alone may be preceded by a unit word
          if ((c === 'ஆயிர' || c === 'ആയിര') && i > 0 && UNITS[words[i - 1]]) return UNITS[words[i - 1]] * 1000;
          return COMPOUND[c];
        }
      }
      if (has(w, THOUSAND)) {
        var prev = words[i - 1] || '';
        var u = UNITS[prev] || (/^\d+(\.\d+)?$/.test(prev) ? +prev : 1);
        return Math.round(u * 1000);
      }
    }
    m = t.match(/\b(\d{3,4})\b/);
    if (m && +m[1] >= 300 && +m[1] <= 9999) return +m[1];
    return null;
  }
  function findCity(t) {
    if (OT.data.rail) { var cmd = OT.agents.parseCommand(t); if (cmd.to) return cmd.to; }
    var st = D().stations, dests = ['CDG', 'MDU', 'PURI'];
    for (var i = 0; i < dests.length; i++) {
      var s = st[dests[i]];
      var names = Object.keys(s.names).map(function (k) { return s.names[k]; }).concat(s.alias);
      if (has(t, names) || new RegExp('\\b' + s.code + '\\b', 'i').test(t)) return s.code;
    }
    return null;
  }
  OT.agents.parseQuery = function (text) {
    var raw = String(text || '');
    var t = (OT.lang ? OT.lang.normDigits(raw) : raw).toLowerCase();
    var types = [];
    Object.keys(KW).forEach(function (k) { if (has(t, KW[k])) types.push(k); });
    var intent = {
      raw: raw, to: findCity(t), budget: parseBudget(t), types: types,
      nearStation: !!has(t, NEAR), prefs: { veg: !!has(t, VEG), family: !!has(t, FAMILY) }, engine: 'rules'
    };
    var found = (intent.to ? 1 : 0) + (intent.budget ? 1 : 0) + (types.length ? 1 : 0) + (intent.nearStation ? 1 : 0);
    intent.confidence = Math.round((0.4 + found * 0.14) * 100) / 100;
    return intent;
  };
  OT.agents.intentToEnglish = function (i) {
    var typeEn = { hotel: 'a hotel', cab: 'a cab', food: 'food', sight: 'sightseeing' };
    var what = (i.types && i.types.length ? i.types : ['hotel']).map(function (x) { return typeEn[x]; }).join(' and ');
    var city = i.to ? D().stations[i.to].names.en + ' (' + i.to + ')' : 'the destination';
    return 'Looking for ' + what + (i.nearStation ? ' near ' + city + ' railway station' : ' in ' + city) + (i.budget ? ' up to ' + OT.inr(i.budget) : '') + '.';
  };

  /* ---------------- Research Agent ---------------- */
  OT.agents.research = function (intent) {
    var city = intent.to || 'CDG';
    var types = ['hotel', 'cab', 'food', 'sight'];
    var toolCalls = [], sources = {}, records = [];
    types.forEach(function (ty) {
      var tool = { hotel: 'hotel_search', cab: 'cab_search', food: 'food_search', sight: 'sight_search' }[ty];
      var args = { tool: tool, city: city, near: intent.nearStation ? city : undefined, date: intent.date };
      if (ty === 'hotel' && intent.budget) args.max_price = intent.budget;
      var found = D().byCity(city, ty).filter(function (x) { return !x.leg; }); // per-leg transport quotes are not catalogue listings
      found.forEach(function (x) {
        sources[x.source.name] = (sources[x.source.name] || 0) + 1;
        records.push({ item: x, checkedAt: x.source.checkedAt, source: x.source });
      });
      toolCalls.push({ call: JSON.parse(JSON.stringify(args)), returned: found.length });
    });
    return { city: city, records: records, sources: sources, toolCalls: toolCalls, at: new Date().toISOString() };
  };

  /* ---------------- Verification Agent ---------------- */
  var rechecked = {};      // id -> ms timestamp of a manual re-check this session
  OT.agents.recheck = function (id) { rechecked[id] = Date.now(); return OT.agents.verifyOne(D().get(id)); };
  OT.agents.verifyOne = function (x) {
    if (!x) return null;
    var ps = x.providerSource, flags = [], checks = [];
    var staleMs = D().staleHours * 3600000;
    var srcAt = rechecked[x.id] ? new Date(rechecked[x.id]).toISOString() : ps.checkedAt;
    var age = Date.now() - new Date(srcAt).getTime();
    var verdict = 'verified', livePrice = ps.price;
    if (ps.availability === 'soldout') {
      verdict = 'unavailable';
      flags.push({ kind: 'soldout', key: 'ver.soldout', en: '{name}: sold out at source, hidden', vars: { name: x.name } });
    }
    if (ps.price !== x.price) {
      if (verdict !== 'unavailable') verdict = 'confirm';
      flags.push({ kind: 'price', key: 'ver.price', en: '{name}: price changed {from} → {to} at source, flagged Needs confirmation', vars: { name: x.name, from: OT.inr(x.price), to: OT.inr(ps.price) } });
    } else checks.push({ key: 'ver.priceOk', en: 'Price {price} matched in 2 sources', vars: { price: OT.inr(x.price) } });
    if (ps.rating == null && !ps.ratingNotApplicable) {
      if (verdict === 'verified') verdict = 'confirm';
      flags.push({ kind: 'rating', key: 'ver.rating', en: '{name}: rating missing at source, shown as unavailable', vars: { name: x.name } });
    } else if (ps.rating != null) checks.push({ key: 'ver.ratingOk', en: 'Rating {r} matched', vars: { r: ps.rating } });
    if (age > staleMs) {
      if (verdict === 'verified') verdict = 'confirm';
      flags.push({ kind: 'stale', key: 'ver.stale', en: '{name}: data {h} h old (> 6 h), re-check required', vars: { name: x.name, h: Math.round(age / 360000) / 10 } });
    } else checks.push({ key: 'ver.fresh', en: 'Checked {ago}', vars: { ago: agoLabel(srcAt) } });
    if (!x.policy) {
      if (verdict === 'verified') verdict = 'confirm';
      flags.push({ kind: 'policy', key: 'ver.policy', en: '{name}: cancellation policy not published, contact provider', vars: { name: x.name } });
    } else checks.push({ key: 'ver.policyOk', en: 'Cancellation policy present', vars: {} });
    if (ps.availability !== 'soldout') checks.push({ key: 'ver.availOk', en: 'Availability matched', vars: {} });
    return { item: x, verdict: verdict, flags: flags, checks: checks, livePrice: livePrice, sourceCheckedAt: srcAt, recheckedNow: !!rechecked[x.id] };
  };
  OT.agents.verify = function (records) { return records.map(function (r) { return OT.agents.verifyOne(r.item); }); };

  /* ---------------- Recommendation Agent ---------------- */
  function score(v, intent) {
    var x = v.item, s = 0, p = intent.prefs || {};
    s += (x.rating || 3.5) * 20;
    s -= (x.distanceKm || 0) * (intent.nearStation ? 2 : 1);
    if (v.verdict === 'verified') s += 15;
    if (p.freeCancel && x.policy && x.policy.fullUntilH >= 24) s += 8;
    if (p.veg && x.tags.indexOf('veg') >= 0) s += 6;
    if (p.family && x.tags.indexOf('family') >= 0) s += 4;
    if (p.temple && x.tags.indexOf('temple') >= 0) s += 6;
    if (x.availability === 'few') s -= 3;
    if (x.type === 'hotel' && intent.budget) s += Math.max(0, (intent.budget - v.livePrice) / intent.budget * 10);
    if (x.type === 'cab' && x.offsetMin != null) s += 12;            // station transfers first
    if (x.type === 'sight' && x.tags.indexOf('gapFill') >= 0) s += 6;
    return s;
  }
  function reasons(v, intent) {
    var x = v.item, r = [], p = intent.prefs || {};
    if (x.type === 'hotel' && intent.budget && v.livePrice <= intent.budget) r.push({ key: 'why.budget', en: 'Within {b}', vars: { b: OT.inr(intent.budget) } });
    if (x.distanceKm != null && x.distanceKm <= 2) r.push({ key: 'why.near', en: '{d} km from station', vars: { d: x.distanceKm } });
    if (x.policy && x.policy.fullUntilH >= 24) r.push({ key: 'why.freeCancel', en: 'Free cancellation till {h} h before', vars: { h: x.policy.fullUntilH } });
    if (p.veg && x.tags.indexOf('veg') >= 0) r.push({ key: 'why.veg', en: 'Matches: veg', vars: {} });
    if (x.rating >= 4.4) r.push({ key: 'why.rated', en: 'Rated {r}', vars: { r: x.rating } });
    if (x.managed === 'irctc') r.push({ key: 'why.irctc', en: 'IRCTC-managed', vars: {} });
    if (x.type === 'cab' && x.offsetMin != null) r.push({ key: 'why.transfer', en: 'Timed to your train arrival', vars: {} });
    if (x.tags.indexOf('gapFill') >= 0) r.push({ key: 'why.gap', en: 'Fits the arrival/check-in gap', vars: {} });
    if (p.temple && x.tags.indexOf('temple') >= 0) r.push({ key: 'why.temple', en: 'Matches: temple visit', vars: {} });
    return r;
  }
  OT.agents.recommend = function (verified, intent) {
    var byType = { hotel: [], cab: [], food: [], sight: [] }, hidden = [], filtered = [];
    var dismissed = (OT.state && OT.state.dismissed) || {};
    verified.forEach(function (v) {
      if (v.verdict === 'unavailable') { hidden.push({ v: v, reason: 'soldout' }); return; }
      if (v.item.type === 'hotel' && intent.budget && v.item.price > intent.budget && v.livePrice > intent.budget) { filtered.push({ v: v, reason: 'budget' }); return; }
      if (v.item.type === 'hotel' && intent.budgetMin && v.livePrice < intent.budgetMin) { filtered.push({ v: v, reason: 'budgetMin' }); return; }
      if (dismissed[v.item.id]) { filtered.push({ v: v, reason: 'dismissed' }); return; }
      v.score = score(v, intent); v.reasons = reasons(v, intent);
      byType[v.item.type].push(v);
    });
    Object.keys(byType).forEach(function (k) {
      var list = byType[k].sort(function (a, b) { return b.score - a.score; });
      // Sponsored guardrail: a verified sponsored item may rise at most ONE slot above its organic rank.
      for (var i = 1; i < list.length; i++) {
        if (list[i].item.sponsored && list[i].verdict === 'verified' && !list[i - 1].item.sponsored && !list[i].lifted) {
          var tmp = list[i - 1]; list[i - 1] = list[i]; list[i] = tmp; list[i - 1].lifted = true; i++;
        }
      }
      if (list[0]) list[0].top = true;
    });
    return { byType: byType, hidden: hidden, filtered: filtered };
  };

  /* ---------------- Itinerary Agent ---------------- */
  OT.agents.slotFor = function (x, j) {
    if (!j.train) {   // v1.2 trip without a train: anchor on the trip start date
      var d0 = j.start || D().defaultDate();
      if (x.type === 'hotel') return { when: dt(d0, x.checkIn || '12:00'), endWhen: dt(j.end && j.end > d0 ? j.end : D().addDays(d0, j.nights || 1), x.checkOut || '11:00') };
      var dd = D().addDays(d0, x.day || 0);
      return { when: dt(dd, x.slot || '10:00'), endWhen: x.durationMin ? addMinIso(dt(dd, x.slot || '10:00'), x.durationMin) : undefined };
    }
    var tr = j.train, arrDate = tr.arrDate || tr.date, arrIso = dt(arrDate, tr.arr);
    if (x.type === 'hotel') {
      // late arrival (after the hotel's check-in time): check in ~45 min after the train arrives
      var ci = dt(arrDate, x.checkIn);
      if (isoMs(ci) < isoMs(arrIso)) ci = addMinIso(arrIso, 45);
      return { when: ci, endWhen: dt(D().addDays(arrDate, j.nights || 1), x.checkOut) };
    }
    if (x.type === 'cab' && x.offsetMin != null) return { when: addMinIso(arrIso, x.offsetMin), endWhen: addMinIso(arrIso, x.offsetMin + (x.durationMin || 20)) };
    if (x.type === 'food' && x.onTrain) return { when: dt(tr.date, x.slot) };
    var day = x.day || 0, base = D().addDays(arrDate, day);
    var w = dt(base, x.slot || '10:00');
    // never plan a sight or meal before the train arrives (+1 h to reach it): move it to the next day
    if (isoMs(w) < isoMs(arrIso) + 3600000) w = dt(D().addDays(base, 1), x.slot || '10:00');
    return { when: w, endWhen: x.durationMin ? addMinIso(w, x.durationMin) : undefined };
  };

  function activeItems(j) { return (j.items || []).filter(function (i) { return i.status !== 'cancelled'; }); }
  /* v1.2.1: auto / e-rickshaw rides the traveller will take and pay on the meter (never booked, never charged). */
  function meterEvents(j) {
    return (OT.meter ? OT.meter.list(j) : []).map(function (r) {
      return { id: r.id, kind: 'meter', when: r.when || null, icon: 'auto', seg: 'local', meter: r, unknownTime: !r.when,
        title: r.title, sub: OT.meter.approx(r) + ' · ' + T('tl.meterSub', 'no booking, pay the driver') };
    });
  }
  /** The booked (or linked) return train, unless it was cancelled. */
  function liveReturn(j) { var r = j && j.returnTrain; return r && r.status !== 'CANCELLED' ? r : null; }
  OT.agents.liveReturn = liveReturn;

  /* v1.2: a trip without a train (standalone hotel / transport / food / sight bookings) */
  function tripItinerary(j) {
    var ev = [];
    activeItems(j).forEach(function (it) {
      var x = D().get(it.refId) || {};
      if (it.type === 'hotel') {
        ev.push({ id: it.id + '-in', kind: 'checkin', when: it.when || null, icon: 'hotel', seg: 'local', itemId: it.id, item: it,
          title: T('tl.checkin', 'Check-in: {name}', { name: it.title }), sub: x.area || '' });
        if (it.endWhen) ev.push({ id: it.id + '-out', kind: 'checkout', when: it.endWhen, icon: 'hotel', seg: 'local', itemId: it.id, item: it, title: T('tl.checkout', 'Check-out: {name}', { name: it.title }), sub: '' });
        return;
      }
      var titles = { cab: x.mode ? T('tl.ride', 'Ride: {name}', { name: it.title }) : T('tl.pickup', 'Pickup: {name}', { name: it.title }), food: T('tl.meal', 'Meal: {name}', { name: it.title }), sight: T('tl.visit', 'Visit: {name}', { name: it.title }) };
      ev.push({ id: it.id, kind: it.type, when: it.when || null, icon: OT.itemIcon ? OT.itemIcon(x, it.type) : it.type, seg: 'local', itemId: it.id, item: it, title: titles[it.type] || it.title, sub: x.meet || x.area || '', unknownTime: !it.when });
    });
    ev = ev.concat(meterEvents(j));
    ev.sort(function (a, b) { if (!a.when) return 1; if (!b.when) return -1; return isoMs(a.when) - isoMs(b.when); });
    if (ev.length) ev[ev.length - 1].seg = null;
    return { events: ev, conflicts: [], trip: true };
  }
  OT.agents.itinerary = function (j) {
    if (j && !j.train && j.kind === 'trip') return tripItinerary(j);
    if (!j || !j.train) return { events: [], conflicts: [] };
    var tr = j.train, st = D().stations, L = OT.i18n ? OT.i18n.lang() : 'en';
    var arrDate = tr.arrDate || tr.date, arrIso = dt(arrDate, tr.arr), depIso = dt(tr.date, tr.dep);
    var ev = [];
    ev.push({ id: 'dep', kind: 'dep', when: depIso, station: tr.from, icon: 'train', seg: 'train',
      title: T('tl.depart', 'Depart {station}', { station: D().stationName(tr.from, L) }), sub: tr.no + ' ' + tr.name });
    var trn = D().trains[tr.no];
    (trn && trn.stops || []).forEach(function (s) {
      var food = activeItems(j).filter(function (i) { return i.type === 'food' && D().get(i.refId) && D().get(i.refId).onTrain; })[0];
      if (food) ev.push({ id: 'stop-' + s.code, kind: 'stop', when: dt(tr.date, s.arr), station: s.code, icon: 'food', seg: 'train', itemId: food.id,
        title: T('tl.mealOnboard', 'Meal delivered at {station}', { station: D().stationName(s.code, L) }), sub: food.title, item: food });
    });
    ev.push({ id: 'arr', kind: 'arr', when: arrIso, station: tr.to, icon: 'pin', seg: 'local',
      title: T('tl.arrive', 'Arrive {station}', { station: D().stationName(tr.to, L) }), sub: tr.no + ' · ' + T('tl.coach', 'Coach {c}', { c: tr.coach }) });

    activeItems(j).forEach(function (it) {
      var x = D().get(it.refId) || {};
      if (it.type === 'food' && x.onTrain) return;
      var when = it.when || null;
      if (it.type === 'hotel') {
        var ci = it.earlyCheckIn ? dt(arrDate, it.earlyTime || fromMin(toMin(tr.arr) + 30)) : when;
        ev.push({ id: it.id + '-in', kind: 'checkin', when: ci, icon: 'hotel', seg: 'local', itemId: it.id, item: it,
          title: T('tl.checkin', 'Check-in: {name}', { name: it.title }), sub: it.earlyCheckIn ? T('tl.earlyReq', 'Early check-in requested · awaiting hotel confirmation') : T('tl.stdCheckin', 'Standard check-in {t}', { t: x.checkIn || '' }) });
        if (it.endWhen) ev.push({ id: it.id + '-out', kind: 'checkout', when: it.endWhen, icon: 'hotel', seg: 'local', itemId: it.id, item: it,
          title: T('tl.checkout', 'Check-out: {name}', { name: it.title }), sub: '' });
        return;
      }
      var titles = { cab: x.mode ? T('tl.ride', 'Ride: {name}', { name: it.title }) : T('tl.pickup', 'Pickup: {name}', { name: it.title }), food: T('tl.meal', 'Meal: {name}', { name: it.title }), sight: x.service === 'cloakroom' ? T('tl.cloak', 'Drop bags: {name}', { name: it.title }) : T('tl.visit', 'Visit: {name}', { name: it.title }) };
      ev.push({ id: it.id, kind: it.type, when: when, icon: OT.itemIcon ? OT.itemIcon(x, it.type) : it.type, seg: 'local', itemId: it.id, item: it,
        title: titles[it.type] || it.title, sub: x.meet || x.area || '', unknownTime: !when });
    });
    ev = ev.concat(meterEvents(j));
    var r = liveReturn(j);
    if (r) {
      ev.push({ id: 'rdep', kind: 'rdep', when: dt(r.date, r.dep), station: r.from, icon: 'train', seg: 'train',
        title: T('tl.return', 'Return train from {station}', { station: D().stationName(r.from, L) }), sub: r.no + ' ' + r.name + (r.pnr ? ' · PNR ' + r.pnr : ' · ' + T('hold.badge', 'Not paid yet')) });
      var rt = D().trains[r.no];
      ev.push({ id: 'rarr', kind: 'rarr', when: dt(r.arrDate || D().addDays(r.date, rt ? rt.arrOffset : 0), r.arr), station: r.to, icon: 'pin', seg: null,
        title: T('tl.home', 'Arrive {station}', { station: D().stationName(r.to, L) }), sub: r.no });
    }
    ev.sort(function (a, b) {
      if (!a.when) return 1; if (!b.when) return -1;
      return isoMs(a.when) - isoMs(b.when) || (a.kind === 'arr' ? -1 : b.kind === 'arr' ? 1 : 0);
    });
    // segment after the last node never draws
    if (ev.length) ev[ev.length - 1].seg = null;
    // train segment runs dep -> arr (and rdep -> rarr); everything else local
    var inTrain = false;
    ev.forEach(function (e) {
      if (e.kind === 'dep' || e.kind === 'rdep') inTrain = true;
      if (e.kind === 'arr' || e.kind === 'rarr') inTrain = false;
      if (e.seg !== null) e.seg = inTrain ? 'train' : 'local';
    });

    /* conflicts */
    var conflicts = [];
    var hotel = activeItems(j).filter(function (i) { return i.type === 'hotel'; })[0];
    if (hotel) {
      var hx = D().get(hotel.refId) || {};
      var arrM = toMin(tr.arr), ciM = toMin(hx.checkIn || '14:00');
      var gap = ciM - arrM;
      if (hotel.when && hotel.when.slice(0, 10) === arrDate && gap > 30) {
        var items = activeItems(j);
        var cloak = items.filter(function (i) { var x = D().get(i.refId); return x && x.service === 'cloakroom'; })[0];
        var fill = items.filter(function (i) {
          var x = D().get(i.refId); if (!x || i.type === 'hotel' || i.type === 'cab' || !i.when) return false;
          var m = isoMs(i.when); return m >= isoMs(arrIso) && m < isoMs(dt(arrDate, hx.checkIn)) && (x.tags.indexOf('gapFill') >= 0 || i.type === 'food');
        })[0];
        var how = hotel.earlyCheckIn ? 'early' : cloak ? 'cloak' : fill ? 'visit' : null;
        conflicts.push({ id: 'checkin-gap', kind: 'gap', arr: tr.arr, checkIn: hx.checkIn, gapMin: gap, resolved: !!how, how: how,
          hotelItemId: hotel.id, earlyFee: hx.earlyCheckIn ? hx.earlyCheckIn.fee : null, after: 'arr' });
      }
    }
    activeItems(j).forEach(function (it) {
      if (it.type === 'cab' && it.when && isoMs(it.when) < isoMs(arrIso) && D().get(it.refId) && D().get(it.refId).offsetMin != null) {
        conflicts.push({ id: 'cab-early-' + it.id, kind: 'cabEarly', itemId: it.id, resolved: false, after: it.id });
      }
      if (it.type !== 'food' && it.when && isoMs(it.when) < isoMs(arrIso) && it.type !== 'cab') {
        conflicts.push({ id: 'before-' + it.id, kind: 'beforeArrival', itemId: it.id, resolved: false, after: it.id });
      }
    });
    /* v1.2.1: the return train must leave after the outward arrival and after hotel check-out */
    if (r) {
      var rdep = isoMs(dt(r.date, r.dep));
      if (rdep < isoMs(arrIso)) conflicts.push({ id: 'ret-before-arr', kind: 'retBeforeArr', resolved: false, after: 'rdep', dep: r.dep, date: r.date });
      var stay = activeItems(j).filter(function (i) { return i.type === 'hotel' && i.endWhen; })[0];
      if (stay && rdep < isoMs(stay.endWhen)) {
        conflicts.push({ id: 'ret-checkout', kind: 'retCheckout', resolved: !!stay.earlyCheckout, hotelItemId: stay.id, after: 'rdep',
          dep: r.dep, date: r.date, checkout: String(stay.endWhen).slice(11, 16), checkoutDate: String(stay.endWhen).slice(0, 10) });
      }
    }
    return { events: ev, conflicts: conflicts };
  };

  /* ---------------- Trip Readiness (weighted, explainable) ----------------
   * Ticket 30 · Stay 25 · Arrival transfer 20 · Meal 10 · Return 10 · Conflicts resolved 5.
   * Booked (confirmed) = 100% of weight, planned (selected) = 80%, any "Needs confirmation" = 50%.
   */
  OT.agents.READINESS_WEIGHTS = { ticket: 30, stay: 25, transfer: 20, meal: 10, ret: 10, conflicts: 5 };
  function credit(it) {
    if (!it) return { f: 0, state: 'missing' };
    if (it.verification === 'confirm') return { f: 0.5, state: 'confirm' };
    if (it.status === 'confirmed') return { f: 1, state: 'booked' };
    return { f: 0.8, state: 'planned' };
  }
  OT.agents.readiness = function (j) {
    var W = OT.agents.READINESS_WEIGHTS, parts = [];
    if (j && !j.train && j.kind === 'trip') return tripReadiness(j);
    if (!j || !j.train) return { score: 0, parts: [] };
    var items = activeItems(j);
    var tf = { CNF: 1, RAC: 0.5, WL: 0.25, HELD: 0.8 }[j.train.status] || 0;   // v1.2.2: a train kept in the trip unpaid counts like any planned item (80%)
    parts.push({ id: 'ticket', w: W.ticket, pts: W.ticket * tf, state: j.train.status === 'HELD' ? 'unpaid' : tf === 1 ? 'booked' : tf > 0 ? 'confirm' : j.train.status === 'CANCELLED' ? 'cancelled' : 'missing' });
    function best(filter) {
      var c = items.filter(filter).map(credit).sort(function (a, b) { return b.f - a.f; })[0];
      return c || { f: 0, state: 'missing' };
    }
    var stay = best(function (i) { return i.type === 'hotel'; });
    parts.push({ id: 'stay', w: W.stay, pts: W.stay * stay.f, state: stay.state });
    var tr = best(function (i) { var x = D().get(i.refId); return i.type === 'cab' && x && x.offsetMin != null; });   // station transfer (cab, metro, bus… from the station)
    if (tr.f < 1 && OT.meter && OT.meter.list(j).some(function (m) { return m.station; })) tr = { f: 1, state: 'meter' };   // "I'll take an auto": nothing to book, so it counts in full
    parts.push({ id: 'transfer', w: W.transfer, pts: W.transfer * tr.f, state: tr.state });
    var meal = best(function (i) { return i.type === 'food'; });
    parts.push({ id: 'meal', w: W.meal, pts: W.meal * meal.f, state: meal.state });
    var rt = liveReturn(j), rf = rt ? ({ CNF: 1, RAC: 0.5, WL: 0.25, HELD: 0.8 }[rt.status || 'CNF'] || 0) : 0;
    parts.push({ id: 'ret', w: W.ret, pts: W.ret * rf, state: !rt ? 'missing' : rt.status === 'HELD' ? 'unpaid' : rf === 1 ? 'booked' : 'confirm' });
    var conf = OT.agents.itinerary(j).conflicts, open = conf.filter(function (c) { return !c.resolved; }).length;
    parts.push({ id: 'conflicts', w: W.conflicts, pts: open ? 0 : W.conflicts, state: open ? 'open' : 'booked', open: open });
    var score = Math.round(parts.reduce(function (s, p) { return s + p.pts; }, 0));
    return { score: Math.min(100, score), parts: parts };
  };

  /** Trip without a train: same checklist minus ticket and return, re-weighted to 100 (stay 42 · transfer 33 · meal 17 · conflicts 8). */
  OT.agents.TRIP_WEIGHTS = { stay: 42, transfer: 33, meal: 17, conflicts: 8 };
  function tripReadiness(j) {
    var W = OT.agents.TRIP_WEIGHTS, items = activeItems(j), parts = [];
    function best(filter) { var c = items.filter(filter).map(credit).sort(function (a, b) { return b.f - a.f; })[0]; return c || { f: 0, state: 'missing' }; }
    var stay = best(function (i) { return i.type === 'hotel'; });
    parts.push({ id: 'stay', w: W.stay, pts: W.stay * stay.f, state: stay.state });
    var tr = best(function (i) { return i.type === 'cab'; });
    if (tr.f < 1 && OT.meter && OT.meter.list(j).length) tr = { f: 1, state: 'meter' };
    parts.push({ id: 'transfer', w: W.transfer, pts: W.transfer * tr.f, state: tr.state });
    var meal = best(function (i) { return i.type === 'food'; });
    parts.push({ id: 'meal', w: W.meal, pts: W.meal * meal.f, state: meal.state });
    parts.push({ id: 'conflicts', w: W.conflicts, pts: W.conflicts, state: 'booked', open: 0 });
    var score = Math.round(parts.reduce(function (s, p) { return s + p.pts; }, 0));
    return { score: Math.min(100, score), parts: parts, trip: true };
  }

  /* ---------------- Pricing + refund helpers ---------------- */
  OT.agents.lineFor = function (it, j) {
    var x = D().get(it.refId) || {}, pax = it.pax || (j && j.passengers) || 1, qty = 1, unit = it.price;
    if (x.basis === 'night') qty = (it.nights || (j && j.nights) || 1) * (it.rooms || 1);   // v1.2: standalone stays carry their own nights/rooms
    if (x.basis === 'person') qty = pax;
    if (x.basis === 'bag') qty = pax;
    var amount = unit * qty;
    if (it.earlyCheckIn && x.earlyCheckIn) amount += x.earlyCheckIn.fee;
    var gstRate = x.type === 'sight' ? (x.basis === 'person' && x.price >= 500 ? 0.18 : 0) : 0.05;
    var gst = Math.round(amount - amount / (1 + gstRate));
    return { unit: unit, qty: qty, basis: x.basis, amount: amount, gst: gst, gstRate: gstRate, early: it.earlyCheckIn && x.earlyCheckIn ? x.earlyCheckIn.fee : 0 };
  };
  /** Policy-based refund: booking -> {pct, amount, freeUntil, hoursLeft, policy} */
  OT.agents.refundFor = function (b, nowMs) {
    nowMs = nowMs || Date.now();
    if (b.type === 'train' && b.ticket && OT.data.rail) {
      var rr = OT.data.rail.refund(b.ticket, nowMs);
      return { pct: b.amount ? Math.round(rr.amount / b.amount * 100) : 0, amount: rr.amount, charge: rr.charge, hoursLeft: rr.hoursLeft, policy: { rail: true, rule: rr.rule }, start: nowMs + rr.hoursLeft * 3600000 };
    }
    var j = OT.store.get('journey'), it = j && (j.items || []).filter(function (i) { return i.id === b.itemId; })[0];
    var x = D().get(b.refId || (it && it.refId)) || {};
    var start = it && it.when ? isoMs(it.when) : (b.startAt ? isoMs(b.startAt) : nowMs + 7 * 86400000);
    var hoursLeft = (start - nowMs) / 3600000;
    var pol = x.policy;
    if (!pol) return { pct: null, amount: null, hoursLeft: hoursLeft, policy: null, start: start };
    var pct = hoursLeft >= pol.fullUntilH ? 100 : pol.thenPct;
    if (hoursLeft < 0) pct = 0;
    return { pct: pct, amount: Math.round(b.amount * pct / 100), hoursLeft: hoursLeft, policy: pol, start: start, freeUntil: start - pol.fullUntilH * 3600000 };
  };
  OT.agents.policyText = function (pol, lang) {
    var T = lang && OT.i18n ? function (k, fb, v) { return OT.i18n.tIn(lang, k, fb, v); } : function (k, fb, v) { return OT.t ? OT.t(k, fb, v) : fb; };
    if (pol && pol.rail) return T('rail.policy', 'Railway-style refund (simulated): flat charge per passenger if cancelled more than 48 h before departure, 25% of fare up to 12 h, 50% up to 4 h, nothing after chart preparation; waitlisted/RAC: ₹60 per passenger. Convenience fee is not refunded.');
    if (!pol) return T('pol.none', 'Cancellation policy not published by provider. Contact provider before booking.');
    if (pol.fullUntilH === 0 && pol.thenPct === 0) return T('pol.payAtUse', 'Pay-at-use or no-refund item: cancel any time before use, nothing is charged in advance online (sample).');
    if (pol.fullUntilH === 0) return T('pol.flex', 'Fully refundable until use.');
    if (pol.thenPct === 0 && OT.i18n && OT.i18n.has('pol.strict', lang || OT.i18n.lang())) return T('pol.strict', 'Free cancellation until {h} h before start; no refund after that.', { h: pol.fullUntilH });
    return T('pol.std', 'Free cancellation until {h} h before start; after that {p}% refund.', { h: pol.fullUntilH, p: pol.thenPct });
  };

  /* ---------------- Customer Support Agent ---------------- */
  var SUP = {
    human: ['human', 'agent', 'person', 'complaint', 'इंसान', 'एजेंट', 'शिकायत', 'बात करा', 'व्यक्ति', 'माणूस', 'মানুষ', 'অভিযোগ', 'மனிதர்', 'புகார்', 'மனித', 'మనిషి', 'ఫిర్యాదు', 'ಮನುಷ್ಯ', 'ದೂರು', 'മനുഷ്യ', 'പരാതി', 'માણસ', 'ફરિયાદ', 'ਇਨਸਾਨ', 'ਸ਼ਿਕਾਇਤ', 'ମଣିଷ', 'ଅଭିଯୋଗ'],
    refund: ['refund', 'money back', 'रिफंड', 'रिफ़ंड', 'पैसा वापस', 'पैसे वापस', 'परतावा', 'রিফান্ড', 'ফেরত', 'ரீஃபண்ட்', 'திரும்ப', 'பணம்', 'రీఫండ్', 'వాపసు', 'ರೀಫಂಡ್', 'ಮರುಪಾವತಿ', 'റീഫണ്ട്', 'തിരികെ', 'રિફંડ', 'પૈસા પાછા', 'ਰਿਫੰਡ', 'ਵਾਪਸ', 'ରିଫଣ୍ଡ', 'ଫେରସ୍ତ'],
    cancel: ['cancel', 'कैंसल', 'रद्द', 'বাতিল', 'ரத்து', 'రద్దు', 'ರದ್ದು', 'റദ്ദ', 'રદ', 'ਰੱਦ', 'ବାତିଲ'],
    checkin: ['check-in', 'checkin', 'check in', 'early', 'cloak', 'luggage', 'चेक-इन', 'चेक इन', 'सामान', 'क्लोकरूम', 'চেক-ইন', 'லக்கேஜ்', 'செக்-இன்', 'చెక్-ఇన్', 'ಚೆಕ್-ಇನ್', 'ചെക്ക്-ഇൻ', 'ચેક-ઇન', 'ਚੈੱਕ-ਇਨ', 'ଚେକ୍-ଇନ୍'],
    pnr: ['pnr', 'पीएनआर', 'train', 'ट्रेन', 'गाड़ी', 'ট্রেন', 'ரயில்', 'రైలు', 'ರೈಲು', 'ട്രെയിൻ', 'ટ્રેન', 'ਟ੍ਰੇਨ', 'ଟ୍ରେନ', 'coach', 'seat'],
    status: ['status', 'booking', 'स्टेटस', 'स्थिति', 'स्थिती', 'बुकिंग', 'অবস্থা', 'বুকিং', 'நிலை', 'முன்பதிவு', 'బుకింగ్', 'స్థితి', 'ಬುಕಿಂಗ್', 'ಸ್ಥಿತಿ', 'ബുക്കിംഗ്', 'സ്ഥിതി', 'બુકિંગ', 'સ્થિતિ', 'ਬੁਕਿੰਗ', 'ਸਥਿਤੀ', 'ବୁକିଂ', 'ସ୍ଥିତି']
  };
  OT.agents.supportIntent = function (text) {
    var t = String(text || '').toLowerCase();
    var order = ['human', 'refund', 'cancel', 'checkin', 'pnr', 'status'];
    for (var i = 0; i < order.length; i++) if (has(t, SUP[order[i]])) return order[i];
    return null;
  };
  function cite(topic) { return D().policies.filter(function (p) { return p.topic === topic; }).map(function (p) { return { id: p.id, title: p.title }; }); }
  OT.agents.createTicket = function (o) {
    var id = 'SUP-' + Math.random().toString(36).slice(2, 7).toUpperCase();
    var tk = { id: id, createdAt: new Date().toISOString(), lang: o.lang || (OT.i18n ? OT.i18n.lang() : 'en'), category: o.category || 'general',
      subject: o.subject || 'Assistant escalation', message: o.message || '', bookingRef: o.bookingRef || null, status: 'open', source: o.source || 'assistant',
      user: (OT.store.get('user') || {}).email || 'guest', priority: o.priority || 'normal', slaHours: 2 };
    OT.store.update('tickets', function (l) { return (l || []).concat([tk]); });
    return tk;
  };

  OT.agents.support = function (text, opts) {
    opts = opts || {};
    var lang = opts.lang || (OT.i18n ? OT.i18n.lang() : 'en');
    var intent = opts.intent || OT.agents.supportIntent(text);
    var j = OT.store.get('journey'), bookings = OT.store.get('bookings', []) || [];
    var tr = j && j.train;
    var mine = bookings.filter(function (b) { return !j || b.journeyId === j.id; });
    var live = mine.filter(function (b) { return b.status === 'confirmed'; });
    var cancelled = mine.filter(function (b) { return b.cancellation; });
    var ticket = intent === 'human' ? OT.agents.createTicket({ lang: lang, category: 'escalation', subject: 'Traveller asked for a human', message: text }) : null;
    var usedKey = null;

    /* Build the answer in a given language (so we can show the English original next to it). */
    function make(LG) {
      function TL(k, fb, v) { if (LG === lang && !usedKey) usedKey = k; return OT.i18n ? OT.i18n.tIn(LG, k, fb, v) : fb; }
      function S(k, fb) { return OT.i18n ? OT.i18n.tIn(LG, k, fb) : fb; }
      var st = tr ? S('trainStatus.' + tr.status, tr.status) : '';
      var r = { actions: [], citations: [], text: null };
      if (intent === 'human') {
        r.text = TL('support.escalated', 'I have created ticket {ticket} for a human agent. They will reply in {lang} within 2 hours (sample SLA).', { ticket: ticket.id, lang: OT.lang ? OT.lang.info(lang).native : lang });
        r.citations = cite('human');
      } else if (!j && intent) {
        r.text = TL('support.noJourney', 'I could not find a trip yet. Plan a trip first, or import the sample PNR on the home page.');
        r.actions.push({ label: S('nav.plan', 'Plan trip'), route: 'home' });
      } else if (intent === 'refund') {
        r.citations = cite('refund');
        if (cancelled.length) {
          var c = cancelled[cancelled.length - 1];
          r.text = TL('support.refund', 'Refund of {amount} for {title} ({ref}) is {rstatus}. It goes back to your original payment method by {eta} (Partner Bank, sample).', {
            amount: OT.inr(c.cancellation.refundAmount), title: c.title, ref: c.ref, rstatus: S('status.' + (c.cancellation.status === 'refunded' ? 'refunded' : 'processing'), c.cancellation.status), eta: fmtDate(c.cancellation.eta) });
          r.actions.push({ label: S('asst.trackRefund', 'Track refund'), route: 'bookings' });
        } else {
          r.text = TL('support.refundNone', 'No refund is in progress. If you cancel inside the free window, the full amount goes back to your original payment method in 5–7 working days. Train ticket refunds happen on IRCTC under railway rules.');
        }
        r.critical = true;
      } else if (intent === 'cancel') {
        r.citations = cite('cancel');
        if (live.length) {
          var b = live[0], rf = OT.agents.refundFor(b);
          r.text = TL('support.cancel', 'You can cancel {title} ({ref}). Policy: {policy} Estimated refund: {amount}. I will not cancel anything without your confirmation.', {
            title: b.title, ref: b.ref, policy: OT.agents.policyText(rf.policy, LG), amount: rf.amount == null ? S('common.unavailable', 'Unavailable') : OT.inr(rf.amount) });
          r.actions.push({ label: S('asst.openBookings', 'Review & cancel in Bookings'), route: 'bookings' });
        } else {
          r.text = TL('support.cancelNone', 'There is no confirmed OneTrip booking to cancel yet. Your train ticket is cancelled on IRCTC, not here.');
        }
        r.critical = true;
      } else if (intent === 'checkin') {
        r.citations = cite('checkin');
        var hx = (j.items || []).filter(function (i) { return i.type === 'hotel' && i.status !== 'cancelled'; })[0];
        var hci = hx && D().get(hx.refId) ? D().get(hx.refId).checkIn : '14:00';
        r.text = TL('support.checkin', 'Your train arrives at {arr}; standard check-in is {checkin}. Early check-in needs hotel confirmation. Meanwhile the station cloakroom costs {fee} per bag (sample).', { arr: tr.arr, checkin: hci, fee: OT.inr(30) });
        r.actions.push({ label: S('nav.journey', 'My Journey'), route: 'journey' });
      } else if (intent === 'pnr') {
        r.citations = cite('train');
        r.text = TL('support.pnr', 'PNR {pnr}: train {train} {name}, {from} {dep} → {to} {arr} on {date}, coach {coach}, seats {seats}, status {status} (sample, not live).', {
          pnr: j.pnr || '—', train: tr.no, name: tr.name, from: tr.from, dep: tr.dep, to: tr.to, arr: tr.arr, date: fmtDate(tr.date), coach: tr.coach, seats: tr.seats.join(', '), status: st });
      } else if (intent === 'status') {
        if (mine.length) {
          var list = mine.map(function (b) { return b.title + ' (' + b.ref + '): ' + S('status.' + b.status, b.status); }).join('; ');
          r.text = TL('support.status', 'You have {n} OneTrip booking(s): {list}. Your train {train} (PNR {pnr}) is {tstatus} (sample).', { n: mine.length, list: list, train: tr.no, pnr: j.pnr || '—', tstatus: st });
        } else {
          r.text = TL('support.statusNone', 'No OneTrip bookings yet. Your train {train} (PNR {pnr}) is {tstatus} (sample). Add a hotel or cab from Plan trip.', { train: tr.no, pnr: j.pnr || '—', tstatus: st });
        }
        r.actions.push({ label: S('nav.bookings', 'Bookings & refunds'), route: 'bookings' });
      }
      return r;
    }

    var a = make(lang);
    if (a.text) {
      var en = lang === 'en' ? a : make('en');
      var covered = lang === 'en' || !usedKey || (OT.i18n && OT.i18n.has(usedKey, lang));
      return Promise.resolve(Object.assign({ intent: intent, lang: lang, engine: 'rules', escalated: !!ticket, ticket: ticket,
        confidence: covered ? 0.94 : 0.5, fellBack: !covered }, a, { textEn: en.text }));
    }

    // Not matched by rules: try Gemini (grounded on the user's own data), else low-confidence fallback + escalation offer.
    var fbText = OT.i18n ? OT.i18n.tIn(lang, 'support.fallback', 'I am not fully sure I understood. I can help with booking status, cancellation, refunds and PNR. Shall I connect you to a human agent?') : '';
    var fallback = {
      intent: null, lang: lang, confidence: 0.35, engine: 'rules', citations: [], escalateOffer: true, text: fbText,
      textEn: OT.i18n ? OT.i18n.tIn('en', 'support.fallback', 'I am not fully sure I understood. I can help with booking status, cancellation, refunds and PNR. Shall I connect you to a human agent?') : fbText,
      actions: [{ label: T('asst.human', 'Talk to a human'), escalate: true }]
    };
    if (!(OT.gemini && OT.gemini.available())) return Promise.resolve(fallback);
    var ctx = {
      trip: j ? { pnr: j.pnr, train: tr, passengers: j.passengers, items: (j.items || []).map(function (i) { return { title: i.title, type: i.type, price: i.price, when: i.when, status: i.status }; }) } : null,
      bookings: mine.map(function (b) { return { ref: b.ref, title: b.title, amount: b.amount, status: b.status, cancellation: b.cancellation || null }; }),
      policies: D().policies.map(function (p) { return p.title + ': ' + p.text; })
    };
    var lname = OT.lang ? OT.lang.info(lang).name : lang;
    var prompt = 'Traveller message (language: ' + lname + '):\n' + text + '\n\nTrip and booking data (sample, the only source of truth):\n' + JSON.stringify(ctx) +
      '\n\nReply in ' + lname + ' in at most 3 short sentences. Use ONLY the data above; never invent prices, times, availability or policies. ' +
      'If the data does not answer the question, say so and offer a human agent. Keep PNR, train numbers, ₹ amounts, dates and booking refs exactly as written.';
    return OT.gemini.generate(prompt, { system: 'You are the IRCTC OneTrip Customer Support Agent in an academic prototype with simulated data.', timeoutMs: 15000, temperature: 0.2 })
      .then(function (out) {
        var txt = String(out).trim();
        // guardrail: every ₹ amount in the reply must exist in the data we sent
        var ctxStr = JSON.stringify(ctx);
        var amounts = (txt.match(/₹\s?[\d,]+/g) || []).map(function (x) { return x.replace(/[₹,\s]/g, ''); });
        var invented = amounts.filter(function (a) { return ctxStr.indexOf(a) < 0; });
        if (invented.length) return fallback;
        return { intent: 'llm', lang: lang, confidence: 0.8, engine: 'gemini', text: txt, citations: cite('cancel').concat(cite('refund')).slice(0, 2),
          actions: [{ label: T('asst.human', 'Talk to a human'), escalate: true }] };
      })
      .catch(function () { return fallback; });
  };

  /* ---------------- Partner Agent (used by Builder B's enquiries inbox) ---------------- */
  OT.agents.partnerDraftReply = function (enq) {
    enq = enq || {};
    var msg = String(enq.message || enq.text || enq.question || '');
    var lang = enq.lang || (OT.lang ? OT.lang.detect(msg).code : 'en');
    var guest = enq.guestName || enq.guest || enq.name || 'Guest';
    var listing = enq.listing || enq.hotel || enq.property || 'our property';
    var date = enq.checkIn || enq.date || '';
    var pax = enq.pax || enq.guests || '';
    var t = msg.toLowerCase();
    var topic = /early|जल्दी|अर्ली|चेक-इन|check-in|checkin|সকাল|காலை/.test(t) ? 'early' : /price|rate|discount|दाम|कीमत|किराया|দাম|விலை/.test(t) ? 'price' :
      /veg|शाकाहारी|जैन|jain|নিরামিষ|சைவ/.test(t) ? 'veg' : /park|पार्किंग/.test(t) ? 'parking' : 'avail';
    var en = {
      early: 'Namaste {guest}, thank you for choosing {listing}. Early check-in on {date} depends on the previous night\'s occupancy; we will confirm by 9 PM the day before. Meanwhile you are welcome to leave luggage at our desk free of charge.',
      price: 'Namaste {guest}, thank you for your enquiry. The rate shown on OneTrip is our current all-inclusive price (GST included); we do not add any hidden fees at check-in.',
      veg: 'Namaste {guest}, yes, our kitchen serves pure-veg meals and can prepare Jain food on request. Please mention it at booking.',
      parking: 'Namaste {guest}, free parking is available for one car per room, subject to space.',
      avail: 'Namaste {guest}, thank you for your enquiry about {listing}{forDate}. Rooms are available as per our OneTrip calendar{forPax}. You can book directly on OneTrip; free cancellation applies as listed.'
    }[topic];
    var hi = {
      early: 'नमस्ते {guest}, {listing} चुनने के लिए धन्यवाद। {date} को अर्ली चेक-इन पिछली रात की बुकिंग पर निर्भर है; हम एक दिन पहले रात 9 बजे तक पुष्टि करेंगे। तब तक आप सामान हमारे रिसेप्शन पर निःशुल्क रख सकते हैं।',
      price: 'नमस्ते {guest}, आपकी पूछताछ के लिए धन्यवाद। OneTrip पर दिखाया गया रेट GST सहित पूरा मूल्य है; चेक-इन पर कोई छिपा शुल्क नहीं।',
      veg: 'नमस्ते {guest}, हाँ, हमारी रसोई में शुद्ध शाकाहारी भोजन मिलता है और अनुरोध पर जैन भोजन भी।',
      parking: 'नमस्ते {guest}, प्रति कमरा एक कार की निःशुल्क पार्किंग उपलब्ध है (जगह के अनुसार)।',
      avail: 'नमस्ते {guest}, {listing} के बारे में पूछताछ के लिए धन्यवाद। हमारे OneTrip कैलेंडर के अनुसार कमरे उपलब्ध हैं। आप सीधे OneTrip पर बुक कर सकते हैं।'
    }[topic];
    function fill(s, hiText) {
      return s.replace(/\{guest\}/g, guest).replace(/\{listing\}/g, listing).replace(/\{date\}/g, date || (hiText ? 'आपकी तारीख' : 'your date'))
        .replace(/\{forDate\}/g, date ? ' for ' + date : '').replace(/\{forPax\}/g, pax ? ' for ' + pax + ' guests' : '');
    }
    var textEn = fill(en);
    var out = { text: lang === 'hi' ? fill(hi, true) : textEn, textEn: textEn, lang: lang === 'hi' ? 'hi' : 'en', topic: topic, confidence: lang === 'hi' || lang === 'en' ? 0.9 : 0.6,
      agent: 'Partner Agent', note: 'Draft by Partner Agent (simulated). Review before sending; it never promises prices or availability not in your listing.' };
    if (lang !== 'hi' && lang !== 'en') out.note += ' Reply drafted in English: ' + (OT.lang ? OT.lang.info(lang).name : lang) + ' drafting needs live NMT.';
    out.toString = function () { return out.text; };
    return out;
  };

  /* ---------------- Command parser (v1.1): voice/text in English, Hinglish and Indian languages ----------------
   * OT.agents.parseCommand(text) -> {intent:'train'|'hotel'|'cab'|'food'|'sight'|'status'|'refund'|'cancel'|'pnr'|null,
   *                                  from, to, date, dateSaid, cls, pax, missing[], heard,
   *                                  round (bool), ret (YYYY-MM-DD | null)}   v1.2.1: "… on Friday and back on Sunday",
   *                                  "return on 28 Nov", "round trip", Hinglish "aur Sunday ko wapas", Hindi "वापसी रविवार"
   */
  var TRAIN_KW = ['train', 'trains', 'rail', 'ticket', 'tickets', 'ट्रेन', 'रेल', 'रेलगाड़ी', 'गाड़ी', 'गाडी', 'टिकट', 'ரயில்', 'டிக்கெட்', 'ট্রেন', 'টিকিট', 'రైలు', 'ట్రైన్', 'టికెట్', 'ರೈಲು', 'ಟಿಕೆಟ್', 'ട്രെയിൻ', 'ടിക്കറ്റ്', 'ટ્રેન', 'ટિકિટ', 'ਟ੍ਰੇਨ', 'ਰੇਲ', 'ਟਿਕਟ', 'ଟ୍ରେନ', 'ଟିକେଟ'];
  var FROM_KW = ['from', ' se ', 'से', 'இலிருந்து', 'லிருந்து', 'থেকে', 'నుండి', 'ನಿಂದ', 'ಇಂದ', 'നിന്ന്', 'થી', 'ਤੋਂ', 'ରୁ', 'पासून', 'हून'];
  var MON3 = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  var MON_HI = { 'जनवरी': 0, 'फ़रवरी': 1, 'फरवरी': 1, 'मार्च': 2, 'अप्रैल': 3, 'मई': 4, 'जून': 5, 'जुलाई': 6, 'अगस्त': 7, 'सितंबर': 8, 'सितम्बर': 8, 'अक्टूबर': 9, 'नवंबर': 10, 'नवम्बर': 10, 'दिसंबर': 11, 'दिसम्बर': 11 };
  var WEEK = [
    ['sunday', 'sun', 'ravivar', 'रविवार', 'इतवार', 'ஞாயிறு', 'রবিবার', 'ఆదివారం', 'ಭಾನುವಾರ', 'ഞായർ', 'રવિવાર', 'ਐਤਵਾਰ', 'ରବିବାର'],
    ['monday', 'mon', 'somvar', 'सोमवार', 'திங்கள்', 'সোমবার', 'సోమవారం', 'ಸೋಮವಾರ', 'തിങ്കൾ', 'સોમવાર', 'ਸੋਮਵਾਰ', 'ସୋମବାର'],
    ['tuesday', 'tue', 'mangalvar', 'मंगलवार', 'செவ்வாய்', 'মঙ্গলবার', 'మంగళవారం', 'ಮಂಗಳವಾರ', 'ചൊവ്വ', 'મંગળવાર', 'ਮੰਗਲਵਾਰ', 'ମଙ୍ଗଳବାର'],
    ['wednesday', 'wed', 'budhvar', 'बुधवार', 'புதன்', 'বুধবার', 'బుధవారం', 'ಬುಧವಾರ', 'ബുധൻ', 'બુધવાર', 'ਬੁੱਧਵਾਰ', 'ବୁଧବାର'],
    ['thursday', 'thu', 'guruvar', 'गुरुवार', 'வியாழன்', 'বৃহস্পতিবার', 'గురువారం', 'ಗುರುವಾರ', 'വ്യാഴം', 'ગુરુવાર', 'ਵੀਰਵਾਰ', 'ଗୁରୁବାର'],
    ['friday', 'fri', 'shukravar', 'शुक्रवार', 'வெள்ளி', 'শুক্রবার', 'శుక్రవారం', 'ಶುಕ್ರವಾರ', 'വെള്ളി', 'શુક્રવાર', 'ਸ਼ੁੱਕਰਵਾਰ', 'ଶୁକ୍ରବାର'],
    ['saturday', 'sat', 'shanivar', 'शनिवार', 'சனி', 'শনিবার', 'శనివారం', 'ಶನಿವಾರ', 'ശനി', 'શનિવાર', 'ਸ਼ਨੀਵਾਰ', 'ଶନିବାର']
  ];
  var REL = [[0, ['today', 'tonight', 'aaj', 'आज', 'இன்று', 'আজ', 'ఈరోజు', 'ಇಂದು', 'ഇന്ന്', 'આજે', 'ਅੱਜ', 'ଆଜି']],
    [2, ['day after tomorrow', 'parso', 'parson', 'परसों', 'நாளை மறுநாள்', 'পরশু', 'ఎల్లుండి', 'ನಾಡಿದ್ದು', 'മറ്റന്നാൾ', 'પરમ દિવસે', 'ਪਰਸੋਂ', 'ପରଦିନ']],
    [1, ['tomorrow', 'tmrw', 'kal', 'कल', 'उद्या', 'நாளை', 'আগামীকাল', 'কাল', 'రేపు', 'ನಾಳೆ', 'നാളെ', 'આવતીકાલે', 'કાલે', 'ਕੱਲ੍ਹ', 'ଆସନ୍ତାକାଲି', 'କାଲି']]];
  var HOLI = [['christmas', '12-25'], ['क्रिसमस', '12-25'], ['xmas', '12-25'], ['republic day', '01-26'], ['गणतंत्र दिवस', '01-26'], ['independence day', '08-15'], ['स्वतंत्रता दिवस', '08-15'], ['gandhi jayanti', '10-02'], ['गांधी जयंती', '10-02']];
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymdOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function futureDate(m, d) { var t = new Date(); t.setHours(0, 0, 0, 0); var x = new Date(t.getFullYear(), m, d); if (x < t) x = new Date(t.getFullYear() + 1, m, d); return ymdOf(x); }
  function wordIn(t, w) { return /^[a-z ]+$/.test(w) ? new RegExp('(^|[^a-z])' + w + '([^a-z]|$)').test(t) : t.indexOf(w) >= 0; }
  function parseDate(t, baseYmd) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var base = baseYmd ? (function () { var p = String(baseYmd).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); })() : null;
    var later = t.match(/(?:after\s+)?(\d{1,2})\s*(?:days?|din|दिन)\s*(?:later|after|baad|बाद)?/);
    if (base && later && /later|after|baad|बाद/.test(t)) { var bl = new Date(base); bl.setDate(bl.getDate() + (+later[1])); return ymdOf(bl); }
    var m = t.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/);
    if (m) return m[0];
    m = t.match(/\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b/);
    if (m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + pad2(+m[2]) + '-' + pad2(+m[1]) : futureDate(+m[2] - 1, +m[1]);
    m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/) || null;
    if (m) return futureDate(MON3[m[2]], +m[1]);
    m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (m) return futureDate(MON3[m[1]], +m[2]);
    for (var k in MON_HI) { var mm = t.match(new RegExp('(\\d{1,2})\\s*' + k)); if (mm) return futureDate(MON_HI[k], +mm[1]); }
    for (var h = 0; h < HOLI.length; h++) if (wordIn(t, HOLI[h][0])) { var p = HOLI[h][1].split('-'); return futureDate(+p[0] - 1, +p[1]); }
    if (/guru nanak|gurpurab|गुरु नानक|गुरपुरब/.test(t) && OT.data.demand) { var g = OT.data.demand.holidays().filter(function (x) { return /Guru Nanak/.test(x.name) && x.date > ymdOf(today); })[0]; if (g) return g.date; }
    for (var r = 0; r < REL.length; r++) for (var j = 0; j < REL[r][1].length; j++) if (wordIn(t, REL[r][1][j])) { var dd = new Date(today); dd.setDate(dd.getDate() + REL[r][0]); return ymdOf(dd); }
    if (/\b(this |coming )?weekend\b|वीकेंड|सप्ताहांत/.test(t)) { var s = new Date(today); s.setDate(s.getDate() + ((6 - s.getDay() + 7) % 7 || 7)); return ymdOf(s); }
    for (var w = 0; w < WEEK.length; w++) for (var q = 0; q < WEEK[w].length; q++) {
      if (wordIn(t, WEEK[w][q])) {
        var x = new Date(base || today), diff = (w - x.getDay() + 7) % 7;
        if (diff === 0 || /next/.test(t)) diff = diff || 7;
        x.setDate(x.getDate() + diff); return ymdOf(x);
      }
    }
    return null;
  }
  /* v1.2.1: split "outward … and back on Sunday" into the outward text and the return part. */
  var RET_ROUND = ['round trip', 'round-trip', 'roundtrip', 'return ticket', 'return tickets', 'return journey', 'both ways', 'two way', 'two-way', 'up and down', 'aana jaana', 'aana-jaana', 'आना-जाना', 'आना जाना', 'राउंड ट्रिप', 'दोनों तरफ'];
  var RET_BACK = ['coming back', 'come back', 'back', 'returning', 'return', 'wapas', 'vapas', 'wapis', 'wapsi', 'vapsi', 'वापसी', 'वापस', 'लौटना', 'लौटकर', 'लौट', 'परत', 'ফিরে', 'ফেরা'];
  var RET_CONJ = [' and ', ' aur ', ' और ', ' then ', ' phir ', ' फिर ', ' आणि ', ' এবং ', ' ও '];
  function findMarker(t, list) {
    var best = null;
    list.forEach(function (m) {
      var re = /^[a-z -]+$/.test(m) ? new RegExp('(^|[^a-z])' + m.replace(/[- ]/g, '[- ]?') + '(?![a-z])') : null;
      var i = -1, len = m.length;
      if (re) { var mm = re.exec(t); if (mm) { i = mm.index + mm[1].length; len = mm[0].length - mm[1].length; } } else i = t.indexOf(m);
      if (i >= 0 && (!best || i < best.i || (i === best.i && len > best.len))) best = { i: i, len: len, m: m };
    });
    return best;
  }
  function splitReturn(t) {
    var round = findMarker(t, RET_ROUND), back = findMarker(t, RET_BACK);
    if (round && back && back.i >= round.i && back.i < round.i + round.len) back = null;   // "return ticket" is one marker
    if (!round && !back) return { main: t, ret: '', round: false };
    if (!back) return { main: t.slice(0, round.i) + ' ' + t.slice(round.i + round.len), ret: '', round: true };
    var before = t.slice(0, back.i), after = t.slice(back.i + back.len);
    if (round && round.i > back.i) after = after.replace(t.slice(round.i, round.i + round.len), ' ');
    else if (round) before = before.slice(0, round.i) + ' ' + before.slice(round.i + round.len);
    if (parseDate(after)) return { main: before, ret: after, round: true };
    var ci = -1, cl = 0;
    RET_CONJ.forEach(function (c) { var k = before.lastIndexOf(c); if (k > ci) { ci = k; cl = c.length; } });
    if (ci >= 0) return { main: before.slice(0, ci) + ' ' + after, ret: before.slice(ci + cl), round: true };
    return { main: before + ' ' + after, ret: '', round: true };
  }
  OT.agents.splitReturn = splitReturn;
  function parseCls(t) {
    var m = t.match(/\b(1a|2a|3a|3e|sl|cc|ec)\b/);
    if (m) return m[1].toUpperCase();
    if (/first ac|1st ac|फर्स्ट एसी/.test(t)) return '1A';
    if (/second ac|2nd ac|2 tier|two tier|सेकंड एसी/.test(t)) return '2A';
    if (/third ac|3rd ac|3 tier|three tier|थर्ड एसी/.test(t)) return '3A';
    if (/sleeper|स्लीपर/.test(t)) return 'SL';
    if (/executive/.test(t)) return 'EC';
    if (/chair car|चेयर कार/.test(t)) return 'CC';
    return null;
  }
  function parsePax(t) {
    var m = t.match(/(\d)\s*(people|persons|person|passengers|pax|adults|travellers|travelers|tickets|seats|log|लोग|यात्री|जन|பேர்|জন)/);
    if (m) return +m[1];
    m = t.match(/family of (\d)/); if (m) return +m[1];
    var words = { 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'do': 2, 'teen': 3, 'char': 4, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5 };
    for (var w in words) if (new RegExp('(^|[^a-zऀ-ॿ])' + w + '\\s+(people|persons|passengers|log|लोग|यात्री|tickets)').test(t)) return words[w];
    return null;
  }
  OT.agents.parseCommand = function (text) {
    var raw = String(text || '').trim();
    var t = (OT.lang ? OT.lang.normDigits(raw) : raw).toLowerCase().replace(/[।?!,]/g, ' ');
    var R = OT.data.rail;
    var sr = splitReturn(t), full = t;
    t = sr.main.replace(/\s+/g, ' ').trim();
    var ms = R ? R.mentions(t) : [];
    var out = { heard: raw, intent: null, from: null, to: null, date: null, dateSaid: false, cls: parseCls(t), pax: parsePax(t), mentions: ms.map(function (m) { return m.code; }), missing: [] };
    var fromIdx = -1;
    FROM_KW.forEach(function (k) { var i = (' ' + t + ' ').indexOf(k); if (i >= 0 && (fromIdx < 0 || i < fromIdx)) fromIdx = i; });
    if (ms.length >= 2) {
      var a = ms[0], b = ms[1];
      out.from = a.code; out.to = b.code;
      // "to Mumbai from Chandigarh"
      var toEn = t.search(/(^|[^a-z])to\s/), fromEn = t.search(/(^|[^a-z])from\s/);
      if (fromEn >= 0 && toEn >= 0 && toEn < fromEn && b.index > fromEn) { out.from = b.code; out.to = a.code; }
    } else if (ms.length === 1) {
      var m0 = ms[0], after = t.slice(m0.index + m0.len, m0.index + m0.len + 14), before = t.slice(Math.max(0, m0.index - 6), m0.index);
      var isFrom = /from\s*$/.test(before) || FROM_KW.some(function (k) { k = k.trim(); return k && k !== 'from' && after.trim().indexOf(k) === 0; }) || /^\s*se\b/.test(after);
      if (isFrom) out.from = m0.code; else out.to = m0.code;
    }
    var d = parseDate(t);
    if (d) { out.date = d; out.dateSaid = true; }
    var kw = function (list) { return has(full, list); };
    var support = OT.agents.supportIntent(full);
    var strongTrain = /\btrains?\b|\btickets?\b|ट्रेन|टिकट|ট্রেন|టికెట్|ట్రైన్|ಟಿಕೆಟ್|ട്രെയിൻ|ટ્રેન|ਟ੍ਰੇਨ|ଟ୍ରେନ/.test(full) || (/\bbook\b|बुक/.test(t) && ms.length >= 2);
    if (kw(KW.hotel) && !strongTrain) out.intent = 'hotel';
    else if (strongTrain || kw(TRAIN_KW) && !kw(KW.hotel) || (/\bbook\b|बुक/.test(t) && ms.length >= 1) || (ms.length >= 2 && !kw(KW.cab))) out.intent = 'train';
    else if (kw(KW.hotel)) out.intent = 'hotel';
    else if (kw(KW.cab)) out.intent = 'cab';
    else if (kw(KW.food)) out.intent = 'food';
    else if (kw(KW.sight) && ms.length) out.intent = 'sight';
    if (!out.intent && support && ['refund', 'cancel', 'status', 'pnr', 'human', 'checkin'].indexOf(support) >= 0) out.intent = support === 'checkin' ? 'status' : support;
    if (!out.intent && ms.length === 1) out.intent = 'hotel';
    if (out.intent === 'train' && sr.round) {
      var base = out.date || ymdOf(new Date(Date.now() + 86400000));
      var rd = sr.ret ? parseDate(sr.ret.replace(/\s+/g, ' ').trim(), base) : null;
      out.round = true;
      // a return before the outward date, or one that only parsed by rolling into next year ("20 Nov … return on 2 Nov"), is ignored
      if (rd && (rd < base || Date.parse(rd) - Date.parse(base) > 180 * 86400000)) { out.retBad = rd; rd = null; }
      out.ret = rd;
    }
    if (out.intent === 'train') {
      var u = OT.store.get('user');
      if (!out.from && u && u.homeCity && u.homeCity !== out.to) { out.from = u.homeCity; out.fromAssumed = true; }
      if (!out.to) out.missing.push('to');
      if (!out.from) out.missing.push('from');
    }
    if ((out.intent === 'hotel' || out.intent === 'cab' || out.intent === 'food' || out.intent === 'sight') && !out.to) out.to = out.from, out.from = null;
    if ((out.intent === 'hotel' || out.intent === 'cab' || out.intent === 'food' || out.intent === 'sight') && !out.to) out.missing.push('city');
    if (!out.intent) out.missing.push('intent');
    return out;
  };
})();
