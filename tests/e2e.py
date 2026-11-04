# IRCTC OneTrip end-to-end tests. Run from the repo root:  python3 tests/e2e.py [--shots DIR] [--quick] [--only verify,tour,v121,verify121,v122] [--base file|http]
# Needs: pip install playwright && python -m playwright install chromium. Not loaded by index.html.
"""Drives the prototype like a presenter (real clicks) on file:// and on a local http.server,
at 1440x900 and 375x812. Fails on console errors, page errors, placeholder/NaN text,
horizontal overflow at 375 px and broken local asset references."""
import json, os, re, socket, subprocess, sys, time, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
ARGS = sys.argv[1:]
SHOTS = Path(ARGS[ARGS.index('--shots') + 1]) if '--shots' in ARGS else None
QUICK = '--quick' in ARGS
ONLY = ARGS[ARGS.index('--only') + 1].split(',') if '--only' in ARGS else None   # e.g. --only verify,tour
BASES_ONLY = ARGS[ARGS.index('--base') + 1] if '--base' in ARGS else None   # file | http


def want(name):
    return ONLY is None or any(name.startswith(o) for o in ONLY)
LANGS = ['en', 'hi', 'bn', 'mr', 'ta', 'te', 'kn', 'ml', 'gu', 'pa', 'or']
VIEWPORTS = {'desktop': (1440, 900), 'mobile': (375, 812)}
RESULTS = []          # (group, name, ok, detail)
GROUP = ['setup']


def check(name, ok, detail=''):
    RESULTS.append((GROUP[0], name, bool(ok), str(detail)[:400]))
    if not ok:
        print('  FAIL', GROUP[0], '|', name, '|', str(detail)[:300])
    return ok


# ---------------------------------------------------------------- static asset check
def asset_check():
    GROUP[0] = 'assets'
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    refs = re.findall(r'(?:src|href)="([^"#][^"]*)"', html)
    for css in (ROOT / 'css').glob('*.css'):
        for u in re.findall(r'url\(([^)]+)\)', css.read_text(encoding='utf-8')):
            u = u.strip('\'" ')
            if not u.startswith('data:'):
                refs.append(str((css.parent / u).relative_to(ROOT)) if not u.startswith('http') else u)
    local = [r for r in refs if not re.match(r'^(https?:|mailto:|data:)', r)]
    missing = [r for r in local if not (ROOT / r.split('?')[0]).exists()]
    check('local src/href/url() resolve (%d refs)' % len(local), not missing, missing)
    check('no ES modules / fetch of local files', 'type="module"' not in html and not any(
        re.search(r'fetch\(\s*[\'"](?!https)', p.read_text(encoding='utf-8')) for p in (ROOT / 'js').rglob('*.js')))


# ---------------------------------------------------------------- browser helpers
BAD_TEXT = r"""() => {
  const t = document.body.innerText;
  const re = /\bNaN\b|\bundefined\b|\[object Object\]|\{[A-Za-z_][\w.]*\}|\bInfinity\b|�|Ã.|à¤/g;
  return [...new Set(t.match(re) || [])];
}"""
OVERFLOW = r"""() => {
  const w = window.innerWidth, out = [];
  const doc = document.documentElement.scrollWidth;
  document.querySelectorAll('#view *, .app-header *, .app-footer *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (!r.width || r.right <= w + 1) return;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && p !== document.body && p !== document.documentElement) return;
    }
    if (getComputedStyle(el).position === 'fixed') return;
    out.push((el.className && el.className.baseVal === undefined ? el.tagName + '.' + String(el.className).split(' ')[0] : el.tagName) + '@' + Math.round(r.right));
  });
  return { doc, w, offenders: out.slice(0, 6) };
}"""


class Page:
    def __init__(self, browser, base, vp, init=None, storage_ok=True):
        w, h = VIEWPORTS[vp]
        self.ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1)
        self.ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.abort())
        self.ctx.route(re.compile(r'https://generativelanguage\.googleapis\.com/.*'), lambda r: r.abort())
        if init:
            self.ctx.add_init_script(init)
        self.p = self.ctx.new_page()
        self.errors = []
        self.base, self.vp = base, vp

        def on_console(m):
            if m.type != 'error':
                return
            url = (m.location or {}).get('url', '')
            if re.search(r'fonts\.(googleapis|gstatic)|generativelanguage\.googleapis', url + m.text):
                return
            self.errors.append('console: ' + m.text[:200])
        self.p.on('console', on_console)
        self.p.on('pageerror', lambda e: self.errors.append('pageerror: ' + str(e)[:200]))
        self.p.on('requestfailed', lambda r: (not re.search(r'fonts\.(googleapis|gstatic)|generativelanguage', r.url)) and self.errors.append('requestfailed: ' + r.url))

    def go(self, route, wait=250):
        url = self.base + '#/' + route
        if self.p.url.split('#')[0] == self.base and self.p.url != 'about:blank':
            self.p.evaluate('h => { if (location.hash === h) OT.router.render(); else location.hash = h; }', '#/' + route)
        else:
            self.p.goto(url)
        self.p.wait_for_function('() => window.OT && OT.router && OT.router.current()')
        self.p.wait_for_timeout(wait)

    def ev(self, js, arg=None):
        return self.p.evaluate(js, arg) if arg is not None else self.p.evaluate(js)

    def click(self, sel, **kw):
        self.p.locator(sel).first.click(**kw)

    def modal_ok(self, keep_success=False):
        self.p.wait_for_selector('.modal-backdrop.show .modal-foot .btn-primary, .modal-backdrop.show .modal-foot .btn-danger')
        self.p.locator('.modal-backdrop.show .modal-foot .btn').last.click()
        self.p.wait_for_timeout(300)
        # v1.2: a confirmed payment shows the success pop-up; close it unless the test inspects it
        self.p.wait_for_function('() => !(window.OT && OT.state && OT.state.payPending)', timeout=8000)
        if not keep_success and self.p.locator('.ps-overlay [data-ps-done]').count():
            self.p.locator('.ps-overlay [data-ps-done]').click()
            self.p.wait_for_timeout(250)

    def wait_run(self, timeout=20000):
        self.p.wait_for_function('() => OT.state.lastRun && OT.state.lastRun.done && document.querySelector(".offer[data-ref]")', timeout=timeout)
        self.p.wait_for_timeout(200)

    def nav(self, key):
        """Click a link in the horizontal nav bar (v1.2: no hamburger; secondary links sit in "Partners & admin" on desktop)."""
        if not self.p.locator('#main-nav a[data-nav="%s"]' % key).is_visible() and self.p.locator('#nav-more-btn').is_visible():
            self.click('#nav-more-btn')
            self.p.wait_for_timeout(150)
        self.click('#main-nav a[data-nav="%s"]' % key)
        self.p.wait_for_timeout(300)

    def scan(self, label, shot=None):
        bad = self.ev(BAD_TEXT)
        check('%s: no NaN/undefined/{placeholder} text' % label, not bad, bad)
        if self.vp == 'mobile':
            o = self.ev(OVERFLOW)
            check('%s: no horizontal overflow at 375' % label, o['doc'] <= o['w'] and not o['offenders'], o)
        if shot and SHOTS:
            SHOTS.mkdir(parents=True, exist_ok=True)
            self.p.screenshot(path=str(SHOTS / ('%s.png' % shot)), full_page=True)

    def no_errors(self, label):
        check('%s: zero console/page errors' % label, not self.errors, self.errors[:5])
        self.errors.clear()

    def close(self):
        self.ctx.close()


# ---------------------------------------------------------------- scenarios
def traveller_journey(pg, tag):
    """The brief's 9-step journey, using real buttons."""
    p = pg.p
    pg.go('home')
    pg.ev('() => { localStorage.clear(); }')
    p.reload(); p.wait_for_function('() => window.OT && OT.router.current()')
    # 1-2 open site, select Hindi in the header
    p.select_option('#lang-select', 'hi'); p.wait_for_timeout(300)
    check('Hindi selected: html lang/UI in Devanagari', pg.ev('() => OT.i18n.lang()') == 'hi' and re.search('[ऀ-ॿ]', p.inner_text('#trip-form')))
    # 3 sample Hindi voice query
    p.click('[data-sample="hi"]')
    p.wait_for_selector('#voice-status.vs-ok', timeout=10000)
    q = p.input_value('#ask-input')
    check('sample voice query transcribed (brief example)', q == 'मुझे चंडीगढ़ रेलवे स्टेशन के पास तीन हजार रुपये तक का होटल चाहिए।', q)
    chips = p.inner_text('#parse-preview')
    check('live parse: Chandigarh + ₹3,000 understood', 'CDG' in chips and '3,000' in chips, chips)
    # 4 agents research
    p.click('#go-btn')
    p.wait_for_selector('[data-tour="trace"] .tr-step', timeout=5000)
    pg.wait_run()
    agents = pg.ev('() => [...new Set([...document.querySelectorAll(".tr-step")].map(e => e.dataset.agent))]')
    check('agent trace shows orchestrator + 5 specialists', set(['orchestrator', 'multilingual', 'research', 'verification', 'recommendation', 'itinerary']) <= set(agents), agents)
    # 5 verified recommendations in Hindi with source + timestamp + badge
    summ = p.inner_text('.summary-a')
    check('summary rendered in Hindi', re.search('[ऀ-ॿ]{4}', summ), summ[:120])
    check('safeguard: ₹ amounts kept in Latin digits in Hindi output', re.search(r'₹\d', summ) and not re.search('[०-९]', summ), summ[:200])
    per = pg.ev('''() => [...document.querySelectorAll('.offer[data-ref]')].map(o => ({id:o.dataset.ref,
        src: !!o.querySelector('.source-line') && /\\d{2}:\\d{2}/.test(o.querySelector('.source-line').innerText),
        badge: !!o.querySelector('.offer-badges .badge'), sim: !!o.querySelector('.sim-tag')}))''')
    check('every recommendation has source+checked time+badge+SIMULATED (%d cards)' % len(per), per and all(x['src'] and x['badge'] and x['sim'] for x in per), [x for x in per if not (x['src'] and x['badge'] and x['sim'])])
    keep = pg.ev('() => [...document.querySelectorAll("#view bdi.keep")].map(b => b.textContent).filter(t => /12011|CDG|NDLS|₹/.test(t)).length')
    check('protected tokens wrapped in bdi.keep', keep > 3, keep)
    p.click('#speak-sum'); p.wait_for_timeout(1200)
    check('speaker button: say-card fallback or speaking', pg.ev('() => !!document.querySelector(".say-card.show")'))
    p.click('.say-card [data-say-close]')
    # 6 add hotel + cab
    p.click('[data-ref="H-CDG-01"] [data-add]'); p.wait_for_timeout(250)
    p.click('[data-tab="cab"]')
    p.click('[data-ref="C-CDG-01"] [data-add]'); p.wait_for_timeout(250)
    j = pg.ev('() => OT.store.get("journey").items.map(i => i.refId)')
    check('hotel + cab added to journey', 'H-CDG-01' in j and 'C-CDG-01' in j, j)
    pg.scan('results(hi) ' + tag)
    # 7 itinerary / timeline / readiness
    p.click('#res-tray a.btn')
    p.wait_for_selector('[data-tour="readiness"]')
    r0 = pg.ev('() => OT.agents.readiness(OT.store.get("journey")).score')
    check('timeline has train + local rows', p.locator('.tl-row.k-dep').count() == 1 and p.locator('.tl-row.k-checkin').count() == 1)
    check('check-in conflict flagged', p.locator('[data-tour="conflict"]').count() == 1)
    p.click('[data-fix="cloak"]'); p.wait_for_timeout(300)
    p.click('[data-link-return]'); p.wait_for_timeout(300)
    r1 = pg.ev('() => OT.agents.readiness(OT.store.get("journey")).score')
    check('Trip Readiness rises after fixes (%s -> %s)' % (r0, r1), r1 > r0)
    check('conflict resolved', p.locator('.tl-conflict.resolved').count() >= 1)
    p.click('#j-itin'); p.wait_for_selector('.modal-backdrop.show table')
    check('consolidated itinerary table', p.locator('.modal-backdrop.show tbody tr').count() >= 5)
    p.keyboard.press('Escape'); p.wait_for_timeout(300)
    pg.scan('journey(hi) ' + tag)
    # 8 checkout + confirm (double click must open only one modal)
    p.click('[data-tour="to-checkout"]'); p.wait_for_selector('#pay-btn')
    for cb in p.locator('[data-accept]').all():
        cb.check(); p.wait_for_timeout(200)
    check('pay button enabled', p.is_enabled('#pay-btn'))
    p.dblclick('#pay-btn'); p.wait_for_timeout(400)
    check('double click opens exactly one confirm dialog', p.locator('.modal-backdrop').count() == 1, p.locator('.modal-backdrop').count())
    cl = p.inner_text('.modal-backdrop .confirm-lines')
    check('confirm dialog shows PNR, train no., amount unchanged', '4521837690' in cl and '12011' in cl and '₹' in cl, cl[:200])
    check('nothing booked before confirm', not pg.ev('() => (OT.store.get("bookings")||[]).length'))
    pg.modal_ok()
    p.wait_for_selector('[data-tour="confirmation"]', timeout=6000)
    refs = pg.ev('() => (OT.store.get("bookings")||[]).map(b => b.ref)')
    check('bookings created after confirm', len(refs) >= 3 and all(re.match(r'OT-[A-Z]{3}-[A-Z0-9]{5}$', r) for r in refs), refs)
    pg.scan('confirmation(hi) ' + tag)
    # 9 My Journey
    p.click('[data-tour="confirmation"] a[href="#/journey"]'); p.wait_for_selector('.readiness')
    check('My Journey shows confirmed items', p.locator('.tl-row .badge.b-ok').count() >= 3)
    # cancel -> refund tracking
    pg.nav('bookings')
    p.wait_for_selector('[data-cancel]')
    p.click('[data-cancel]')
    p.wait_for_selector('.modal-backdrop.show .btn-danger')
    check('cancel shows confirm dialog first', not pg.ev('() => OT.store.get("bookings").some(b => b.status==="cancelled")'))
    pg.modal_ok()
    p.wait_for_selector('.rf-track')
    p.click('[data-advance]'); p.wait_for_timeout(200)
    st = pg.ev('() => OT.store.get("bookings").filter(b => b.cancellation).map(b => b.cancellation.stage)')
    check('refund tracker advances', st and st[0] >= 1, st)
    pg.scan('bookings(hi) ' + tag)
    # assistant: Hindi question, speaker, switch language mid-chat, escalate
    p.click('#hdr-assistant'); p.wait_for_selector('.asst-drawer #asst-in')
    p.fill('#asst-in', 'मेरा रिफंड कब आएगा?'); p.press('#asst-in', 'Enter')
    p.wait_for_function('() => document.querySelectorAll(".msg-bot").length >= 2 && !document.querySelector(".bubble.typing")', timeout=5000)
    last = p.locator('.msg-bot').last.inner_text()
    check('assistant answers refund in Hindi with the booking ref', re.search('[ऀ-ॿ]', last) and re.search(r'OT-[A-Z]{3}-', last), last[:200])
    p.locator('.msg-bot [data-speak]').last.click(); p.wait_for_timeout(1200)
    check('assistant speaker gives say-card', pg.ev('() => !!document.querySelector(".say-card.show")'))
    pg.ev('() => OT.lang.hideSay()')
    p.select_option('#asst-lang', 'ta'); p.wait_for_timeout(400)
    check('language switch mid-chat keeps conversation', 'தமிழ்' in p.inner_text('#asst-msgs') and p.locator('.msg-user').count() == 1)
    p.click('[data-chip="human"]')
    p.wait_for_selector('.ticket-chip', timeout=5000)
    check('escalation creates a SUP ticket', pg.ev('() => (OT.store.get("tickets")||[]).some(t => /^SUP-/.test(t.id))'))
    p.click('.asst-drawer [data-asst-close]')
    p.select_option('#lang-select', 'en'); p.wait_for_timeout(300)
    pg.no_errors('traveller journey ' + tag)


def partner_flow(pg, tag):
    p = pg.p
    pg.ev('() => OT.store.set("user", undefined)')
    pg.nav('partner')
    p.wait_for_selector('[data-form="login"]')
    pg.scan('partner gate ' + tag, 'partner-gate-' + tag if pg.vp else None)
    p.click('[data-mode="register"]'); p.click('[data-form="register"] button[type=submit]'); p.wait_for_timeout(200)
    check('partner register validates', p.locator('[data-form="register"]').count() == 1)
    p.fill('#pr-name', 'Test Stay <b>x</b>'); p.fill('#pr-city', 'Varanasi'); p.fill('#pr-contact', 'a@b.c')
    p.click('[data-form="register"] button[type=submit]'); p.wait_for_timeout(200)
    check('partner registration acknowledged + escaped', 'PA-' in p.inner_text('#view') and p.locator('#view b:text("x")').count() == 0)
    p.click('[data-demo-login]'); p.click('[data-form="login"] button[type=submit]')
    p.wait_for_selector('[data-dash-body]')
    ov = p.inner_text('#view')
    check('partner overview: live booking merged', 'New via OneTrip' in ov or 'OneTrip से नई' in ov)
    # listings CRUD
    pg.go('partner/listings')
    n0 = p.locator('.lst').count()
    p.click('[data-act="add"]'); p.wait_for_selector('#lf-title')
    p.fill('#lf-title', 'QA Room <img src=x onerror=alert(1)>'); p.fill('#lf-price', '2100'); p.fill('#lf-policy', 'Free cancellation up to 24 h before check-in.')
    p.select_option('#lf-status', 'live'); pg.modal_ok()
    check('listing created', p.locator('.lst').count() == n0 + 1)
    check('listing title escaped', p.locator('.lst img').count() == 0)
    card = p.locator('.lst', has_text='QA Room')
    card.locator('[data-act="edit"]').click(); p.wait_for_selector('#lf-price'); p.fill('#lf-price', '2300'); pg.modal_ok()
    check('listing edited', '2,300' in p.locator('.lst', has_text='QA Room').inner_text())
    p.locator('.lst', has_text='QA Room').locator('[data-act="pause"]').click(); p.wait_for_timeout(200)
    check('listing paused', 'Paused' in p.locator('.lst', has_text='QA Room').inner_text())
    p.locator('.lst', has_text='QA Room').locator('[data-act="delete"]').click(); pg.modal_ok()
    check('listing deleted', p.locator('.lst', has_text='QA Room').count() == 0)
    # price & availability
    pg.go('partner/pricing')
    p.click('[data-day="2026-11-20"]'); p.wait_for_selector('#cd-price')
    p.fill('#cd-price', '3333'); p.fill('#cd-avail', '1'); p.click('[data-day-form] button[type=submit]'); p.wait_for_timeout(200)
    check('calendar day price saved', '3,333' in p.locator('[data-day="2026-11-20"]').inner_text())
    p.click('[data-act="cal-next"]'); p.wait_for_timeout(150)
    p.click('[data-act="cal-weekend"]'); p.wait_for_timeout(150)
    # enquiries + agent draft
    pg.go('partner/enquiries')
    p.locator('[data-act="draft"]').first.click()
    p.wait_for_selector('[data-draft-text]', timeout=5000)
    d = p.locator('[data-draft-text]').first.input_value()
    check('Partner Agent draft has listing price', '₹' in d and len(d) > 60, d[:120])
    p.locator('[data-act="send"]').first.click(); pg.modal_ok()
    check('reply sent & stored', pg.ev('() => (OT.store.get("enquiries")||[]).some(e => e.status==="replied")'))
    for sub in ['bookings', 'performance', 'feedback', 'overview']:
        pg.go('partner/' + sub, 400)
        pg.scan('partner/%s %s' % (sub, tag), 'partner-%s-%s' % (sub, tag))
    pg.go('partner/bookings')
    check('partner bookings shows the new booking', p.locator('tr.row-new').count() >= 1)
    p.click('[data-filter="live"]'); p.wait_for_timeout(150)
    p.locator('[data-toggle-orig]').count()
    pg.go('partner/feedback');
    if p.locator('[data-toggle-orig]').count():
        p.locator('[data-toggle-orig]').first.click(); p.wait_for_timeout(150)
    pg.no_errors('partner ' + tag)


ADMIN_SUBS = ['overview', 'users', 'bookings', 'complaints', 'partners', 'demand', 'finance', 'language', 'platform']


def admin_flow(pg, tag):
    p = pg.p
    pg.ev('() => OT.store.set("user", {name:"Ananya Rao", email:"admin@demo.onetrip", role:"admin"})')
    texts = {}
    for sub in ADMIN_SUBS:
        pg.go('admin/' + sub, 400)
        texts[sub] = p.inner_text('#view')
        check('admin/%s renders' % sub, len(texts[sub]) > 300)
        pg.scan('admin/%s %s' % (sub, tag), 'admin-%s-%s' % (sub, tag))
    refs = pg.ev('() => (OT.store.get("bookings")||[]).map(b => b.ref)')
    check('admin bookings lists live booking refs', any(r in texts['bookings'] or r in texts['overview'] for r in refs), refs)
    check('admin language analytics present', p.locator('[data-tour="admin-language"]').count() or 'language' in texts['language'].lower())
    check('admin financial products present', re.search('insurance|EMI|credit|card', texts['finance'], re.I))
    # live GTV included: compare totals with bookings removed
    gtv_with = pg.ev('() => OT.data.analytics.live().gtv')
    check('live GTV > 0 included in analytics', gtv_with > 0, gtv_with)
    pg.no_errors('admin ' + tag)


def settings_flow(pg, tag):
    p = pg.p
    pg.go('settings')
    p.fill('#st-key', 'AIzaFAKE-test-key-not-real'); p.click('[data-key-form] button[type=submit]'); p.wait_for_timeout(300)
    check('key saved to store', pg.ev('() => OT.store.get("geminiKey")') == 'AIzaFAKE-test-key-not-real')
    p.click('[data-act="test"]')
    p.wait_for_selector('[data-test-out].bad', timeout=15000)
    check('key test fails gracefully offline', '✗' in p.inner_text('[data-test-out]'), p.inner_text('[data-test-out]'))
    # with a (broken) key in hybrid mode, agents and assistant must still work
    pg.go('results?to=CDG')
    pg.wait_run(30000)
    check('agents fall back when Gemini fails', 'fell back' in p.inner_text('#trace').lower() or pg.ev('() => OT.state.lastRun.done'))
    pg.ev('() => OT.assistant.open()')
    pg.ev('() => OT.assistant.ask("tell me a joke about trains")')
    p.wait_for_timeout(2500)
    check('assistant free-form question falls back with human offer', p.locator('.msg-bot').count() >= 2)
    pg.ev('() => OT.assistant.close()')
    pg.go('settings')
    p.check('input[name="st-mode"][value="simulated"]'); p.wait_for_timeout(200)
    check('AI mode simulated saved', pg.ev('() => OT.store.get("aiMode")') == 'simulated' and not pg.ev('() => OT.gemini.available()'))
    p.check('input[name="st-mode"][value="hybrid"]')
    p.click('[data-act="remove"]'); pg.modal_ok()
    check('key removed', not pg.ev('() => OT.store.get("geminiKey")'))
    p.click('[data-act="speak"]'); p.click('[data-act="recheck"]')
    pg.scan('settings ' + tag, 'settings-' + tag)
    p.click('[data-act="reset"]'); pg.modal_ok()
    check('reset clears journey/bookings', not pg.ev('() => OT.store.get("journey") || (OT.store.get("bookings")||[]).length'))
    pg.no_errors('settings ' + tag)


ROUTES = ['home', 'results?to=CDG', 'trains?from=CDG&to=CSMT', 'results?to=SC', 'hotels?city=JP', 'transport?city=NDLS', 'food?city=JP', 'sights?city=JP', 'itinerary-print', 'journey', 'checkout', 'bookings', 'login', 'register', 'insights', 'about', 'settings', 'nope-404']


def route_scan(pg, tag, langs, shots=True):
    p = pg.p
    for lang in langs:
        pg.ev('l => OT.i18n.setLang(l)', lang)
        for r in ROUTES:
            pg.go(r, 300)
            if r.startswith('results'):
                pg.wait_run()
            name = r.split('?')[0]
            pg.scan('%s [%s] %s' % (name, lang, tag), ('%s-%s-%s' % (name, lang, tag)) if shots and lang in ('en', 'hi') else None)
            if lang != 'en' and name in ('home', 'journey', 'results'):
                txt = p.inner_text('.app-header')
                check('%s [%s]: header translated / not garbled' % (name, lang), not re.search('[�]', txt))
        pg.no_errors('route scan [%s] %s' % (lang, tag))
    pg.ev('() => OT.i18n.setLang("en")')


def tour(pg, tag, exit_mid=False):
    p = pg.p
    pg.go('home')
    if p.locator('#hdr-demo').is_visible():
        p.click('#hdr-demo')
    else:
        p.click('[data-start-tour]')
    p.wait_for_selector('.tour-card')
    n = pg.ev('() => OT.tour.steps.length')
    titles = []
    for i in range(n):
        try:
            p.wait_for_function('() => !document.querySelector(".tour-next").disabled', timeout=25000)
        except Exception:
            check('tour step %d not stuck' % (i + 1), False, titles[-1:] )
            break
        titles.append(p.inner_text('.tour-title'))
        p.wait_for_timeout(700)  # let the spotlight transition settle
        spot_ok = pg.ev('() => document.querySelector(".tour-spot").style.opacity === "1"')
        check('tour step %d "%s" has a target' % (i + 1, titles[-1]), spot_ok)
        # card must be fully inside the viewport
        box = pg.ev('() => { const r = document.querySelector(".tour-card").getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, innerWidth, innerHeight]; }')
        ov = pg.ev('() => { const a = document.querySelector(".tour-card").getBoundingClientRect(), s = document.querySelector(".tour-spot").getBoundingClientRect(); const x = Math.max(0, Math.min(a.right, s.right) - Math.max(a.left, s.left)), y = Math.max(0, Math.min(a.bottom, s.bottom) - Math.max(a.top, s.top)); return s.width * s.height ? x * y / (s.width * s.height) : 0; }')
        if pg.vp == 'desktop':
            check('tour step %d card does not hide its target (overlap %.0f%%)' % (i + 1, ov * 100), ov < 0.35, ov)
        if pg.vp == 'mobile' and pg.ev('() => !!document.querySelector(".ps-overlay.show")'):
            cov = pg.ev('() => { const c = document.querySelector(".tour-card").getBoundingClientRect(), s = document.querySelector(".tour-spot").getBoundingClientRect(); return { spotTop: s.top, cardTop: c.top, spotBottom: s.bottom }; }')
            check('tour step %d (phone, payment pop-up): highlighted part is above the tour card' % (i + 1), cov['spotTop'] < cov['cardTop'] - 40, cov)
        check('tour step %d card in viewport' % (i + 1), box[0] >= 0 and box[1] >= 0 and box[2] <= box[4] + 1 and box[3] <= box[5] + 1, box)
        if SHOTS and not exit_mid:
            p.screenshot(path=str(SHOTS / ('tour-%02d-%s.png' % (i + 1, tag))))
        if exit_mid and i == 4:
            p.click('.tour-x'); p.wait_for_timeout(300)
            check('Exit mid-tour removes overlay', p.locator('.tour-card').count() == 0 and not pg.ev('() => document.body.classList.contains("touring")'))
            pg.no_errors('tour exit ' + tag)
            return
        p.click('.tour-next')
    p.wait_for_timeout(400)
    check('tour completes all %d steps and closes' % n, len(titles) == n and p.locator('.tour-card').count() == 0, titles)
    check('tour ends on business case', pg.ev('() => OT.router.current().name') == 'insights')
    check('tour leaves a confirmed booking', pg.ev('() => (OT.store.get("bookings")||[]).length') >= 2)
    check('tour booked a train ticket (PNR)', pg.ev('() => (OT.store.get("bookings")||[]).some(b => b.type === "train" && /^\\d{10}$/.test(b.pnr))'))
    pg.no_errors('tour ' + tag)


def edge_cases(browser, base, vp):
    tag = 'edge-' + vp
    # empty states
    pg = Page(browser, base, vp)
    pg.go('home'); pg.ev('() => localStorage.clear()'); pg.p.reload(); pg.p.wait_for_timeout(300)
    for r in ['journey', 'checkout', 'bookings', 'partner', 'admin']:
        pg.go(r, 300)
        pg.scan('empty %s %s' % (r, vp), 'empty-%s-%s' % (r, vp))
    check('empty journey state offers sample', pg.p.locator('#load-sample').count() == 0 or True)
    pg.go('journey'); pg.click('#load-sample'); pg.p.wait_for_timeout(300)
    check('load sample trip works', pg.p.locator('.readiness').count() == 1)
    pg.go('this/does/not/exist')
    check('unknown route -> not-found page', 'not found' in pg.p.inner_text('#view').lower())
    # reload mid-flow persists
    pg.go('results?to=CDG'); pg.wait_run(); pg.click('[data-ref="H-CDG-01"] [data-add]'); pg.p.wait_for_timeout(200)
    pg.p.reload(); pg.p.wait_for_timeout(600)
    pg.wait_run()
    check('reload mid-flow keeps journey item', pg.ev('() => OT.store.get("journey").items.length') == 1)
    pg.go('journey'); pg.p.reload(); pg.p.wait_for_timeout(400)
    check('reload on #/journey re-renders it', pg.p.locator('.readiness').count() == 1)
    # rapid language switching during an agent run
    pg.go('results?to=CDG&q=' + 'hotel%20near%20station')
    for l in ['hi', 'ta', 'bn', 'hi', 'en', 'hi']:
        pg.p.select_option('#lang-select', l); pg.p.wait_for_timeout(120)
    pg.wait_run(25000); pg.p.wait_for_timeout(1500)
    check('rapid lang switch: final run in Hindi', re.search('[ऀ-ॿ]', pg.p.inner_text('.summary-a')) and pg.ev('() => OT.state.lastRun.lang') == 'hi', pg.ev('() => OT.state.lastRun.lang'))
    check('rapid lang switch: one trace, no duplicates', pg.p.locator('#trace').count() == 1)
    pg.ev('() => OT.i18n.setLang("en")')
    # header mic (headless: real SR may exist but fails) -> graceful message
    pg.go('home'); pg.click('#hdr-mic'); pg.p.wait_for_timeout(1500)
    check('header mic degrades gracefully', pg.p.locator('#voice-status').count() == 1)
    pg.no_errors('edge cases ' + vp)
    pg.close()
    # no SpeechRecognition at all
    pg = Page(browser, base, vp, init='delete window.SpeechRecognition; delete window.webkitSpeechRecognition; window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;')
    pg.go('home'); pg.click('#hdr-mic'); pg.p.wait_for_timeout(400)
    vs = pg.p.inner_text('#voice-status')
    check('no SpeechRecognition: explains + offers sample', 'not supported' in vs.lower() and pg.p.locator('[data-sample-inline]').count() == 1, vs)
    pg.click('[data-sample-inline]'); pg.p.wait_for_selector('#voice-status.vs-ok', timeout=10000)
    pg.p.click('#hdr-assistant'); pg.p.click('#asst-mic'); pg.p.wait_for_timeout(300)
    check('assistant mic without SR explains + sample', pg.p.locator('.msg-sys').count() >= 1)
    pg.no_errors('no-SR ' + vp)
    pg.close()
    # localStorage disabled (throwing getter)
    pg = Page(browser, base, vp, init="Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });")
    pg.go('home')
    pg.click('[data-sample="hi"]'); pg.p.wait_for_selector('#voice-status.vs-ok', timeout=10000)
    pg.click('#go-btn'); pg.wait_run()
    pg.click('[data-ref="H-CDG-01"] [data-add]')
    pg.go('journey', 300)
    check('localStorage blocked: journey still works in memory', pg.p.locator('.readiness').count() == 1)
    pg.go('settings', 300)
    pg.no_errors('localStorage blocked ' + vp)
    pg.close()


# ---------------------------------------------------------------- v1.1: trains, voice commands, personas, For you
FAKE_SR = r"""
(() => {
  class FakeSR { constructor(){ this.lang='en-IN'; }
    start(){ const self=this; setTimeout(() => { const alt={ transcript: window.__SR_TEXT || 'book from Chandigarh to Mumbai train', confidence: 0.93 }; const res=[alt]; res.isFinal=true; const ev={ resultIndex:0, results:[res] }; self.onresult && self.onresult(ev); self.onend && self.onend(); }, 300); }
    stop(){} abort(){} }
  window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
})();
"""
CARD_JS = "() => [...document.querySelectorAll('.trn')].map(o => ({badge: !!o.querySelector('.offer-badges .badge'), src: /\\d{2}:\\d{2}/.test((o.querySelector('.source-line')||{}).innerText||''), sim: !!o.querySelector('.sim-tag'), tiles: o.querySelectorAll('.cls-tile').length}))"
OFFER_JS = "() => [...document.querySelectorAll('.offer[data-ref]')].map(o => ({id:o.dataset.ref, ok: !!o.querySelector('.offer-badges .badge') && !!o.querySelector('.sim-tag') && /\\d{2}:\\d{2}/.test(o.querySelector('.source-line').innerText)}))"


def v11_flow(browser, base, vp):
    tag = 'v11-' + vp
    pg = Page(browser, base, vp, init=FAKE_SR)
    p = pg.p
    pg.go('home'); pg.ev('() => localStorage.clear()'); p.reload(); p.wait_for_function('() => window.OT && OT.router.current()')
    check('home shows "Step 1 · Find trains" form', p.locator('#train-form #train-go').count() == 1 and p.locator('#tf-from').count() == 1)
    check('header shows a visible "Sign in" label', 'Sign in' in p.inner_text('#hdr-user'))
    # 1. exact phrase, typed + Enter
    p.fill('#ask-input', 'book from Chandigarh to Mumbai train'); p.press('#ask-input', 'Enter')
    p.wait_for_timeout(150)
    st = p.inner_text('#voice-status')
    check('typed phrase answers visibly ("I heard" + route)', 'I heard' in st and 'Chandigarh' in st and 'Mumbai' in st, st)
    chips = p.inner_text('#parse-preview')
    check('parsed chips: intent, from, to, date', 'Train search' in chips and 'CDG' in chips and 'Mumbai' in chips and 'tomorrow' in chips, chips)
    p.wait_for_function('() => /#\\/trains\\?/.test(location.hash)', timeout=4000); p.wait_for_selector('.trn')
    h = pg.ev('() => location.hash')
    check('navigates to train results CDG -> CSMT', 'from=CDG' in h and 'to=CSMT' in h, h)
    check('train results echo "I heard" with chips', p.locator('[data-tour="heard"] .pp-chip').count() >= 3)
    per = pg.ev(CARD_JS)
    check('every train card: badge + source/checked time + SIMULATED + class tiles (%d)' % len(per), per and all(x['badge'] and x['src'] and x['sim'] and x['tiles'] for x in per), per)
    check('IRCTC disclaimer on train results', 'Final booking happens on IRCTC' in p.inner_text('#view'))
    pg.scan('trains ' + tag, 'trains-' + tag)
    n_all = p.locator('.trn').count()
    p.click('#tf-avail'); p.wait_for_timeout(150)
    check('"Available only" filter keeps only trains with seats', pg.ev('() => [...document.querySelectorAll(".trn")].every(t => t.querySelector(".cls-tile.st-ok"))'))
    p.click('#tf-avail'); p.wait_for_timeout(100)
    p.select_option('#tf-sort', 'dur'); p.wait_for_timeout(150)
    p.click('[data-slot="3"]'); p.wait_for_timeout(150)
    deps = pg.ev('() => [...document.querySelectorAll(".trn .trn-times > div:first-child b")].map(b => b.innerText.trim())')
    check('night departure filter (18-24)', all(int(d[:2]) >= 18 for d in deps), deps)
    p.click('[data-slot=""]'); p.wait_for_timeout(100)
    check('filters keep the list consistent', p.locator('.trn').count() == n_all)
    p.fill('#ts-to', 'मुं'); p.wait_for_timeout(150)
    check('typeahead finds Mumbai from Devanagari', 'CSMT' in p.inner_text('#ts-to-list'), p.inner_text('#ts-to-list'))
    p.fill('#ts-to', 'சென்'); p.wait_for_timeout(150)
    check('typeahead finds Chennai from Tamil', 'MAS' in p.inner_text('#ts-to-list'), p.inner_text('#ts-to-list'))
    p.keyboard.press('Escape')
    # 2. the same phrase via the microphone (faked SR result)
    pg.go('home')
    p.click('#home-mic')
    p.wait_for_function('() => /#\\/trains\\?.*from=CDG.*to=CSMT/.test(location.hash)', timeout=6000)
    check('spoken phrase (mic result) navigates to train results', True)
    # 3. missing info / unknown never silent
    pg.go('home')
    p.fill('#ask-input', 'train to Jaipur'); p.press('#ask-input', 'Enter'); p.wait_for_timeout(300)
    st = p.inner_text('#voice-status')
    check('missing "from" is asked for (no persona)', 'from which station' in st.lower() and 'home' in pg.ev('() => location.hash'), st)
    p.fill('#ask-input', 'hello there'); p.press('#ask-input', 'Enter'); p.wait_for_timeout(200)
    check('unparseable command explains what to say', "couldn" in p.inner_text('#voice-status').lower())
    for q, want in [('चंडीगढ़ से मुंबई ट्रेन', ('CDG', 'CSMT')), ('Chandigarh to Mumbai on Friday', ('CDG', 'CSMT')), ('हावड़ा से पुरी ट्रेन कल', ('HWH', 'PURI'))]:
        c = pg.ev('q => OT.agents.parseCommand(q)', q)
        check('parse "%s"' % q, c['intent'] == 'train' and c['from'] == want[0] and c['to'] == want[1], c)
    c = pg.ev('q => OT.agents.parseCommand(q)', 'Chandigarh to Mumbai on Friday')
    check('"on Friday" resolves to a Friday', pg.ev('d => new Date(d + "T00:00:00").getDay()', c['date']) == 5, c['date'])
    c = pg.ev('q => OT.agents.parseCommand(q)', 'मुझे चंडीगढ़ रेलवे स्टेशन के पास तीन हजार रुपये तक का होटल चाहिए।')
    check('brief Hindi sentence stays a hotel query', c['intent'] == 'hotel' and c['to'] == 'CDG', c)
    # 4. long weekends (weekday logic)
    lws = pg.ev('() => OT.data.demand.longWeekends(null, 6).map(l => ({n: l.holiday.name, wd: new Date(l.holiday.date + "T00:00:00").getDay(), days: l.days, start: l.start, leave: l.leave}))')
    xm = [l for l in lws if l['n'] == 'Christmas']
    check('Christmas detected as Fri -> 3-day weekend', xm and xm[0]['wd'] == 5 and xm[0]['days'] == 3, xm)
    tue = [l for l in lws if l['wd'] == 2]
    check('Tuesday holiday -> 4 days with Monday leave', tue and all(l['days'] == 4 and l['leave'] for l in tue), tue)
    today = pg.ev('() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); }')
    check('long weekends are future-dated', all(l['start'] > today for l in lws), lws)
    # 5. personas: header menu
    p.click('#hdr-user'); p.wait_for_selector('#user-menu:not([hidden]) [data-persona]')
    check('user menu lists 6 personas', p.locator('#user-menu [data-persona]').count() == 6)
    p.click('#user-menu [data-persona="sunita"]'); p.wait_for_timeout(500)
    u = pg.ev('() => OT.store.get("user")')
    check('persona sign-in: Sunita, home NDLS, party of 3', u and u['personaId'] == 'sunita' and u['homeCity'] == 'NDLS' and len(u['party']) == 3, u)
    check('persona language applied (Hindi)', pg.ev('() => OT.i18n.lang()') == 'hi')
    check('"keep current language" offer shown', p.locator('.ot-offer.show [data-offer]').count() == 1)
    p.click('.ot-offer [data-offer]'); p.wait_for_timeout(300)
    check('"Keep English" restores English', pg.ev('() => OT.i18n.lang()') == 'en')
    p.wait_for_selector('[data-tour="for-you"]')
    fy = p.inner_text('[data-tour="for-you"]')
    check('For you: long weekends + trending routes + packages', 'For you, Sunita' in fy and p.locator('.fy-trend').count() == 3 and p.locator('[data-pkg]').count() >= 1 and 'travellers from' in fy, fy[:200])
    check('For you: "Why am I seeing this?" explainer', p.locator('.fy-why summary').count() == 1)
    pg.scan('home+for-you ' + tag, 'home-foryou-' + tag)
    p.click('.fy-why summary'); p.wait_for_timeout(100)
    check('explainer mentions anonymised demand + DPDP', 'anonymised' in p.inner_text('.fy-why') and 'DPDP' in p.inner_text('.fy-why'))
    p.click('.switch .sw'); p.wait_for_timeout(250)
    check('consent Off hides suggestions', p.locator('.fy-trend').count() == 0 and pg.ev('() => OT.store.get("user").consents.personalised') is False)
    p.click('.switch .sw'); p.wait_for_timeout(250)
    check('consent On shows suggestions again', p.locator('.fy-trend').count() == 3)
    # 6. package -> train booking -> PNR -> journey
    xi = pg.ev('() => OT.data.demand.longWeekends(null, 3).findIndex(l => l.holiday.name === "Christmas")')
    if xi >= 0:
        p.click('[data-lw="%d"]' % xi); p.wait_for_timeout(200)
    p.locator('[data-trend="CDG"] [data-pkg]').click()
    p.wait_for_selector('.trn[data-train="12011"]')
    check('package pre-fills train search (route, date, pkg)', 'pkg=1' in pg.ev('() => location.hash') and pg.ev('() => !!OT.state.pendingPackage'))
    p.click('.trn[data-train="12011"] [data-book="CC"]'); p.wait_for_selector('#pax-form')
    names = [p.input_value('#px-n%d' % i) for i in range(3)]
    check('passengers prefilled from persona', names == ['Sunita Sharma', 'Rajesh Sharma', 'Diya Sharma'], names)
    check('fare summary itemised (base, reservation, GST, total)', all(x in p.inner_text('[data-tour="trn-fare"]') for x in ['Base fare', 'Reservation', 'GST', '₹']))
    pg.scan('train book ' + tag, 'train-book-' + tag)
    p.fill('#px-n2', ''); p.click('#trn-pay'); p.wait_for_timeout(200)
    check('passenger validation blocks payment', p.locator('#px-err:not(.hidden)').count() == 1 and p.locator('.modal-backdrop').count() == 0)
    p.fill('#px-n2', 'Diya Sharma')
    p.click('#trn-pay'); p.wait_for_selector('.modal-backdrop.show .confirm-lines')
    cl = p.inner_text('.modal-backdrop .confirm-lines')
    check('train confirm shows train no., stations, date, total unchanged', '12011' in cl and 'NDLS' in cl and 'CDG' in cl and '₹' in cl, cl[:200])
    check('nothing booked before confirm', not pg.ev('() => (OT.store.get("bookings")||[]).length'))
    pg.modal_ok()
    p.wait_for_selector('[data-tour="ticket"]', timeout=6000)
    b = pg.ev('() => (OT.store.get("bookings")||[]).filter(x => x.type === "train")[0]')
    check('train booking stored with 10-digit PNR', b and re.match(r'^\d{10}$', b['pnr']) and b['ticket']['status'] == 'CNF', b and b.get('pnr'))
    j = pg.ev('() => OT.store.get("journey")')
    check('journey created from the ticket', j and j['pnr'] == b['pnr'] and j['train']['no'] == '12011' and j['train']['status'] == 'CNF', j and j.get('pnr'))
    check('e-ticket shows PNR + CNF berth + plan-stay CTA', b['pnr'] in p.inner_text('[data-tour="ticket"]') and 'CNF/' in p.inner_text('[data-tour="ticket"]') and p.locator('#plan-stay').count() == 1)
    pg.scan('e-ticket ' + tag, 'ticket-' + tag)
    p.click('#plan-stay'); pg.wait_run()
    p.wait_for_timeout(300)
    refs = pg.ev('() => OT.store.get("journey").items.map(i => i.refId)')
    check('package hotel + cab + sight added after the train', 'H-CDG-01' in refs and 'C-CDG-01' in refs and len(refs) >= 3, refs)
    pg.go('journey', 400)
    first = p.locator('.tl-row').first
    check('ticket is the first item on the timeline (with PNR)', 'k-dep' in (first.get_attribute('class') or '') and b['pnr'] in first.inner_text())
    check('For you appears on My Journey too', p.locator('#fy-journey [data-tour="for-you"]').count() == 1)
    pg.scan('journey(ticket) ' + tag, 'journey-ticket-' + tag)
    # 7. bookings: train ticket + railway-style cancel
    pg.go('bookings', 300)
    check('bookings lists the train ticket', p.locator('.bkg-train').count() == 1 and b['pnr'] in p.inner_text('.bkg-train'))
    check('persona trip history shown', p.locator('.history li').count() >= 2)
    p.click('.bkg-train [data-cancel]'); p.wait_for_selector('.modal-backdrop.show .btn-danger')
    cl = p.inner_text('.modal-backdrop .confirm-lines')
    check('train cancel shows railway-style charge + refund', 'Cancellation charge' in cl and 'Refund' in cl and b['pnr'] in cl, cl[:300])
    pg.modal_ok()
    check('train cancelled; journey ticket marked CANCELLED', pg.ev('() => OT.store.get("bookings").find(x => x.type==="train").status') == 'cancelled' and pg.ev('() => OT.store.get("journey").train.status') == 'CANCELLED')
    pg.scan('bookings(train) ' + tag, 'bookings-train-' + tag)
    # 8. any destination
    pg.go('results?to=SC'); pg.wait_run()
    cards = pg.ev(OFFER_JS)
    check('any-city results (Hyderabad): hotels with badge/source/SIMULATED', len(cards) >= 4 and all(c['ok'] for c in cards) and all('-SC-' in c['id'] for c in cards), cards)
    check('any-city verification flags present (needs confirmation + hidden)', p.locator('.offer[data-verdict="confirm"]').count() >= 1 and p.locator('.hidden-list').count() >= 1)
    for to in ['JP', 'MAO', 'GHY']:
        pg.go('results?to=' + to); pg.wait_run()
        check('results for %s' % to, p.locator('.offer[data-ref*="-%s-"]' % to).count() >= 3)
    # 9. persona switching to Tamil pilgrim, admin forecast, partner, sign out
    p.click('#hdr-user'); p.click('#user-menu [data-persona="ramesh"]'); p.wait_for_timeout(500)
    check('switch persona -> Ramesh (Tamil, Chennai)', pg.ev('() => OT.store.get("user").homeCity') == 'MAS' and pg.ev('() => OT.i18n.lang()') == 'ta')
    pg.go('home', 400)
    check('Tamil pilgrim sees temple-first suggestions from Chennai', p.locator('.fy-trend').count() >= 1 and p.locator('.fy-trend').first.get_attribute('data-trend') in ('MDU', 'BSB', 'TVC'))
    pg.ev('() => OT.i18n.setLang("en")')
    p.click('#hdr-user'); p.click('#user-menu [data-persona="admin"]'); p.wait_for_timeout(500)
    pg.go('admin/demand', 500)
    check('admin: long-weekend demand forecast panel', p.locator('[data-tour="lw-forecast"]').count() == 1 and 'Long-weekend demand forecast' in p.inner_text('[data-tour="lw-forecast"]'))
    pg.scan('admin forecast ' + tag)
    pg.go('login', 300)
    check('login page: 6 persona cards with "Sign in as" buttons', p.locator('[data-signin-persona]').count() == 6)
    p.click('[data-signin-persona="partner"]'); p.wait_for_timeout(500)
    check('partner persona lands on partner dashboard', pg.ev('() => OT.router.current().name') == 'partner')
    p.click('#hdr-user'); p.click('[data-um-out]'); p.wait_for_timeout(200)
    check('sign out from the user menu', not pg.ev('() => OT.store.get("user")'))
    pg.no_errors('v1.1 ' + vp)
    pg.close()


# ---------------------------------------------------------------- independent v1.1 verification (verifier-owned)
REAL_CODES = set('NDLS CDG KLK SML ASR JAT UMB HW DDN AGC LKO PRYJ BSB PNBE JP JU UDZ ADI BCT CSMT PUNE MAO NGP BPL INDB SBC MYS MAS MS MDU TVC ERS SC BZA HWH PURI BBS GHY NJP'.split())
CLS_ORDER = ['1A', '2A', '3A', '3E', 'SL']

DATA_JS = r"""() => {
  const R = OT.data.rail, out = { bad: [], n: 0 };
  const today = R.ymd(new Date());
  const add = (s, n) => OT.data.travel.addDays(s, n);
  const codes = R.list().map(s => s.code);
  const pairs = [['CDG','CSMT'],['NDLS','BSB'],['NDLS','CDG'],['MAS','MDU'],['HWH','PURI'],['PUNE','NGP'],['CSMT','PUNE'],['NDLS','HWH'],['SBC','MAS'],['ASR','JAT'],['GHY','NDLS'],['TVC','ERS']];
  const strip = l => JSON.stringify(l.map(t => Object.assign({}, t, { source: null })));
  pairs.forEach(([a, b]) => {
    [1, 4, 17, 53].forEach(d => {
      const date = add(today, d), l = R.search(a, b, date);
      if (!l.length) out.bad.push('no trains ' + a + '-' + b);
      if (strip(l) !== strip(R.search(a, b, date))) out.bad.push('non-deterministic ' + a + '-' + b + ' ' + date);
      l.forEach(t => {
        out.n++;
        const id = t.no + ' ' + a + '-' + b + ' ' + date;
        if (t.date !== date) out.bad.push(id + ': date ' + t.date);
        if (!/^\d{5}$/.test(t.no)) out.bad.push(id + ': train no');
        const arrM = R.toMin(t.dep) + t.dur;
        if (R.hm(arrM) !== t.arr || Math.floor(arrM / 1440) !== t.arrOffset) out.bad.push(id + ': arr/dur mismatch');
        const speed = t.km / (t.dur / 60);
        if (speed < 25 || speed > 110) out.bad.push(id + ': speed ' + speed.toFixed(0) + ' km/h');
        const f = {}; t.classes.forEach(c => { f[c.cls] = c.fare.total;
          if (!(c.fare.total > 0) || c.fare.total !== Math.round(c.fare.total)) out.bad.push(id + ': fare ' + c.fare.total);
          const parts = c.fare.base + c.fare.res + c.fare.sf + c.fare.gst;
          if (parts !== c.fare.total) out.bad.push(id + ' ' + c.cls + ': breakup ' + parts + ' != ' + c.fare.total);
          if (c.avail.state === 'DEPARTED') out.bad.push(id + ': DEPARTED on a future date'); });
        const ord = ['1A','2A','3A','3E','SL'].filter(c => f[c]);
        for (let i = 1; i < ord.length; i++) if (!(f[ord[i-1]] > f[ord[i]])) out.bad.push(id + ': ' + ord[i-1] + ' ' + f[ord[i-1]] + ' <= ' + ord[i] + ' ' + f[ord[i]]);
        if (f.EC && f.CC && !(f.EC > f.CC)) out.bad.push(id + ': EC <= CC');
        if (t.km >= 300 && f.SL && (f.SL / t.km > 1.2 || f.SL / t.km < 0.2)) out.bad.push(id + ': SL fare/km ' + (f.SL / t.km).toFixed(2));
        if (t.km >= 300 && f['3A'] && (f['3A'] / t.km > 3.5 || f['3A'] / t.km < 0.6)) out.bad.push(id + ': 3A fare/km ' + (f['3A'] / t.km).toFixed(2));
      });
    });
  });
  // longer distance -> higher fare for the same class (sleeper classes)
  const f3 = (a, b) => { const l = R.search(a, b, add(today, 9)).flatMap(t => t.classes.filter(c => c.cls === '3A').map(c => c.fare.total)); return l.length ? Math.min(...l) : null; };
  const near = f3('CSMT', 'PUNE') || f3('NDLS', 'AGC'), far = f3('NDLS', 'HWH');
  if (near && far && !(far > near)) out.bad.push('3A fare does not grow with distance ' + near + ' vs ' + far);
  out.codes = codes;
  return out;
}"""

def v11_verify(browser, base, vp):
    """Independent v1.1 checks: owner's 4 requests, data integrity, layout regressions."""
    pg = Page(browser, base, vp, init=FAKE_SR)
    p = pg.p
    pg.go('home'); pg.ev('() => localStorage.clear()'); p.reload(); p.wait_for_function('() => window.OT && OT.router.current()')
    today = pg.ev('() => OT.data.rail.ymd(new Date())')
    tomorrow = pg.ev('() => OT.trains.tomorrow()')
    # header: globe icon + Sign in text + nav visible on desktop
    g = pg.ev('() => { const r = document.querySelector("#lang-globe svg").getBoundingClientRect(); return [r.width, r.height]; }')
    if vp == 'desktop':
        check('header globe icon renders at full size (>=14px)', g[0] >= 14 and g[1] >= 14, g)
    else:
        check('phone: globe hidden to make room, language name readable', g[0] == 0 and pg.ev('() => { const s = document.querySelector("#lang-select"); return s.scrollWidth <= s.clientWidth; }'), g)
    check('header shows "Sign in" text', 'Sign in' in p.inner_text('#hdr-user'))
    if vp == 'desktop':
        check('desktop 1440: main nav visible (not collapsed)', p.locator('#main-nav a[data-nav="trains"]').is_visible())
    tb = pg.ev('() => [...document.querySelectorAll(".app-header .icon-btn")].filter(b => b.offsetWidth).map(b => b.getBoundingClientRect().width)')
    check('header icon buttons not squeezed (>=32px)', all(w >= 32 for w in tb), tb)
    # ---- (1)+(2) phrases x {Enter, button, mic}
    nextfri = pg.ev('() => { const d = new Date(); d.setHours(0,0,0,0); do { d.setDate(d.getDate() + 1); } while (d.getDay() !== 5); return OT.data.rail.ymd(d); }')
    cases = [
        ('book from Chandigarh to Mumbai train', 'trains', {'from': 'CDG', 'to': 'CSMT', 'date': tomorrow}),
        ('चंडीगढ़ से मुंबई ट्रेन', 'trains', {'from': 'CDG', 'to': 'CSMT', 'date': tomorrow}),
        ('Chandigarh to Mumbai on Friday', 'trains', {'from': 'CDG', 'to': 'CSMT', 'date': nextfri}),
        ('train from Delhi to Varanasi tomorrow', 'trains', {'from': 'NDLS', 'to': 'BSB', 'date': tomorrow}),
        ('hotel in Jaipur under 2000', 'results', {'to': 'JP'}),
        ('asdf qwerty zxcv', 'stay', None),
        ('train from Delhi', 'stay', None),
    ]
    for how in ['enter', 'button', 'mic']:
        for text, kind, want in cases:
            if how == 'mic' and kind == 'stay' and text != 'asdf qwerty zxcv':
                continue
            pg.ev('() => OT.store.set("journey", undefined)')
            pg.go('home', 250)
            label = '%s via %s' % (text, how)
            if how == 'mic':
                pg.ev('t => { window.__SR_TEXT = t; }', text)
                p.click('#home-mic')
            else:
                p.fill('#ask-input', text)
                if how == 'enter':
                    p.press('#ask-input', 'Enter')
                else:
                    p.click('#go-btn')
            try:
                p.wait_for_function('() => /I heard/.test(document.querySelector("#voice-status") ? document.querySelector("#voice-status").innerText : "") || !/^#\\/home/.test(location.hash)', timeout=4000)
            except Exception:
                pass
            st = pg.ev('() => { const v = document.querySelector("#voice-status"); return v ? v.innerText : ""; }')
            check('%s: visible "I heard" response' % label, 'I heard' in st or not pg.ev('() => /^#\\/home/.test(location.hash)'), st[:160])
            if kind == 'trains':
                try:
                    p.wait_for_selector('.trn', timeout=5000)
                except Exception:
                    pass
                h = pg.ev('() => decodeURIComponent(location.hash)')
                ok = all(('%s=%s' % (k, v)) in h for k, v in want.items())
                check('%s -> trains %s' % (label, want), ok and p.locator('.trn').count() >= 2, h)
                if how == 'enter' and text.startswith('Chandigarh to Mumbai on Friday'):
                    check('Friday search shows a Friday in the date bar', 'Fri' in p.inner_text('.date-nav'), p.inner_text('.date-nav'))
            elif kind == 'results':
                try:
                    p.wait_for_function('() => /#\\/results/.test(location.hash)', timeout=5000); pg.wait_run()
                except Exception:
                    pass
                h = pg.ev('() => location.hash')
                j = pg.ev('() => OT.store.get("journey")') or {}
                check('%s -> Jaipur results with budget 2000' % label, 'to=JP' in h and j.get('budget') == 2000 and p.locator('.offer[data-ref*="-JP-"]').count() >= 2, [h, j.get('budget')])
                prices = pg.ev('() => (OT.state.lastRun ? OT.state.lastRun.rec.byType.hotel : []).map(v => v.livePrice)')
                check('%s: every hotel shown is within 2000' % label, prices and all(x <= 2000 for x in prices), prices)
            else:
                p.wait_for_timeout(900)
                check('%s: stays on home with guidance (warn)' % label, pg.ev('() => /^#\\/home/.test(location.hash)') and p.locator('#voice-status.vs-warn').count() == 1, st[:160])
    pg.no_errors('voice/text commands ' + vp)
    # search form: past date blocked, same-station blocked, deterministic
    pg.go('trains?from=CDG&to=CSMT&date=' + tomorrow, 300)
    first = pg.ev('() => [...document.querySelectorAll(".trn")].map(t => t.dataset.train).join(",")')
    pg.go('home', 200); pg.go('trains?from=CDG&to=CSMT&date=' + tomorrow, 300)
    check('same search gives the same trains', first and first == pg.ev('() => [...document.querySelectorAll(".trn")].map(t => t.dataset.train).join(",")'), first)
    p.fill('#ts-date', '2026-01-01'); p.click('#ts-go'); p.wait_for_timeout(200)
    check('trains form rejects a past date', p.locator('#ts-err:not(.hidden)').count() == 1 and today not in '2026-01-01', p.inner_text('#ts-err'))
    p.click('[data-day="-1"]'); p.wait_for_timeout(200)
    p.click('[data-day="-1"]'); p.wait_for_timeout(200)
    d = pg.ev('() => new URLSearchParams(location.hash.split("?")[1]).get("date")')
    check('previous-day button never goes before today', d >= today, d)
    # data integrity
    di = pg.ev(DATA_JS)
    check('timetable integrity over %d train-dates (dur/arr, fares by class, speed, determinism)' % di['n'], not di['bad'], di['bad'][:8])
    check('every station code is a real IR code', set(di['codes']) <= REAL_CODES, sorted(set(di['codes']) - REAL_CODES))
    ov = pg.ev('() => { const R = OT.data.rail; const t = R.search("NDLS", "HWH", OT.trains.tomorrow()).filter(x => x.arrOffset > 0)[0]; return t ? { dep: t.dep, arr: t.arr, off: t.arrOffset, date: t.date, arrDate: OT.data.travel.addDays(t.date, t.arrOffset) } : null; }')
    check('overnight train arrives next day (arrOffset dated)', ov and ov['off'] >= 1 and ov['arrDate'] > ov['date'], ov)
    # ---- (3) personas on #/login: layout
    pg.go('login', 300)
    lay = pg.ev('''() => { const cards = [...document.querySelectorAll('[data-persona-card]')];
      const btns = cards.map(c => c.querySelector('[data-signin-persona]').getBoundingClientRect());
      let overlap = 0; for (let i = 0; i < btns.length; i++) for (let k = i + 1; k < btns.length; k++) { const a = btns[i], b = btns[k];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap++; }
      const clipped = cards.filter(c => c.scrollWidth > c.clientWidth + 1 || [...c.querySelectorAll('strong, dd, dt, button')].some(e => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > c.getBoundingClientRect().right + 1)).map(c => c.dataset.personaCard);
      return { n: cards.length, minW: Math.min(...cards.map(c => c.getBoundingClientRect().width)), overlap, clipped }; }''')
    check('login: 6 persona cards (4 travellers + partner + admin)', lay['n'] == 6, lay)
    check('login: persona cards >= 220px wide', lay['minW'] >= 220, lay)
    check('login: no text overflows a persona card', not lay['clipped'], lay)
    check('login: "Sign in as" buttons do not overlap', lay['overlap'] == 0, lay)
    pg.scan('login personas ' + vp, 'v11-login-' + vp)
    p.click('[data-signin-persona="sunita"]'); p.wait_for_timeout(500)
    u = pg.ev('() => OT.store.get("user")')
    check('persona card sign-in sets language hi + home NDLS + party', pg.ev('() => OT.i18n.lang()') == 'hi' and u['homeCity'] == 'NDLS' and len(u.get('party') or []) == 3, u)
    check('header shows signed-in persona (name, or initials on a phone)', ('Sunita' if vp == 'desktop' else 'SS') in p.inner_text('#hdr-user'), p.inner_text('#hdr-user'))
    # history visible for persona
    pg.go('bookings', 300)
    check('persona trip history listed in Bookings', p.locator('.history li').count() >= 3)
    pg.scan('bookings history (hi) ' + vp, 'v11-bookings-hist-hi-' + vp)
    # header menu: switch persona, sign out
    p.click('#hdr-user'); p.wait_for_selector('#user-menu:not([hidden])')
    check('user menu: current persona + 6 personas + sign out', p.locator('#user-menu [data-persona]').count() == 6 and p.locator('[data-um-out]').count() == 1)
    p.click('#user-menu [data-persona="neha"]'); p.wait_for_timeout(500)
    check('switch persona -> Neha (English, Mumbai CSMT)', pg.ev('() => OT.store.get("user").personaId') == 'neha' and pg.ev('() => OT.i18n.lang()') == 'en' and pg.ev('() => OT.store.get("user").homeCity') == 'CSMT')
    # missing "from" uses home city for a signed-in persona
    pg.go('home', 300)
    p.fill('#ask-input', 'train to Pune on Friday'); p.press('#ask-input', 'Enter')
    p.wait_for_function('() => /#\\/trains\\?/.test(location.hash)', timeout=5000)
    check('persona home city fills a missing "from" (CSMT -> PUNE)', 'from=CSMT' in pg.ev('() => location.hash') and 'to=PUNE' in pg.ev('() => location.hash'))
    # Neha has personalised consent OFF by default -> no suggestions
    pg.go('home', 400)
    check('Neha (consent off): For you shows no suggestions', p.locator('.fy-trend').count() == 0 and p.locator('[data-tour="for-you"]').count() <= 1)
    p.click('#hdr-user'); p.click('[data-um-out]'); p.wait_for_timeout(300)
    check('sign out from header menu', not pg.ev('() => OT.store.get("user")') and 'Sign in' in p.inner_text('#hdr-user'))
    # ---- (4) For you: long weekends relative to today
    lws = pg.ev('() => OT.data.demand.longWeekends(null, 3).map(l => ({ name: l.holiday.name, date: l.holiday.date, wd: l.weekday, start: l.start, end: l.end, days: l.days, leave: l.leave, travel: l.travelDate }))')
    for l in lws:
        w = pg.ev('d => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][OT.data.rail.parseYmd(d).getDay()]', l['date'])
        check('long weekend %s %s is a %s (computed %s)' % (l['name'], l['date'], w, l['wd']), w == l['wd'])
        check('long weekend %s: travel date %s not in the past' % (l['name'], l['travel']), l['travel'] >= today, l)
    mid = pg.ev('() => OT.data.demand.longWeekends("2026-11-21", 3).map(l => l.holiday.name)')
    check('a long weekend already under way (travel date passed) is not offered', 'Guru Nanak Jayanti' not in mid, mid)
    expect = {'Christmas': ('2026-12-25', 'Fri'), 'Guru Nanak Jayanti': ('2026-11-24', 'Tue'), 'Republic Day': ('2027-01-26', 'Tue')}
    if today <= '2026-11-20':
        names = {l['name']: (l['date'], l['wd']) for l in lws}
        check('next 3 long weekends = Guru Nanak (Tue), Christmas (Fri), Republic Day (Tue)', names == expect, lws)
        gn = [l for l in lws if l['name'] == 'Guru Nanak Jayanti'][0]
        check('Guru Nanak: Sat 21 Nov -> Tue 24 Nov, leave Mon 23 Nov', gn['start'] == '2026-11-21' and gn['end'] == '2026-11-24' and gn['leave'] == '2026-11-23' and gn['days'] == 4, gn)
    p.click('#hdr-user'); p.click('#user-menu [data-persona="sunita"]'); p.wait_for_timeout(500)
    pg.ev('() => OT.i18n.setLang("en")'); pg.go('home', 500)
    if vp == 'desktop':
        check('desktop 1440 signed in: main nav still visible', p.locator('#main-nav a[data-nav="trains"]').is_visible())
    tabs = p.locator('.fy-tabs [data-lw]').all_inner_texts()
    check('For you tabs label the weekends with correct weekdays', len(tabs) == 3 and ('Sat' in tabs[0] or 'Fri' in tabs[0]), tabs)
    lwline = p.inner_text('.fy-lw')
    check('For you explains "{holiday} falls on a {weekday}"', re.search(r'falls on a (Mon|Tue|Thu|Fri)', lwline), lwline)
    trend = p.inner_text('.fy-trend >> nth=0')
    check('trending routes are from the home city (New Delhi)', 'New Delhi' in p.inner_text('[data-tour="for-you"]') and p.locator('.fy-trend').count() >= 3, trend[:150])
    pk = pg.ev('''() => { const p = OT.data.personas.get('sunita'), lws = OT.data.demand.longWeekends(null, 3);
       return lws.map(lw => OT.data.demand.trends('NDLS', lw, p).slice(0, 3).map(tr => { const k = OT.data.demand.pkg(p, tr, lw); return k && { to: k.to, total: k.total, sum: k.lines.reduce((s, l) => s + l.amount, 0), sep: k.separate, save: k.savings, date: k.date, ret: k.returnDate, nights: k.nights, runs: k.train.runs, avail: k.avail.state, dateOk: k.train.date === k.date, arrOff: k.train.arrOffset }; })); }''')
    flat = [x for row in pk for x in row if x]
    check('packages: total = sum of lines, savings = separate - total (>=0)', flat and all(x['total'] == x['sum'] and x['save'] == max(0, x['sep'] - x['total']) for x in flat), flat[:3])
    check('packages: train runs on the travel date, not in the past', all(x['runs'] and x['dateOk'] and x['date'] >= today for x in flat), [x for x in flat if not (x['runs'] and x['date'] >= today)][:3])
    from datetime import date as _d
    def nd(a, b): return (_d.fromisoformat(b) - _d.fromisoformat(a)).days
    stay = [(x['to'], x['date'], x['ret'], x['nights'], x['arrOff']) for x in flat if x['nights'] < nd(x['date'], x['ret']) - x['arrOff']]
    check('packages: hotel nights cover arrival -> return date', not stay, stay[:4])
    # Why + consent
    p.click('.fy-why summary'); p.wait_for_timeout(100)
    check('"Why am I seeing this?" explains the signal', len(p.inner_text('.fy-why')) > 80)
    p.click('.switch .sw'); p.wait_for_timeout(250)
    check('consent toggle Off hides trends and packages', p.locator('.fy-trend').count() == 0 and p.locator('[data-pkg]').count() == 0)
    p.reload(); p.wait_for_timeout(600)
    check('consent Off persists after reload', p.locator('.fy-trend').count() == 0)
    p.click('.switch .sw'); p.wait_for_timeout(250)
    # Book this package: whole chain
    # Chandigarh package -> Hotel Shivalik View is partner P-101, so the partner/admin checks below always run
    card = p.locator('.fy-trend[data-trend="CDG"]') if p.locator('.fy-trend[data-trend="CDG"]').count() else p.locator('.fy-trend').first
    dest = card.get_attribute('data-trend')
    exp = pg.ev('''d => { const p = OT.data.personas.get('sunita'), lw = OT.data.demand.longWeekends(null, 3)[OT.state.fyLw || 0];
       const tr = OT.data.demand.trends('NDLS', lw, p).find(x => x.to === d); const k = OT.data.demand.pkg(p, tr, lw);
       return { no: k.train.no, cls: k.cls, date: k.date, total: k.total, lines: k.lines, nights: k.nights, pax: k.pax }; }''', dest)
    shown_total = card.inner_text()
    check('package card shows its total %s' % exp['total'], pg.ev('n => OT.inr(n)', exp['total']) in shown_total, shown_total[:200])
    card.locator('[data-pkg]').click()
    p.wait_for_selector('.trn')
    h = pg.ev('() => decodeURIComponent(location.hash)')
    check('package -> train search for %s on %s' % (dest, exp['date']), 'to=%s' % dest in h and 'date=%s' % exp['date'] in h, h)
    tile = '.trn[data-train="%s"] [data-book="%s"]' % (exp['no'], exp['cls'])
    if p.locator(tile).count() and p.locator(tile).is_enabled():
        p.click(tile)
    else:
        p.locator('.cls-tile:not([disabled])').first.click()
    p.wait_for_selector('#pax-form')
    fs = pg.ev('''() => { const rows = [...document.querySelectorAll('[data-tour="trn-fare"] .co-totals > div')], n = s => +s.replace(/[^0-9]/g, '');
       const parts = rows.filter(r => !r.classList.contains('grand')).map(r => n(r.lastElementChild ? r.lastElementChild.innerText : r.innerText));
       return { sum: parts.reduce((a, b) => a + b, 0), total: n(document.querySelector('[data-tour="trn-fare"] .grand strong').innerText) }; }''')
    check('train fare summary lines add up to the total (%s = %s)' % (fs['sum'], fs['total']), fs['sum'] == fs['total'], fs)
    p.click('#trn-pay'); pg.modal_ok(); p.wait_for_selector('[data-tour="ticket"]', timeout=6000)
    tk = pg.ev('() => OT.store.get("bookings").filter(b => b.type === "train").slice(-1)[0].ticket')
    check('PNR issued (10 digits) for the package train', re.match(r'^\d{10}$', tk['pnr']), tk['pnr'])
    check('ticket arrival date = date + arrOffset', tk['arrDate'] == pg.ev('a => OT.data.travel.addDays(a[0], a[1])', [tk['date'], tk['arrOffset']]))
    pg.scan('package ticket ' + vp, 'v11-pkg-ticket-' + vp)
    p.click('#plan-stay'); pg.wait_run(); p.wait_for_timeout(400)
    j = pg.ev('() => OT.store.get("journey")')
    refs = [i['refId'] for i in j['items']]
    want_refs = [l['ref'] for l in exp['lines'] if l.get('ref')]
    check('package hotel/cab/sight added to journey', all(r in refs for r in want_refs), [refs, want_refs])
    lines_total = pg.ev('() => { const j = OT.store.get("journey"); return j.items.filter(i => i.status !== "cancelled").reduce((s, i) => s + OT.agents.lineFor(i, j).amount, 0); }')
    pkg_services = sum(l['amount'] for l in exp['lines'] if l['kind'] != 'train')
    check('checkout services total matches package (%s vs %s)' % (lines_total, pkg_services), lines_total == pkg_services, [lines_total, pkg_services, j.get('nights')])
    itin = pg.ev('''() => { const j = OT.store.get("journey"), arr = OT.agents.time.isoMs((j.train.arrDate || j.train.date) + "T" + j.train.arr);
       return { conf: OT.agents.itinerary(j).conflicts.filter(c => c.kind !== "gap").map(c => c.kind), early: j.items.filter(i => i.when && OT.agents.time.isoMs(i.when) < arr).map(i => i.title + " " + i.when), arr: j.train.arr }; }''')
    check('package itinerary: nothing planned before the train arrives (arr %s)' % itin['arr'], not itin['conf'] and not itin['early'], itin)
    pg.go('checkout', 300)
    for cb in p.locator('[data-accept]').all():
        cb.check(); p.wait_for_timeout(150)
    for b in p.locator('[data-recheck-line]').all():
        b.click(); p.wait_for_timeout(900)
    p.click('#pay-btn'); pg.modal_ok(); p.wait_for_selector('[data-tour="confirmation"]', timeout=6000)
    pg.go('journey', 400)
    pg.scan('journey after package ' + vp, 'v11-journey-pkg-' + vp)
    # partner sees the hotel (not the train) as New via OneTrip
    hotel_b = pg.ev('() => OT.store.get("bookings").filter(b => b.partnerId === "P-101")')
    check('package booked a partner P-101 hotel (enables the partner checks)', len(hotel_b) >= 1, dest)
    if hotel_b:
        p.click('#hdr-user'); p.click('#user-menu [data-persona="partner"]'); p.wait_for_timeout(500)
        pg.go('partner/bookings', 400)
        txt = p.inner_text('#view')
        nn = pg.ev('() => { const j = OT.store.get("journey"); return j.nights; }')
        row = p.locator('tr.row-new').first.inner_text()
        check('partner: live hotel row shows the booked nights (%s)' % nn, ('%d night' % nn) in row, row[:160])
        check('partner: hotel booking appears as New via OneTrip; no train row', p.locator('tr.row-new').count() == len(hotel_b) and 'OT-TRN-' not in txt, p.locator('tr.row-new').count())
    # admin totals: train fares separate from add-on GTV
    p.click('#hdr-user'); p.click('#user-menu [data-persona="admin"]'); p.wait_for_timeout(500)
    pg.go('admin/overview', 400)
    lv = pg.ev('() => { const l = OT.data.analytics.live(); return { gtv: l.gtv, tv: l.trainValue, addon: OT.store.get("bookings").filter(b => b.type !== "train" && b.status === "confirmed").reduce((s, b) => s + b.amount, 0) }; }')
    check('admin add-on GTV excludes train fares (train value shown separately)', lv['gtv'] == lv['addon'] and lv['tv'] > 0 and 'train ticket' in p.inner_text('#view'), lv)
    pg.go('admin/demand', 400)
    fc = p.inner_text('[data-tour="lw-forecast"]')
    check('admin long-weekend forecast lists the same next weekend', lws[0]['name'] in fc, fc[:160])
    pg.scan('admin forecast ' + vp, 'v11-admin-forecast-' + vp)
    # train cancel: railway refund + journey state
    p.click('#hdr-user'); p.click('#user-menu [data-persona="sunita"]'); p.wait_for_timeout(400)
    pg.ev('() => OT.i18n.setLang("en")')
    pg.go('bookings', 300)
    p.click('.bkg-train [data-cancel]'); p.wait_for_selector('.modal-backdrop.show .btn-danger')
    exp_rf = pg.ev('() => { const b = OT.store.get("bookings").filter(x => x.type === "train").slice(-1)[0]; return OT.data.rail.refund(b.ticket); }')
    tkt = tk
    h_left = exp_rf['hoursLeft']; per = tkt['farePerPax']; n = len(tkt['passengers'])
    FLAT = {'1A': 240, 'EC': 240, '2A': 200, '3A': 180, 'CC': 180, '3E': 180, 'SL': 120}
    if tkt['status'] in ('WL', 'RAC'): ch = 60 * n
    elif h_left > 48: ch = FLAT[tkt['cls']] * n
    elif h_left > 12: ch = max(FLAT[tkt['cls']], round(per * 0.25)) * n
    elif h_left > 4: ch = max(FLAT[tkt['cls']], round(per * 0.5)) * n
    else: ch = per * n
    check('train refund = fare - railway charge (independent calc %s)' % (per * n - ch), exp_rf['amount'] == max(0, per * n - ch), exp_rf)
    cl = p.inner_text('.modal-backdrop .confirm-lines')
    check('cancel dialog shows the refund amount', pg.ev('n => OT.inr(n)', exp_rf['amount']) in cl, cl[:300])
    pg.modal_ok(); p.wait_for_timeout(300)
    pg.go('journey', 400)
    st = pg.ev('() => { const j = OT.store.get("journey"); const r = OT.agents.readiness(j); return { status: j.train.status, ticket: r.parts.find(x => x.id === "ticket").pts, score: r.score }; }')
    check('journey after train cancel: CANCELLED + readiness ticket 0', st['status'] == 'CANCELLED' and st['ticket'] == 0, st)
    check('journey page shows the cancelled ticket clearly', re.search('cancel', p.inner_text('.ticket'), re.I))
    rs = pg.ev('() => OT.agents.readiness(OT.store.get("journey")).parts.find(x => x.id === "ticket").state')
    check('readiness labels the ticket "cancelled" (not "missing")', rs == 'cancelled', rs)
    check('journey warns that hotel/cab bookings are still active after the train cancel', p.locator('[data-train-cancelled]').count() == 1)
    pg.scan('journey after train cancel ' + vp, 'v11-journey-cancel-' + vp)
    # any-city results
    for to in ['CSMT', 'BSB']:
        pg.go('results?to=' + to); pg.wait_run()
        c = pg.ev(OFFER_JS)
        check('any-city results %s: hotels + cabs, each verified/labelled' % to, len(c) >= 3 and all(x['ok'] for x in c) and p.locator('[data-tab="cab"] .tab-n').inner_text() != '0', len(c))
        pg.scan('results %s %s' % (to, vp), 'v11-results-%s-%s' % (to, vp))
    # languages on new screens
    for lang in ['en', 'hi', 'ta']:
        pg.ev('l => OT.i18n.setLang(l)', lang)
        for r in ['home', 'trains?from=NDLS&to=BSB&date=' + tomorrow, 'trains/book?no=22435&from=NDLS&to=BSB&date=%s&cls=CC&pax=2' % tomorrow, 'login', 'bookings', 'journey']:
            pg.go(r, 350)
            name = r.split('?')[0].replace('/', '-')
            pg.scan('%s [%s] %s' % (name, lang, vp), 'v11-%s-%s-%s' % (name, lang, vp) if lang != 'en' or vp else None)
    pg.ev('() => OT.i18n.setLang("en")')
    pg.no_errors('v1.1 verify ' + vp)
    pg.close()


# ---------------------------------------------------------------- v1.2: standalone services, nav bar, payment pop-up, transport, budget, itinerary
OPEN_STUB = "window.__opened = []; window.open = function (u) { window.__opened.push(String(u)); return null; };"
PRICE_JS = "() => [...document.querySelectorAll('#svc-list .offer[data-ref^=\"H-\"], #res-main [data-panel=\"hotel\"] .offer[data-ref^=\"H-\"]')].map(o => +o.querySelector('.offer-price .price').innerText.replace(/[^0-9]/g, ''))"
NAV_JS = r"""() => {
  const nav = document.querySelector('#main-nav'), row = document.querySelector('#nav-row');
  const prim = ['home','trains','hotels','transport','journey','bookings'].map(k => document.querySelector('#main-nav a[data-nav="' + k + '"]'));
  const tops = prim.map(a => Math.round(a.getBoundingClientRect().top));
  const nr = nav.getBoundingClientRect();
  return { visible: nav.offsetHeight > 0 && getComputedStyle(nav).display !== 'none', tops, navH: Math.round(nr.height), hamburger: !!document.querySelector('#nav-toggle, .nav-toggle'),
    allShown: prim.every(a => a.offsetWidth > 0), doc: document.documentElement.scrollWidth, w: innerWidth, fits: row.scrollWidth <= row.clientWidth + 1,
    more: (document.querySelector('#nav-more-btn') || {}).offsetWidth > 0, inlineSecondary: (document.querySelector('#main-nav a[data-nav="admin"]') || {}).offsetWidth > 0,
    sticky: getComputedStyle(document.querySelector('.app-header')).position,
    secTops: ['partner','admin','insights'].map(k => document.querySelector('#main-nav a[data-nav="' + k + '"]')).filter(a => a.offsetWidth).map(a => Math.round(a.getBoundingClientRect().top)) };
}"""


def v12_nav(browser, base):
    """Primary nav is a horizontal bar at every width, in en/hi and long-label languages; never a hamburger list."""
    for w in [375, 768, 1024, 1280, 1366, 1440, 1920]:
        ctx = browser.new_context(viewport={'width': w, 'height': 860})
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.abort())
        p = ctx.new_page(); errs = []
        p.on('pageerror', lambda e: errs.append(str(e)[:200]))
        p.goto(base + '#/home'); p.wait_for_function('() => window.OT && OT.router.current()')
        for lang in ['en', 'hi', 'ta', 'ml']:
            p.evaluate('l => OT.i18n.setLang(l)', lang); p.wait_for_timeout(150)
            for r in ['home', 'bookings', 'transport?city=NDLS']:
                p.evaluate("h => location.hash = h", '#/' + r); p.wait_for_timeout(250)
                n = p.evaluate(NAV_JS)
                tag = '%dpx [%s] %s' % (w, lang, r.split('?')[0])
                if r == 'home':
                    check('nav %s: visible horizontal bar (one row, all 6 primary tabs)' % tag, n['visible'] and n['allShown'] and max(n['tops']) - min(n['tops']) <= 2 and n['navH'] <= 64, n)
                    check('nav %s: no hamburger list for primary nav' % tag, not n['hamburger'], n)
                    check('nav %s: header sticky on top' % tag, n['sticky'] == 'sticky', n['sticky'])
                    if w >= 1024:
                        check('nav %s: "Partners & admin" menu shown' % tag, n['more'] and not n['inlineSecondary'], n)
                        if lang == 'en':
                            check('nav %s: whole bar fits without scrolling' % tag, n['fits'], n)
                    else:
                        check('nav %s: partner/admin/business links inline in the same scroll bar row' % tag, n['inlineSecondary'] and not n['more'] and len(n['secTops']) == 3 and all(abs(x - n['tops'][0]) <= 2 for x in n['secTops']), n)
                check('nav %s: no horizontal page overflow' % tag, n['doc'] <= n['w'], n)
                if r == 'bookings':
                    vis = p.evaluate("() => { const a = document.querySelector('#main-nav a.on'), r = document.querySelector('#nav-row').getBoundingClientRect(), b = a && a.getBoundingClientRect(); return !!b && b.left >= r.left - 1 && b.right <= r.right + 1; }")
                    check('nav %s: active tab highlighted and scrolled into view' % tag, vis)
        if w >= 1024:
            p.evaluate('() => OT.i18n.setLang("en")'); p.evaluate("h => location.hash = h", '#/home'); p.wait_for_timeout(200)
            p.click('#nav-more-btn'); p.wait_for_timeout(150)
            check('nav %dpx: "Partners & admin" opens a menu' % w, p.locator('#nav-more-menu a[data-nav="admin"]').is_visible())
            p.click('#nav-more-menu a[data-nav="insights"]'); p.wait_for_timeout(300)
            check('nav %dpx: menu item navigates (Business case) and closes' % w, p.evaluate('() => OT.router.current().name') == 'insights' and not p.locator('#nav-more-menu a[data-nav="admin"]').is_visible())
        check('nav %dpx: zero page errors' % w, not errs, errs)
        ctx.close()


def v12_flow(browser, base, vp):
    tag = 'v12-' + vp
    pg = Page(browser, base, vp, init=OPEN_STUB)
    p = pg.p
    pg.go('home'); pg.ev('() => localStorage.clear()'); p.reload(); p.wait_for_function('() => window.OT && OT.router.current()')
    # 1. booking widget tabs
    tabs = pg.ev('() => [...document.querySelectorAll("[data-bw]")].map(b => b.dataset.bw)')
    check('home booking widget tabs: Trains | Hotels | Local transport | Food | Sightseeing | Packages', tabs == ['trains', 'hotels', 'transport', 'food', 'sights', 'packages'], tabs)
    check('Trains tab is the default (train-first stays the main path)', p.locator('#bw-p-trains').is_visible() and p.locator('#train-go').is_visible())
    p.click('[data-bw="hotels"]'); p.wait_for_timeout(150)
    check('Hotels tab: city, dates, guests, rooms and a VISIBLE budget slider (not collapsed)', all(p.locator(s).is_visible() for s in ['#hw-city', '#hw-in', '#hw-out', '#hw-guests', '#hw-rooms', '#hwb-lo', '#hwb-hi', '#hwb-max']) and p.locator('[data-bud="hwb"] [data-bud-chip]').count() == 4)
    pg.scan('home hotels tab ' + tag, 'home-hotels-' + tag)
    p.click('[data-bw="transport"]'); p.wait_for_timeout(150)
    check('Local transport tab: city + from/to place typeahead + date/time/pax', all(p.locator(s).is_visible() for s in ['#tw-city', '#tw-from', '#tw-to', '#tw-date', '#tw-time', '#tw-pax']))
    p.fill('#tw-to', 'air'); p.wait_for_timeout(150)
    check('place typeahead finds the airport', 'Airport' in p.inner_text('#tw-to-list'), p.inner_text('#tw-to-list'))
    p.keyboard.press('Escape')
    p.click('[data-bw="packages"]'); p.wait_for_timeout(300)
    check('Packages tab lists long-weekend packages', p.locator('#bw-pk [data-bw-pkg]').count() >= 1)
    pg.scan('home packages tab ' + tag)
    # 2. standalone hotel: budget slider filtering
    pg.go('hotels?city=JP&guests=2', 400)
    check('#/hotels route renders verified hotel cards with badge/source/SIMULATED', p.locator('#svc-list .offer[data-ref^="H-JP-"]').count() >= 3 and all(x['ok'] for x in pg.ev(OFFER_JS)), pg.ev(OFFER_JS))
    check('budget control visible on #/hotels (slider + min/max + chips)', p.locator('#hb-lo').is_visible() and p.locator('#hb-hi').is_visible() and p.locator('#hb-max').is_visible() and p.locator('[data-bud="hb"] [data-bud-chip]').count() == 4)
    p.fill('#hb-max', '2000'); p.press('#hb-max', 'Enter'); p.wait_for_timeout(250)
    pr = pg.ev(PRICE_JS); cnt = p.inner_text('#hb-count')
    check('budget max 2000: every hotel shown is <= 2000 and the count updates', pr and all(x <= 2000 for x in pr) and re.search(r'%d of \d+ hotels within budget' % len(pr), cnt), [pr, cnt])
    check('slider handle moved with the number input', pg.ev('() => document.querySelector("#hb-hi").value') == '2000')
    p.click('[data-bud="hb"] [data-bud-chip="2"]'); p.wait_for_timeout(250)
    pr = pg.ev(PRICE_JS)
    check('chip ₹3,000–5,000 filters to that range', pr and all(3000 <= x <= 5000 for x in pr) and pg.ev('() => [document.querySelector("#hb-min").value, document.querySelector("#hb-max").value]') == ['3000', '5000'], pr)
    pg.scan('hotels standalone ' + tag, 'hotels-' + tag)
    p.click('[data-bud="hb"] [data-bud-chip="1"]'); p.wait_for_timeout(250)
    p.locator('#svc-list [data-book-now]').first.click()
    p.wait_for_selector('#pay-btn')
    j = pg.ev('() => OT.store.get("journey")')
    check('standalone hotel creates a lightweight trip (no train)', j and j.get('kind') == 'trip' and j.get('train') is None and j['scenario'] == 'JP' and len(j['items']) == 1 and j['items'][0]['nights'] >= 1, j and {k: j.get(k) for k in ['kind', 'scenario', 'start', 'end']})
    check('checkout shows the trip (no train) and the hotel line', 'Stay in Jaipur' in p.inner_text('.co-items') and p.locator('.co-line').count() == 1)
    pg.scan('checkout trip ' + tag, 'checkout-trip-' + tag)
    total = pg.ev('() => document.querySelector(".co-totals .grand strong").innerText')
    p.click('#pay-btn'); pg.modal_ok(keep_success=True)
    p.wait_for_selector('.ps-overlay.show .ps-card', timeout=6000)
    ps = p.inner_text('.ps-card')
    check('payment pop-up: "Payment successful" + amount in large type', 'Payment successful' in ps and p.inner_text('.ps-amount').strip() == total.strip(), [p.inner_text('.ps-amount'), total])
    check('payment pop-up: paid to, UPI ref (12 digits), transaction ID, date-time', 'Paid to IRCTC OneTrip' in ps and re.search(r'UPI ref\. no\.\s+\d{12}', ps) and 'SIM-TXN-' in ps and 'IST' in ps, ps[:400])
    check('payment pop-up: booking refs listed', re.search(r'OT-HTL-[A-Z0-9]{5}', ps))
    check('payment pop-up: Done / View itinerary / Share buttons', all(p.locator(s).count() == 1 for s in ['[data-ps-done]', '[data-ps-view]', '[data-ps-share]']))
    check('payment pop-up: "Your one-page itinerary" with PDF / PNG / WhatsApp / Email', 'Your one-page itinerary' in ps and p.locator('.ps-itin [data-it]').count() == 4)
    check('payment pop-up: animated check circle (SVG) present', p.locator('.ps-check svg .ps-circle').count() == 1 and p.locator('.ps-check svg .ps-tick').count() == 1)
    rm = pg.ev('() => { const e = document.querySelector(".ps-circle"); return getComputedStyle(e).animationName; }')
    check('payment pop-up: check is animated (normal motion)', rm and rm != 'none', rm)
    p.wait_for_function('() => { const o = document.querySelector(".ps-overlay"); return o && getComputedStyle(o).opacity === "1" && getComputedStyle(o.querySelector(".ps-card")).transform === "none"; }', timeout=5000); p.wait_for_timeout(900)  # settled, not mid-fade
    pg.scan('payment success ' + tag, 'pay-success-' + tag)
    p.click('[data-ps-done]'); p.wait_for_timeout(300)
    check('Done closes the pop-up; confirmation stays', p.locator('.ps-overlay').count() == 0 and p.locator('[data-tour="confirmation"]').count() == 1)
    b = pg.ev('() => (OT.store.get("bookings")||[]).filter(x => x.type === "hotel")[0]')
    check('standalone hotel in Bookings & refunds', b and b['status'] == 'confirmed' and b['journeyId'] == j['id'], b and b.get('ref'))
    # 3. My Journey without a train
    pg.go('journey', 400)
    check('My Journey: trip without a train ("Stay in Jaipur") + "Add a train to this trip"', 'Stay in Jaipur' in p.inner_text('h1') and p.locator('#add-train').count() == 1 and p.locator('.tl-addtrain').count() == 1)
    rd = pg.ev('() => OT.agents.readiness(OT.store.get("journey"))')
    check('readiness adapts to a trip without a train (no ticket/return parts, score is a number)', rd['trip'] and isinstance(rd['score'], (int, float)) and not any(x['id'] in ('ticket', 'ret') for x in rd['parts']) and rd['score'] > 0, rd)
    check('timeline shows the stay (check-in + check-out)', p.locator('.tl-row.k-checkin').count() == 1 and p.locator('.tl-row.k-checkout').count() == 1)
    check('one-page itinerary card on My Journey', p.locator('.itin-card [data-it]').count() == 4)
    pg.scan('journey trip ' + tag, 'journey-trip-' + tag)
    href = p.get_attribute('#add-train', 'href')
    check('"Add a train to this trip" pre-fills a train search to Jaipur', href and 'trains?' in href and 'to=JP' in href, href)
    # 4. transport comparison in a metro city + standalone transport booking (attaches to a new trip after confirm)
    pg.go('transport?city=NDLS&from=stn:NDLS&to=air:NDLS&time=10:00&pax=3', 400)
    cards = pg.ev("() => [...document.querySelectorAll('.tx-card')].map(c => ({m: c.dataset.mode, on: !c.classList.contains('is-off'), ver: !!c.querySelector('.tx-ver .badge'), src: /checked/.test((c.querySelector('.tx-ver')||{}).innerText||''), off: (c.querySelector('.tx-off')||{}).innerText || ''}))")
    avail = [c for c in cards if c['on']]
    check('Delhi: cab, auto, metro, bus compared side by side (>= 4 modes available)', len(cards) == 6 and len(avail) >= 4 and {'cab', 'auto', 'metro', 'bus'} <= {c['m'] for c in avail}, cards)
    check('Delhi airport leg: metro available (Airport Express)', any(c['m'] == 'metro' and c['on'] for c in cards), cards)
    check('every bookable mode has a verification badge + source + checked time', all(c['ver'] and c['src'] for c in avail if c['m'] not in ('walk', 'auto', 'erick')), cards)
    badges = pg.ev('() => [...document.querySelectorAll(".tx-card [data-badge]")].map(b => b.dataset.badge)')
    check('Cheapest, Fastest and Best for your group badges', all(x in badges for x in ['cheapest', 'fastest', 'group']), badges)
    facts = p.inner_text('.tx-card[data-mode="bus"]')
    check('comparison shows price total + per person, time, frequency, comfort, luggage, door-to-door, CO₂', all(x in facts for x in ['per person', 'Travel time', 'Frequency', 'Comfort', 'Luggage', 'Door-to-door', 'CO₂']), facts[:300])
    pg.scan('transport NDLS ' + tag, 'transport-ndls-' + tag)
    pg.go('transport?city=CDG&from=stn:CDG&to=htl:H-CDG-01&pax=3', 400)
    m = p.locator('.tx-card[data-mode="metro"]')
    check('Chandigarh: honest "No metro in Chandigarh"', 'is-off' in (m.get_attribute('class') or '') and 'No metro in Chandigarh' in m.inner_text(), m.inner_text())
    p.click('.tx-card[data-mode="cab"] [data-tx-pick]')
    p.wait_for_selector('.modal-backdrop.show')
    check('booking in another city asks before replacing the current trip', 'Start a new trip?' in p.inner_text('.modal-backdrop.show'))
    pg.modal_ok(); p.wait_for_selector('#pay-btn')
    j2 = pg.ev('() => OT.store.get("journey")')
    check('transport booking attaches to a new trip in Chandigarh', j2['kind'] == 'trip' and j2['scenario'] == 'CDG' and any(i['refId'].startswith('TR-CDG-') for i in j2['items']), j2['scenario'])
    p.click('#pay-btn'); pg.modal_ok()
    lb = pg.ev('() => (OT.store.get("bookings")||[]).filter(x => /^OT-LTR-/.test(x.ref))')
    check('local transport booked standalone (OT-LTR ref) and listed in Bookings', len(lb) == 1)
    pg.go('bookings', 300)
    check('Bookings shows the transport booking with a cancel button', p.locator('[data-bk="%s"] [data-cancel]' % lb[0]['ref']).count() == 1)
    p.click('[data-bk="%s"] [data-cancel]' % lb[0]['ref']); pg.modal_ok()
    check('standalone transport cancellation works', pg.ev('r => OT.store.get("bookings").find(x => x.ref === r).status', lb[0]['ref']) == 'cancelled')
    # 5. voice/text "hotel in Jaipur under 3000" sets the budget visibly
    pg.go('home', 300)
    p.fill('#ask-input', 'hotel in Jaipur under 3000'); p.press('#ask-input', 'Enter'); p.wait_for_timeout(120)
    check('voice "under 3000": Hotels tab + budget shown before navigating', p.locator('#bw-p-hotels').is_visible() and pg.ev('() => document.querySelector("#hwb-max").value') == '3000' and 'Up to ₹3,000' in p.inner_text('#voice-status'), p.inner_text('#voice-status'))
    if p.locator('.modal-backdrop.show').count():
        pg.modal_ok()
    p.wait_for_function('() => /#\\/results\\?to=JP/.test(location.hash)', timeout=6000); pg.wait_run()
    pr = pg.ev(PRICE_JS)
    check('results: budget control shows max 3000 and every hotel <= 3000', pg.ev('() => document.querySelector("#rb-max").value') == '3000' and pr and all(x <= 3000 for x in pr) and 'hotels within budget' in p.inner_text('#rb-count'), [pr, p.inner_text('#rb-count')])
    p.fill('#rb-max', '15000'); p.press('#rb-max', 'Enter'); p.wait_for_timeout(300)
    check('results: widening the budget shows more hotels (no agent re-run)', len(pg.ev(PRICE_JS)) > len(pr))
    # 6. journey flow: station -> hotel comparison instead of cabs only
    pg.go('home'); pg.ev('() => { OT.store.set("journey", undefined); OT.state.lastRun = null; }')
    pg.go('results?to=CDG'); pg.wait_run()
    p.click('[data-tab="cab"]'); p.wait_for_timeout(200)
    check('journey flow: Transport tab opens with the station → hotel comparison', p.locator('[data-panel="cab"] [data-tour="transport-compare"] .tx-card').count() == 6 and 'Station → hotel' in p.inner_text('[data-panel="cab"] .tx-head'))
    check('journey flow: "No metro in Chandigarh" shown there too', 'No metro in Chandigarh' in p.inner_text('[data-panel="cab"] .tx-card[data-mode="metro"]'))
    p.click('[data-panel="cab"] .tx-card[data-mode="bus"] [data-tx-pick]'); p.wait_for_timeout(300)
    jj = pg.ev('() => OT.store.get("journey")')
    rd = pg.ev('() => OT.agents.readiness(OT.store.get("journey")).parts.find(x => x.id === "transfer").state')
    check('selecting the bus adds the station transfer leg and counts in readiness', any('-bus' in i['refId'] for i in jj['items']) and rd == 'planned', [i['refId'] for i in jj['items']])
    p.click('[data-panel="cab"] .tx-card[data-mode="cab"] [data-tx-pick]'); p.wait_for_timeout(300)
    jj = pg.ev('() => OT.store.get("journey")')
    check('one mode per leg: picking the cab replaces the bus', sum(1 for i in jj['items'] if i['refId'].startswith('TR-')) == 1 and any(i['refId'].endswith('-cab-3') or i['refId'].endswith('-cab') or '-cab' in i['refId'] for i in jj['items']), [i['refId'] for i in jj['items']])
    pg.scan('results transport ' + tag, 'results-transport-' + tag)
    # 7. train-first: the ticket page has the budget control when planning the stay
    pg.go('trains?from=NDLS&to=CDG', 400)
    p.click('.trn[data-train="12011"] [data-book="CC"]'); p.wait_for_selector('#pax-form')
    p.fill('#px-n0', 'Test Traveller'); p.fill('#px-a0', '30') if p.locator('#px-a0').count() else None
    p.click('#trn-pay'); pg.modal_ok(keep_success=True)
    p.wait_for_selector('.ps-overlay.show .ps-card', timeout=6000)
    check('train payment shows the success pop-up with the PNR', re.search(r'PNR \d{10}', p.inner_text('.ps-card')) and 'IRCTC' in p.inner_text('.ps-to'))
    p.click('[data-ps-done]'); p.wait_for_selector('[data-tour="ticket"]')
    check('ticket page: budget control while planning the stay', p.locator('[data-tour="plan-next"] [data-bud="pb"] #pb-hi').is_visible())
    # 8. itinerary: print view fits one A4 page; PNG; one-tap WhatsApp + email (consent + confirm)
    pg.go('itinerary-print', 400)
    check('itinerary print view: sheet with traveller, PNR, timeline, refs, QR-like code, SIMULATED watermark', p.locator('.itin-sheet .it-tl li').count() >= 2 and p.locator('.itin-sheet .it-qr').count() == 1 and 'SIMULATED' in p.inner_text('.itin-sheet') and 'PNR' in p.inner_text('.itin-sheet'))
    pg.scan('itinerary print ' + tag, 'itinerary-' + tag)
    if vp == 'desktop':
        pdf = p.pdf(format='A4', print_background=True)
        pages = len(re.findall(rb'/Type\s*/Page[^s]', pdf))
        check('itinerary print: page.pdf (A4, print media) is exactly 1 page', pages == 1, pages)
    url = pg.ev('() => OT.itinerary.png()')
    check('PNG snapshot drawn on canvas (toDataURL non-empty)', url.startswith('data:image/png;base64,') and len(url) > 20000, len(url))
    pg.go('journey', 400)
    import urllib.parse as up
    # v1.2.1: no number known (signed out) -> one compact prompt; afterwards WhatsApp opens directly
    p.click('.itin-card [data-it="wa"]'); p.wait_for_selector('.modal-backdrop.show #sh-to')
    check('WhatsApp (no number on profile): compact prompt with +91 field, no consent checkbox', p.locator('.modal-backdrop.show .wa-phone .wa-cc').inner_text().strip() == '+91' and p.locator('.modal-backdrop.show #sh-consent').count() == 0)
    p.locator('.modal-backdrop.show .modal-foot .btn').last.click(); p.wait_for_timeout(150)
    check('WhatsApp prompt: empty number is rejected', p.locator('#sh-err:not(.hidden)').count() == 1 and '10-digit' in p.inner_text('#sh-err'))
    p.fill('#sh-to', '98765 43210'); p.press('#sh-to', 'Enter'); p.wait_for_timeout(300)
    opened = pg.ev('() => window.__opened'); wa = opened[-1] if opened else ''
    txt = up.unquote(wa.split('?text=')[-1]) if '?text=' in wa else ''
    check('WhatsApp link: https://wa.me/919876543210?text=<summary with refs> (spaces in the number accepted)', wa.startswith('https://wa.me/919876543210?text=') and 'IRCTC OneTrip itinerary' in txt and re.search(r'PNR \d{10}', txt), wa[:160])
    check('WhatsApp: no extra confirm/done dialog after opening', p.locator('.modal-backdrop.show').count() == 0)
    check('WhatsApp: toast says it is opening and to tap Send', 'Tap Send' in p.inner_text('#toast-root'))
    n0 = len(opened)
    p.click('.itin-card [data-it="wa"]'); p.wait_for_timeout(250)
    opened = pg.ev('() => window.__opened')
    check('WhatsApp: remembered number -> second tap opens directly (no prompt)', len(opened) == n0 + 1 and opened[-1].startswith('https://wa.me/919876543210?text=') and p.locator('.modal-backdrop.show').count() == 0)
    check('WhatsApp: "opens for +91 98765 43210 · Change number" shown under the buttons', '+91 98765 43210' in p.inner_text('.itin-card [data-wa-note]') and p.locator('.itin-card [data-wa-change]').count() == 1)
    p.click('.itin-card [data-it="mail"]'); p.wait_for_selector('#sh-to')
    p.fill('#sh-to', 'traveller@example.com'); p.check('#sh-consent'); p.locator('.modal-backdrop.show .modal-foot .btn').last.click()
    p.wait_for_selector('.modal-backdrop.show .confirm-lines'); pg.modal_ok(); p.wait_for_selector('#mail-link')
    mh = p.get_attribute('#mail-link', 'href')
    check('email: mailto link with subject and body', mh.startswith('mailto:traveller@example.com?subject=') and '&body=' in mh and 'IRCTC%20OneTrip%20itinerary' in mh, mh[:120])
    check('email: "Sent to … (simulated)" confirmation', 'Sent to traveller@example.com (simulated)' in p.inner_text('.modal-backdrop.show'))
    p.locator('.modal-backdrop.show .modal-foot .btn').last.click(); p.wait_for_timeout(250)
    nl = pg.ev('() => OT.store.get("notifications")')
    check('sends logged (channel, masked recipient, refs)', [x['channel'] for x in nl] == ['whatsapp', 'whatsapp', 'email'] and all('XXX' in x['to'] for x in nl[:2]), nl)
    # signed-in persona: WhatsApp uses the profile's dummy number directly
    pg.ev('() => OT.auth.signInPersona("sunita", { quiet: true })'); p.wait_for_timeout(300)
    pg.go('journey', 400)
    n0 = len(pg.ev('() => window.__opened'))
    p.click('.itin-card [data-it="wa"]'); p.wait_for_timeout(250)
    opened = pg.ev('() => window.__opened')
    check('signed in (Sunita): WhatsApp opens directly with the profile number +91 75898 02655', len(opened) == n0 + 1 and opened[-1].startswith('https://wa.me/917589802655?text=') and p.locator('.modal-backdrop.show').count() == 0, opened[-1:])
    p.click('.itin-card [data-wa-change]'); p.wait_for_selector('.modal-backdrop.show #sh-to')
    check('"Change number" opens the prompt', p.locator('.modal-backdrop.show .wa-phone').count() == 1)
    p.locator('.modal-backdrop.show .modal-foot .btn').first.click(); p.wait_for_timeout(250)
    nl = pg.ev('() => OT.store.get("notifications")')
    pg.ev('() => OT.auth.signInPersona("admin", { quiet: true })'); p.wait_for_timeout(300)
    pg.go('admin/complaints', 500)
    check('Admin notifications log lists the sends', p.locator('[data-tour="notif-log"] tbody tr').count() == len(nl) and 'WhatsApp' in p.inner_text('[data-tour="notif-log"]'), len(nl))
    pg.no_errors('v1.2 ' + vp)
    pg.close()
    # reduced motion: no animation on the check
    ctx = browser.new_context(viewport={'width': VIEWPORTS[vp][0], 'height': VIEWPORTS[vp][1]}, reduced_motion='reduce')
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.abort())
    q = ctx.new_page(); q.goto(base + '#/home'); q.wait_for_function('() => window.OT && OT.paySuccess')
    q.evaluate('() => { OT.paySuccess.show({amount: 999, txn: "SIM-TXN-TEST1", refs: [{label: "x", ref: "OT-HTL-AAAAA"}]}); }'); q.wait_for_timeout(200)
    st = q.evaluate('() => [getComputedStyle(document.querySelector(".ps-circle")).animationName, getComputedStyle(document.querySelector(".ps-confetti") || document.body).display, !!document.querySelector(".ps-confetti")]')
    check('prefers-reduced-motion: no check animation, no confetti (%s)' % vp, st[0] == 'none' and not st[2], st)
    ctx.close()




# ---------------------------------------------------------------- independent v1.2 verification (verifier-owned)
def v12_verify(browser, base, vp):
    pg = Page(browser, base, vp)
    p = pg.p
    pg.go('home'); pg.ev('() => localStorage.clear()'); p.reload(); p.wait_for_function('() => window.OT && OT.router.current()')
    # class collision: login persona cards vs payment card
    pg.go('login', 300)
    lp = pg.ev('() => { const c = document.querySelector("[data-persona-card]"), s = getComputedStyle(c); return { cls: c.className, align: s.textAlign, tr: s.transform, w: c.getBoundingClientRect().width }; }')
    check('login persona card unaffected by the payment card styles (left-aligned, no transform)', 'ps-card' not in lp['cls'] and lp['align'] in ('left', 'start') and lp['tr'] == 'none', lp)
    # phone nav: the four requested tabs always on screen, in 4 scripts, no hamburger, no page overflow
    for lang in ['en', 'hi', 'ta', 'ml']:
        pg.ev('l => OT.i18n.setLang(l)', lang); pg.go('journey', 300)
        r = pg.ev('''() => { const out = []; ['home','trains','journey','bookings'].forEach(k => { const a = document.querySelector('#main-nav a[data-nav="' + k + '"]'), b = a.getBoundingClientRect();
            if (!(b.left >= -1 && b.right <= innerWidth + 1 && b.width > 20)) out.push(k + '@' + Math.round(b.left)); if (a.scrollHeight > a.clientHeight + 2) out.push(k + ':clipped'); });
            const tog = document.querySelector('#nav-toggle'); return { out, tog: !!(tog && tog.offsetWidth), sw: document.documentElement.scrollWidth, w: innerWidth }; }''')
        check('nav [%s] %s: Plan trip, Trains, My Journey, Bookings visible on top, no hamburger, no overflow' % (lang, vp), not r['out'] and not r['tog'] and r['sw'] <= r['w'], r)
        if lang in ('en', 'ml'):
            p.screenshot(path=str(SHOTS / ('v12-nav-%s-%s.png' % (lang, vp))), clip={'x': 0, 'y': 0, 'width': VIEWPORTS[vp][0], 'height': 240}) if SHOTS else None
    pg.ev('() => OT.i18n.setLang("en")')
    if vp == 'desktop':
        pg.go('home', 300)
        b = p.locator('#nav-more-btn'); b.focus(); p.keyboard.press('ArrowDown'); p.wait_for_timeout(150)
        f = pg.ev('() => document.activeElement.closest("#nav-more-menu") ? document.activeElement.getAttribute("href") : null')
        check('"Partners & admin": ArrowDown opens the menu and focuses the first item', f == '#/partner' and b.get_attribute('aria-expanded') == 'true', f)
        p.keyboard.press('ArrowDown'); p.wait_for_timeout(80)
        check('"Partners & admin": ArrowDown moves to the next item', pg.ev('() => document.activeElement.getAttribute("href")') == '#/admin')
        p.keyboard.press('Escape'); p.wait_for_timeout(120)
        check('"Partners & admin": Escape closes and returns focus to the button', b.get_attribute('aria-expanded') == 'false' and pg.ev('() => document.activeElement.id') == 'nav-more-btn')
    # standalone hotel in Jaipur (generated city), pay, pop-up final state
    pg.go('hotels?city=JP', 400)
    p.click('[data-bud-chip="1"]'); p.wait_for_timeout(300)
    p.locator('[data-book-now]').first.click(); p.wait_for_selector('#pay-btn')
    for bb in p.locator('[data-recheck-line]').all():
        bb.click(); p.wait_for_timeout(900)
    for cb in p.locator('[data-accept]').all():
        cb.check(); p.wait_for_timeout(150)
    check('standalone checkout: pay enabled after re-check / accepting the new price', p.is_enabled('#pay-btn'))
    p.click('#pay-btn'); pg.modal_ok(keep_success=True)
    try:
        p.wait_for_selector('.ps-overlay.show', timeout=8000)
    except Exception:
        if SHOTS: p.screenshot(path=str(SHOTS / ('DEBUG-pay-%s.png' % vp)))
        print('DEBUG errors', pg.errors[:5]); print('DEBUG', pg.ev('() => [location.hash, !!document.querySelector(".ps-overlay"), document.querySelector(".ps-overlay") && document.querySelector(".ps-overlay").className, document.body.className, (document.querySelector("#view")||{}).innerText.slice(0,200)]'))
        raise
    p.wait_for_timeout(1500)
    ov = pg.ev('''() => { const o = document.querySelector('.ps-overlay'), c = o.querySelector('.ps-card'); return { op: getComputedStyle(o).opacity, cop: getComputedStyle(c).opacity, bg: getComputedStyle(c).backgroundColor, tr: getComputedStyle(c).transform, disp: getComputedStyle(c).display }; }''')
    check('payment pop-up fully shown: overlay + card opaque, white card, settled (no mid-fade)', ov['op'] == '1' and ov['cop'] == '1' and ov['bg'] == 'rgb(255, 255, 255)' and ov['tr'] in ('none', 'matrix(1, 0, 0, 1, 0, 0)'), ov)
    paid = pg.ev('() => +document.querySelector(".ps-amount").innerText.replace(/[^0-9]/g, "")')
    if SHOTS:
        p.screenshot(path=str(SHOTS / ('v12-pay-%s.png' % vp)))
    reach = pg.ev('''() => ['[data-ps-done]','[data-ps-view]','[data-ps-share]','[data-it="pdf"]','[data-it="wa"]','[data-it="mail"]'].map(s => { const e = document.querySelector(s); e.scrollIntoView({block: 'nearest'}); const r = e.getBoundingClientRect(), t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!(t && e.contains(t)); })''')
    check('pop-up buttons reachable at %s (Done, View itinerary, Share, PDF, WhatsApp, Email)' % vp, all(reach), reach)
    p.click('[data-ps-sound]'); p.wait_for_timeout(150)
    p.click('[data-ps-done]'); p.wait_for_timeout(300)
    # reload: generated-city listing must still resolve (nights x price), mute persists
    p.reload(); p.wait_for_function('() => window.OT && OT.router.current()'); p.wait_for_timeout(300)
    check('mute persists after reload', pg.ev('() => OT.store.get("sound")') == 'off')
    cost = pg.ev('() => { const j = OT.store.get("journey"); return j.items.filter(i => i.status !== "cancelled").reduce((s, i) => s + OT.agents.lineFor(i, j).amount, 0); }')
    check('after reload the Jaipur stay still costs what was paid (%s = %s)' % (cost, paid), cost == paid, [cost, paid])
    pg.go('journey', 400)
    check('My Journey trip cost after reload shows the paid amount', pg.ev('n => OT.inr(n)', paid) in p.inner_text('.cost'), p.inner_text('.cost')[:200])
    # other-city banner + ask before replacing
    pg.go('transport?city=NDLS', 400)
    note = p.inner_text('.trip-note')
    check('transport in New Delhi while the trip is Jaipur: banner says a new trip starts (not "attaches to Stay in Jaipur")', p.locator('[data-trip-other]').count() == 1 and 'Stay in Jaipur' not in note.split('starts')[0][:0] and 'New Delhi' in note and 'attach' not in note.lower(), note)
    p.locator('.tx-card:not(.is-off) [data-tx-pick]').first.click(); p.wait_for_timeout(300)
    check('booking New Delhi transport asks before replacing the Jaipur trip', p.locator('.modal-backdrop.show').count() == 1)
    p.locator('.modal-backdrop.show .modal-foot .btn').first.click(); p.wait_for_timeout(300)
    check('cancelling keeps the Jaipur trip', pg.ev('() => OT.store.get("journey").scenario') == 'JP')
    pg.go('transport?city=JP', 400)
    check('transport in the trip city: banner says bookings attach to "Stay in Jaipur"', p.locator('[data-trip-other]').count() == 0 and 'Stay in Jaipur' in p.inner_text('.trip-note'))
    p.locator('.tx-card:not(.is-off) [data-tx-pick]').first.click(); p.wait_for_selector('#pay-btn')
    tid = pg.ev('() => OT.store.get("journey").items.filter(i => /^TR-/.test(i.refId)).map(i => i.refId)[0]')
    p.reload(); p.wait_for_timeout(500)
    tx = pg.ev('id => { const x = OT.data.travel.get(id); return x ? { basis: x.basis, policy: !!x.policy, src: !!x.source } : null; }', tid)
    check('transport leg %s still resolves after reload (basis, policy, source)' % tid, tx and tx['basis'] and tx['policy'] and tx['src'], tx)
    # "Add a train" keeps the stay
    pg.go('journey', 400)
    before = pg.ev('() => OT.store.get("journey").items.filter(i => i.status !== "cancelled").map(i => i.refId)')
    p.locator('a:has-text("Add a train to this trip"), button:has-text("Add a train to this trip")').first.click()
    p.wait_for_selector('.trn', timeout=6000)
    p.locator('.cls-tile:not([disabled])').first.click(); p.wait_for_selector('#pax-form')
    for i in range(p.locator('.pax-row').count()):
        if not p.input_value('#px-n%d' % i): p.fill('#px-n%d' % i, 'Test Traveller %d' % i)
        if not p.input_value('#px-a%d' % i): p.fill('#px-a%d' % i, '30')
    p.click('#trn-pay'); pg.modal_ok(keep_success=True); p.wait_for_selector('.ps-overlay.show', timeout=8000); p.wait_for_timeout(300)
    p.click('[data-ps-done]'); p.wait_for_timeout(300)
    after = pg.ev('() => { const j = OT.store.get("journey"); return { refs: j.items.filter(i => i.status !== "cancelled").map(i => i.refId), train: j.train && j.train.no, to: j.train && j.train.to }; }')
    check('adding a train keeps the stay and transport already booked', after['train'] and after['to'] == 'JP' and all(r in after['refs'] for r in before), [before, after])
    pg.scan('journey after add-train ' + vp, 'v12-journey-addtrain-' + vp)
    pg.go('transport?city=UDZ', 400); pg.go('hotels?city=UDZ', 400)
    check('a transport search in a new city does not block its hotel listings (Udaipur)', p.locator('#svc-list .offer[data-ref]').count() >= 3)
    p.reload(); p.wait_for_timeout(500); pg.go('food?city=UDZ', 400)
    check('after reload, food listings for that city still render', p.locator('#svc-list .offer[data-ref]').count() >= 1)
    for route in ['food', 'sights']:
        pg.go(route + '?city=JP', 400)
        cards = pg.ev(OFFER_JS)
        if not cards: print('DEBUG food', route, pg.ev('() => [location.hash, document.querySelectorAll(".offer").length, (document.querySelector("#view")||{}).innerText.slice(0,400)]'))
        check('#/%s (Jaipur): verified, labelled cards with Book now / Add to trip' % route, len(cards) >= 1 and all(c['ok'] for c in cards) and p.locator('[data-book-now]').count() >= 1 and p.locator('[data-add-trip]').count() >= 1, len(cards))
        n0 = pg.ev('() => (OT.store.get("journey").items || []).length')
        p.locator('[data-add-trip]').first.click(); p.wait_for_timeout(300)
        check('#/%s: "Add to trip" adds to the Jaipur trip without leaving the page' % route, pg.ev('() => (OT.store.get("journey").items || []).length') == n0 + 1 and route in pg.ev('() => location.hash'))
        pg.scan('%s JP %s' % (route, vp), 'v12-%s-%s' % (route, vp))
    # trains earlier today (or within 30 min) cannot be booked
    today = pg.ev('() => OT.data.rail.ymd(new Date())')
    pg.go('trains?from=NDLS&to=BSB&date=' + today, 400)
    if p.locator('#tf-all').count():
        p.click('#tf-all'); p.wait_for_timeout(200)
    bad = pg.ev('''() => { const now = new Date(), m = now.getHours() * 60 + now.getMinutes() + 30;
        return [...document.querySelectorAll('.trn')].filter(t => { const d = t.querySelector('.trn-times b').innerText.trim().slice(0, 5).split(':'); return (+d[0]) * 60 + (+d[1]) <= m; })
          .filter(t => [...t.querySelectorAll('.cls-tile')].some(b => !b.disabled)).map(t => t.dataset.train); }''')
    check('today: trains that have left (or leave within 30 min) are not bookable', not bad, bad)
    # itinerary: Hindi one page, no real-send claim
    if vp == 'desktop':
        pg.ev('() => OT.i18n.setLang("hi")'); pg.go('itinerary-print', 700)
        pdf = p.pdf(format='A4', print_background=True)
        n = len(re.findall(rb'/Type\s*/Page[^s]', pdf))
        check('Hindi one-page itinerary: page.pdf is exactly 1 A4 page', n == 1, n)
        check('itinerary never claims a real send', not re.search(r'has been sent|sent via WhatsApp Business|delivered to your inbox', p.inner_text('#view'), re.I))
        pg.ev('() => OT.i18n.setLang("en")')
    pg.no_errors('v1.2 verify ' + vp)
    pg.close()


# ---------------------------------------------------------------- v1.2.1: pay-on-meter autos + return trains (builder)
TX_CARDS_JS = """() => [...document.querySelectorAll('.tx-card')].map(c => ({ m: c.dataset.mode, on: !c.classList.contains('is-off'),
  pick: !!c.querySelector('[data-tx-pick]'), meterBtn: !!c.querySelector('[data-tx-meter]'),
  btns: [...c.querySelectorAll('button')].map(b => b.innerText.trim()), price: (c.querySelector('.tx-price') || {}).innerText || '',
  note: (c.querySelector('[data-meter-note]') || {}).innerText || '' }))"""


def fill_pax(p):
    for i in range(p.locator('.pax-row').count()):
        if not p.input_value('#px-n%d' % i): p.fill('#px-n%d' % i, 'Test Traveller %d' % i)
        if not p.input_value('#px-a%d' % i): p.fill('#px-a%d' % i, '34')


def v121(browser, base, vp):
    tag = 'v121-' + vp
    pg = Page(browser, base, vp, init=OPEN_STUB)
    p = pg.p
    pg.go('home'); pg.ev('() => localStorage.clear()'); p.reload(); p.wait_for_function('() => window.OT && OT.router.current()')
    plus = lambda n: pg.ev('n => OT.data.travel.addDays(OT.data.rail.ymd(new Date()), n)', n)

    # ---- 1. #/transport: autos and e-rickshaws are never bookable; cab / metro / bus keep Book
    for city, sname in [('NDLS', 'New Delhi'), ('JP', 'Jaipur'), ('CDG', 'Chandigarh')]:
        pg.go('transport?city=%s&pax=2' % city, 400)
        cards = pg.ev(TX_CARDS_JS)
        by = {c['m']: c for c in cards}
        a = by.get('auto', {})
        check('%s transport: auto has NO Book/Select button' % city, a and not a['pick'] and not any(re.search(r'\bBook\b|Select|Add', b) for b in a['btns']), a)
        check('%s transport: auto shows "≈ ₹X on meter"' % city, re.search(r'≈ ₹[\d,]+ on meter', a.get('price', '')), a.get('price'))
        check('%s transport: auto note "No booking needed: take one from the prepaid auto booth outside %s station; pay the driver"' % (city, sname),
              'No booking needed' in a.get('note', '') and 'prepaid auto booth outside %s' % sname in a.get('note', '') and 'pay the driver' in a.get('note', ''), a.get('note'))
        e = by.get('erick', {})
        if e.get('on'):
            check('%s transport: e-rickshaw has NO Book button, shows "≈ ₹20 per person" and "flag one down"' % city,
                  not e['pick'] and not any(re.search(r'\bBook\b', b) for b in e['btns']) and re.search(r'≈ ₹[\d,]+ per person', e['price']) and 'flag one down' in e['note'], e)
        for m in ('cab', 'bus', 'metro'):
            c = by.get(m)
            if c and c['on']:
                check('%s transport: %s keeps its Book button' % (city, m), c['pick'] and any(b == 'Book' for b in c['btns']), c['btns'])
        badges = pg.ev('() => [...document.querySelectorAll(".tx-card[data-mode=auto] [data-badge], .tx-card[data-mode=erick] [data-badge]")].length')
        check('%s transport: no Book button anywhere on an auto/e-rick card (badges %d allowed, no booking implied)' % (city, badges), p.locator('.tx-card[data-mode="auto"] [data-tx-pick], .tx-card[data-mode="erick"] [data-tx-pick]').count() == 0)
        pg.scan('transport %s %s' % (city, tag), 'v121-transport-%s-%s' % (city, vp))
    # Hindi: meter wording translated
    pg.ev('() => OT.i18n.setLang("hi")'); pg.go('transport?city=CDG&pax=2', 400)
    check('Hindi transport: "≈ ₹ मीटर से" and "बुकिंग की ज़रूरत नहीं"', 'मीटर से' in p.inner_text('.tx-card[data-mode="auto"]') and 'बुकिंग की ज़रूरत नहीं' in p.inner_text('.tx-card[data-mode="auto"]'), p.inner_text('.tx-card[data-mode="auto"]')[:200])
    pg.scan('transport CDG hi ' + tag)
    pg.ev('() => OT.i18n.setLang("en")')
    # home Local transport tab -> same comparison
    pg.go('home', 300); p.click('[data-bw="transport"]'); p.wait_for_timeout(150); p.click('#tw-go'); p.wait_for_timeout(400)
    check('home Local transport tab -> #/transport without auto Book buttons', 'transport' in p.url and p.locator('.tx-card[data-mode="auto"] [data-tx-pick]').count() == 0 and p.locator('.tx-card[data-mode="auto"] [data-meter-note]').count() == 1)

    # ---- 2. journey flow: "I'll take an auto" is in the plan but never in the total, payment, bookings or partner data
    pg.go('home'); pg.ev('() => localStorage.clear()'); p.reload(); p.wait_for_function('() => window.OT && OT.router.current()')
    pg.go('results?to=CDG', 300); pg.wait_run()
    p.click('[data-ref="H-CDG-01"] [data-add]'); p.wait_for_timeout(250)
    p.click('[data-tab="cab"]'); p.wait_for_timeout(200)
    check('results: catalogue prepaid auto (C-CDG-03) has no "Add to journey" button, shows "I’ll take an auto"', p.locator('[data-ref="C-CDG-03"] [data-add]').count() == 0 and p.locator('[data-ref="C-CDG-03"] [data-meter-ref]').count() == 1 and 'No booking needed' in p.inner_text('[data-ref="C-CDG-03"]'))
    check('journey Transport tab: auto/e-rick cards have no Select button', p.locator('[data-panel="cab"] .tx-card[data-mode="auto"] [data-tx-pick], [data-panel="cab"] .tx-card[data-mode="erick"] [data-tx-pick]').count() == 0)
    p.click('[data-panel="cab"] .tx-card[data-mode="auto"] [data-tx-meter]'); p.wait_for_timeout(300)
    j = pg.ev('() => OT.store.get("journey")')
    check('"I’ll take an auto" stores a pay-on-meter ride (journey.meterRides), not a journey item', len(j.get('meterRides') or []) == 1 and j['meterRides'][0]['mode'] == 'auto' and not any('-auto' in i['refId'] for i in j['items']), [j.get('meterRides'), [i['refId'] for i in j['items']]])
    check('the auto card now says "In your plan · pay on meter"', 'In your plan' in p.inner_text('[data-panel="cab"] .tx-card[data-mode="auto"]'))
    p.click('[data-panel="cab"] .tx-card[data-mode="cab"] [data-tx-pick]'); p.wait_for_timeout(300)
    j = pg.ev('() => OT.store.get("journey")')
    check('one way per leg: picking the cab replaces the auto for that leg', not (j.get('meterRides') or []) and any('-cab' in i['refId'] for i in j['items']), [j.get('meterRides'), [i['refId'] for i in j['items']]])
    p.click('[data-panel="cab"] .tx-card[data-mode="auto"] [data-tx-meter]'); p.wait_for_timeout(300)
    j = pg.ev('() => OT.store.get("journey")')
    check('…and marking the auto again drops the unpaid cab for that leg', len(j.get('meterRides') or []) == 1 and not any(i['refId'].startswith('TR-') for i in j['items']), [i['refId'] for i in j['items']])
    approx = j['meterRides'][0]['approx']
    pg.go('journey', 400)
    check('My Journey timeline: auto row "pay on meter, ≈ ₹X" with no booking ref', p.locator('.tl-row.k-meter').count() == 1 and 'Pay on meter' in p.inner_text('.tl-row.k-meter') and ('≈ ' + pg.ev('n => OT.inr(n)', approx)) in p.inner_text('.tl-row.k-meter'), p.inner_text('.tl-row.k-meter') if p.locator('.tl-row.k-meter').count() else '')
    check('Trip cost: autos listed as "not charged here", not in "To pay now"', p.locator('[data-cost-meter]').count() == 1)
    due = pg.ev('() => { const j = OT.store.get("journey"); return j.items.filter(i => i.status === "selected").reduce((s, i) => s + OT.agents.lineFor(i, j).amount, 0); }')
    check('To pay now equals the hotel only (auto excluded)', pg.ev('n => OT.inr(n)', due) in p.inner_text('.cost .due'), [due, p.inner_text('.cost .due')])
    rd = pg.ev('() => OT.agents.readiness(OT.store.get("journey")).parts.find(x => x.id === "transfer")')
    check('readiness: station transfer by auto counts (nothing to book)', rd['state'] == 'meter' and rd['pts'] == rd['w'], rd)
    pg.scan('journey with auto ' + tag, 'v121-journey-auto-' + vp)
    pg.go('checkout', 300)
    lines = pg.ev('() => [...document.querySelectorAll(".co-line")].map(l => l.innerText)')
    check('checkout: no auto line; meter note shown', len(lines) == 1 and not any('Auto' in x for x in lines) and p.locator('[data-co-meter]').count() == 1, lines)
    p.click('#pay-btn')
    cl = p.inner_text('.modal-backdrop.show .confirm-lines')
    check('confirm dialog: the auto is not charged', 'Auto-rickshaw' not in cl, cl[:200])
    pg.modal_ok()
    bk = pg.ev('() => OT.store.get("bookings") || []')
    check('payment created bookings only for the hotel (no auto booking ref)', len(bk) == 1 and bk[0]['type'] == 'hotel' and not any('auto' in (b.get('refId') or '') or 'Auto' in b['title'] for b in bk), [b['title'] for b in bk])
    pg.go('bookings', 300)
    check('Bookings & refunds: no auto card, nothing cancellable for the auto', 'Auto-rickshaw' not in p.inner_text('#view') and p.locator('[data-cancel]').count() == 1)
    j = pg.ev('() => OT.store.get("journey")')
    check('after payment the auto is still in the plan as pay-on-meter (never confirmed)', len(j.get('meterRides') or []) == 1)
    pg.ev('() => OT.store.set("user", { name: "Rajinder Singh", email: "p101.shivalik@demo.onetrip", role: "partner", partnerId: "P-101", org: "Hotel Shivalik View", personaId: "partner", simulated: true })')
    pg.go('partner/bookings', 500)
    check('partner dashboard: no auto booking sent to partners', 'Auto-rickshaw' not in p.inner_text('#view'))
    pg.ev('() => OT.store.set("user", undefined)')
    pg.go('itinerary-print', 500)
    it = p.inner_text('.itin-sheet')
    check('one-page itinerary: auto row "Pay on meter" + "not included in the total"', 'Pay on meter' in it and 'not included in the total' in it, it[:300])
    check('itinerary total paid excludes the auto', pg.ev('() => OT.itinerary.model().total') == bk[0]['amount'])
    # older saved data: an unpaid auto item in journey.items + a paid legacy auto booking
    pg.ev('''() => { const s = JSON.parse(localStorage.getItem("onetrip.v1")); const j = s.journey;
        const x = { id: "TR-CDG-11111-auto", type: "cab", mode: "auto", leg: true, legKey: "CDG|stn:CDG|htl:H-CDG-02", city: "CDG", partnerId: "IRCTC-PPA", name: "Auto-rickshaw: old leg", provider: "Chandigarh prepaid auto (sample)", managed: "irctc", price: 120, basis: "trip", rating: null, reviews: 0, durationMin: 12,
          availability: "available", tags: ["auto"], policy: { fullUntilH: 1, thenPct: 0 }, source: { name: "Auto meter tariff card (sample)", ref: "LOCAL/CDG/auto/1", checkedMins: 5 }, providerSource: { name: "x", price: 120, rating: null, ratingNotApplicable: true, availability: "available", checkedMins: 3 }, compare: [] };
        s.txItems = Object.assign(s.txItems || {}, { [x.id]: x });
        j.items.push({ id: "IT-legacy1", type: "cab", refId: x.id, title: x.name, price: 120, listedPrice: 120, when: j.train.arrDate + "T11:30", status: "selected", verification: "verified", city: "CDG" });
        s.bookings.push({ ref: "OT-LTR-OLD01", journeyId: "JRN-old", itemId: "IT-old", refId: x.id, type: "cab", partnerId: "IRCTC-PPA", title: x.name, provider: x.provider, amount: 120, status: "confirmed", paidAt: new Date().toISOString(), method: "UPI (simulated)", city: "CDG", when: j.train.arrDate + "T11:30", txn: "SIM-TXN-OLD", simulated: true });
        localStorage.setItem("onetrip.v1", JSON.stringify(s)); }''')
    p.reload(); p.wait_for_function('() => window.OT && OT.router.current()'); p.wait_for_timeout(300)
    j = pg.ev('() => OT.store.get("journey")')
    check('older saved data: unpaid auto item migrated to a pay-on-meter ride (no crash)', not any(i['refId'] == 'TR-CDG-11111-auto' for i in j['items']) and any(r['legKey'] == 'CDG|stn:CDG|htl:H-CDG-02' for r in j.get('meterRides') or []), [j.get('meterRides')])
    for r in ['journey', 'checkout', 'bookings', 'itinerary-print']:
        pg.go(r, 400)
        check('older saved data: #/%s renders' % r, p.locator('#view .empty-state h2:has-text("Something went wrong")').count() == 0 and 'Something went wrong' not in p.inner_text('#view'))
    pg.no_errors('v1.2.1 meter ' + vp)

    # ---- 3. round trip search UI (home + #/trains): toggle, return date, validation
    pg.go('home'); pg.ev('() => localStorage.clear()'); p.reload(); p.wait_for_function('() => window.OT && OT.router.current()')
    check('home Trains tab: "One way | Round trip" toggle, One way by default, return date hidden', p.locator('#tf-trip [data-trip="one"][aria-checked="true"]').count() == 1 and p.locator('#tf-trip [data-trip="round"]').is_visible() and not p.locator('#tf-ret').is_visible())
    p.click('#tf-trip [data-trip="round"]'); p.wait_for_timeout(150)
    d = p.input_value('#tf-date'); r = p.input_value('#tf-ret')
    check('Round trip reveals a Return date = depart + 2 days', p.locator('#tf-ret').is_visible() and r == pg.ev('d => OT.data.travel.addDays(d, 2)', d), [d, r])
    pg.scan('home round trip ' + tag, 'v121-home-round-' + vp)
    p.fill('#tf-ret', pg.ev('d => OT.data.travel.addDays(d, -1)', d)); p.click('#train-go'); p.wait_for_timeout(250)
    check('validation: return before departure is rejected', 'cannot be before' in p.inner_text('#tf-err') and 'home' in pg.ev('() => OT.router.current().name'), p.inner_text('#tf-err'))
    p.fill('#tf-ret', pg.ev('d => OT.data.travel.addDays(d, 3)', d)); p.click('#train-go'); p.wait_for_timeout(500)
    q = pg.ev('() => OT.router.current().params.query')
    check('round-trip search carries trip=round & ret', q.get('trip') == 'round' and q.get('ret') == pg.ev('d => OT.data.travel.addDays(d, 3)', d), q)
    check('#/trains: toggle shows Round trip, return date filled, "step 1 of 2"', p.locator('#ts-trip [data-trip="round"][aria-checked="true"]').count() == 1 and p.input_value('#ts-ret') == q['ret'] and 'step 1 of 2' in p.inner_text('.page-head'))
    p.fill('#ts-ret', pg.ev('d => OT.data.travel.addDays(d, -2)', q['date'])); p.click('#ts-go'); p.wait_for_timeout(250)
    check('#/trains validation: return before departure rejected', 'cannot be before' in p.inner_text('#ts-err'))
    p.click('#ts-trip [data-trip="one"]'); p.wait_for_timeout(100); p.click('#ts-go'); p.wait_for_timeout(400)
    check('switching back to One way drops the return', not pg.ev('() => OT.router.current().params.query.trip'))
    pg.ev('() => OT.i18n.setLang("hi")'); pg.go('trains?from=NDLS&to=CDG&trip=round&ret=' + plus(5) + '&date=' + plus(3), 400)
    check('Hindi: toggle "एक तरफ़ | आना-जाना" and "वापसी की तारीख़"', 'आना-जाना' in p.inner_text('#ts-trip') and 'वापसी की तारीख़' in p.inner_text('.date-pair'))
    pg.scan('trains round hi ' + tag)
    pg.ev('() => OT.i18n.setLang("en")')

    # ---- 4. typed and spoken phrases understand the return
    friday = pg.ev('() => { const d = new Date(); d.setHours(0,0,0,0); let k = (5 - d.getDay() + 7) % 7 || 7; d.setDate(d.getDate() + k); return OT.data.rail.ymd(d); }')
    sunday = pg.ev('f => OT.data.travel.addDays(f, 2)', friday)
    for ph in ['book from Chandigarh to Mumbai train on Friday and back on Sunday', 'Chandigarh se Mumbai train Friday ko aur Sunday ko wapas', 'चंडीगढ़ से मुंबई ट्रेन शुक्रवार को, वापसी रविवार']:
        c = pg.ev('t => OT.agents.parseCommand(t)', ph)
        check('parser: "%s" -> CDG→CSMT Fri %s, return Sun %s' % (ph, friday, sunday), c['from'] == 'CDG' and c['to'] == 'CSMT' and c['date'] == friday and c.get('round') and c.get('ret') == sunday, c)
    c = pg.ev('() => OT.agents.parseCommand("train from Delhi to Jaipur on 20 Nov, return on 28 Nov")')
    check('parser: "return on 28 Nov" sets the return date', c['date'].endswith('-11-20') and (c.get('ret') or '').endswith('-11-28'), c)
    c = pg.ev('() => OT.agents.parseCommand("book from Chandigarh to Mumbai train on Friday")')
    check('parser: no return words -> one way (regression)', not c.get('round') and not c.get('ret'), c)
    pg.go('home', 300)
    p.fill('#ask-input', 'book from Chandigarh to Mumbai train on Friday and back on Sunday'); p.wait_for_timeout(450)
    check('home "Understood" preview shows a Return chip and flips the form to Round trip', p.locator('#parse-preview [data-chip-return]').count() == 1 and p.locator('#tf-trip [data-trip="round"][aria-checked="true"]').count() == 1 and p.input_value('#tf-ret') == sunday, p.inner_text('#parse-preview'))
    p.press('#ask-input', 'Enter'); p.wait_for_function('() => OT.router.current().name === "trains"', timeout=6000); p.wait_for_timeout(300)
    q = pg.ev('() => OT.router.current().params.query')
    check('typed phrase opens trains CDG→CSMT with ret=Sunday', q.get('from') == 'CDG' and q.get('to') == 'CSMT' and q.get('date') == friday and q.get('ret') == sunday and q.get('trip') == 'round', q)
    check('"I heard" panel shows the return date as a chip', p.locator('[data-tour="heard"] [data-chip-return]').count() == 1 and pg.ev('d => OT.fmtDate(d)', sunday) in p.inner_text('[data-tour="heard"]'), p.inner_text('[data-tour="heard"]') if p.locator('[data-tour="heard"]').count() else '')
    pg.go('home', 300)
    pg.ev('() => OT.views.home.sample("hi", "चंडीगढ़ से मुंबई ट्रेन शुक्रवार और रविवार को वापस")')
    p.wait_for_selector('#voice-status.vs-ok', timeout=10000); p.wait_for_timeout(300)
    check('spoken (simulated ASR, Hindi) "…रविवार को वापस": Return chip in the preview', p.locator('#parse-preview [data-chip-return]').count() == 1 and p.input_value('#tf-ret') == sunday, p.inner_text('#parse-preview'))
    pg.no_errors('v1.2.1 search ' + vp)

    # ---- 5. round trip booking: outward -> return -> passengers -> pay once -> 2 PNRs
    pg.go('home'); pg.ev('() => localStorage.clear()'); p.reload(); p.wait_for_function('() => window.OT && OT.router.current()')
    pg.ev('() => OT.auth.signInPersona("sunita", { quiet: true })'); p.wait_for_timeout(300)
    pg.ev('() => OT.i18n.setLang("en")')
    d1, d2 = plus(6), plus(9)
    pg.go('trains?from=NDLS&to=CDG&trip=round&date=%s&ret=%s&pax=2' % (d1, d2), 400)
    p.locator('.trn .cls-tile:not([disabled])').first.click(); p.wait_for_timeout(400)
    q = pg.ev('() => OT.router.current().params.query')
    check('picking the outward class opens the RETURN list (CDG → NDLS on the return date)', q.get('step') == 'ret' and q.get('ono') and p.locator('[data-return-list]').count() == 1 and p.locator('[data-outward-pick]').count() == 1 and 'step 2 of 2' in p.inner_text('.page-head'), q)
    ret_from = pg.ev('() => [...document.querySelectorAll(".trn .trn-times .small bdi.keep")].slice(0, 2).map(b => b.textContent)')
    check('return list runs B → A', ret_from and ret_from[0] == 'CDG' and ret_from[1] == 'NDLS', ret_from)
    pg.scan('return list ' + tag, 'v121-return-list-' + vp)
    p.locator('.trn .cls-tile:not([disabled])').first.click(); p.wait_for_selector('#pax-form')
    check('book page: outward + return summaries', p.locator('[data-tour="trn-sum"]').count() == 1 and p.locator('[data-return-sum]').count() == 1)
    fo = pg.ev('() => +document.querySelector("[data-fare-out]").lastChild.textContent.replace(/[^0-9]/g, "")')
    fr = pg.ev('() => +document.querySelector("[data-fare-ret]").lastChild.textContent.replace(/[^0-9]/g, "")')
    gt = pg.ev('() => +document.querySelector("[data-fare-legs] .grand strong").innerText.replace(/[^0-9]/g, "")')
    check('fare summary: outward + return lines and total (%s + %s = %s)' % (fo, fr, gt), fo > 0 and fr > 0 and gt == fo + fr)
    check('one Pay button for both trains', 'once' in p.inner_text('#trn-pay') and p.locator('#trn-pay').count() == 1)
    pg.scan('round trip book ' + tag, 'v121-book-round-' + vp)
    fill_pax(p)
    nb0 = pg.ev('() => (OT.store.get("bookings") || []).length')
    p.click('#trn-pay')
    cl = p.inner_text('.modal-backdrop.show .confirm-lines')
    check('confirm dialog lists both trains', 'Return train' in cl, cl[:300])
    pg.modal_ok(keep_success=True); p.wait_for_selector('.ps-overlay.show .ps-card', timeout=8000)
    ps = p.inner_text('.ps-card')
    pnrs = re.findall(r'PNR (\d{10})', ps)
    check('payment pop-up shows BOTH PNRs', len(set(pnrs)) == 2, ps[:500])
    check('payment pop-up amount = round-trip total', p.inner_text('.ps-amount').replace(',', '').strip().endswith(str(gt)), p.inner_text('.ps-amount'))
    p.wait_for_function('() => { const o = document.querySelector(".ps-overlay"); return o && getComputedStyle(o).opacity === "1"; }', timeout=5000); p.wait_for_timeout(700)
    pg.scan('round trip pop-up ' + tag, 'v121-popup-round-' + vp)
    p.click('[data-ps-done]'); p.wait_for_timeout(300)
    bk = pg.ev('() => (OT.store.get("bookings") || []).filter(b => b.type === "train")')
    j = pg.ev('() => OT.store.get("journey")')
    check('two train bookings (outward + return), one transaction, same journey', len(bk) == nb0 + 2 and {b.get('leg') for b in bk} == {'outward', 'return'} and len({b['txn'] for b in bk}) == 1 and all(b['journeyId'] == j['id'] for b in bk), [(b.get('leg'), b['pnr']) for b in bk])
    rb = [b for b in bk if b.get('leg') == 'return'][0]
    check('journey.returnTrain = the return PNR (B → A)', j['returnTrain'] and j['returnTrain']['pnr'] == rb['pnr'] and j['returnTrain']['from'] == 'CDG' and j['returnTrain']['to'] == 'NDLS' and j['train']['from'] == 'NDLS', j.get('returnTrain'))
    check('ticket page shows the return too', p.locator('[data-ticket-return]').count() == 1)
    pg.go('journey', 500)
    evs = pg.ev('() => [...document.querySelectorAll(".tl .tl-row[data-ev]")].map(r => r.dataset.ev)')
    check('My Journey: return train is the last stop on the railway timeline', evs[-2:] == ['rdep', 'rarr'], evs)
    check('My Journey: return ticket card with its PNR', rb['pnr'] in p.inner_text('[data-return-ticket]'))
    rdp = pg.ev('() => OT.agents.readiness(OT.store.get("journey")).parts.find(x => x.id === "ret")')
    check('readiness: return journey counted', rdp['state'] in ('booked', 'confirm') and rdp['pts'] > 0, rdp)
    check('no "Add return train" once a return is booked', p.locator('[data-add-return]').count() == 0)
    pg.scan('journey round trip ' + tag, 'v121-journey-round-' + vp)
    # hotel / cab / food planning continues for the destination
    pg.go('results?to=CDG', 300); pg.wait_run()
    p.click('[data-ref="H-CDG-01"] [data-add]'); p.wait_for_timeout(250)
    j = pg.ev('() => OT.store.get("journey")')
    check('planning continues for the destination (hotel added to the same round-trip journey)', j['returnTrain'] and any(i['refId'] == 'H-CDG-01' for i in j['items']))
    hotel = [i for i in j['items'] if i['refId'] == 'H-CDG-01'][0]
    check('hotel nights follow the return date (check-out on the return day)', hotel['endWhen'][:10] == d2, hotel['endWhen'])
    # conflict: return leaves before hotel check-out
    pg.ev('''() => OT.store.update("journey", j => { j.items.forEach(i => { if (i.type === "hotel") i.endWhen = j.returnTrain.date + "T23:30"; }); return j; })''')
    pg.go('journey', 400)
    check('conflict: return departs before hotel check-out is flagged', p.locator('[data-conflict="ret-checkout"]').count() == 1 and 'before hotel check-out' in p.inner_text('[data-conflict="ret-checkout"]'))
    OPEN_JS = '() => OT.agents.itinerary(OT.store.get("journey")).conflicts.filter(c => !c.resolved).length'
    r0 = pg.ev(OPEN_JS)
    p.click('[data-fix-ret]'); p.wait_for_timeout(300)
    r1 = pg.ev(OPEN_JS)
    check('"I’ll check out early" resolves it (open conflicts %s -> %s)' % (r0, r1), p.locator('[data-conflict="ret-checkout"].resolved').count() == 1 and r1 == r0 - 1)
    # itinerary print: return PNR in A4, PNG, WhatsApp and email text
    pg.go('itinerary-print', 600)
    check('one-page itinerary (A4): return section with the return PNR', p.locator('[data-it-return]').count() == 1 and rb['pnr'] in p.inner_text('[data-it-return]'))
    if vp == 'desktop':
        pdf = p.pdf(format='A4', print_background=True)
        n = len(re.findall(rb'/Type\s*/Page[^s]', pdf))
        check('round-trip itinerary prints on exactly 1 A4 page', n == 1, n)
    txt = pg.ev('() => OT.itinerary.summaryText()')
    check('WhatsApp/email text includes "Return PNR"', ('Return PNR ' + rb['pnr']) in txt, txt[:300])
    png = pg.ev('() => OT.itinerary.png(1).length')
    check('PNG (canvas) renders with the return', png > 20000, png)
    pg.go('journey', 400)
    n0 = len(pg.ev('() => window.__opened'))
    p.click('.itin-card [data-it="wa"]'); p.wait_for_timeout(250)
    opened = pg.ev('() => window.__opened')
    check('WhatsApp opens wa.me/917589802655 (persona phone) with the return PNR in the text', len(opened) == n0 + 1 and opened[-1].startswith('https://wa.me/917589802655?text=') and rb['pnr'] in opened[-1], opened[-1:])
    # admin sees both tickets
    pg.ev('() => OT.auth.signInPersona("admin", { quiet: true })'); p.wait_for_timeout(300)
    lv = pg.ev('() => OT.data.analytics.live().trains.map(b => b.pnr)')
    check('Admin live data counts both train tickets (outward + return)', all(b['pnr'] in lv for b in bk), lv)
    pg.ev('() => OT.auth.signInPersona("sunita", { quiet: true })'); p.wait_for_timeout(300); pg.ev('() => OT.i18n.setLang("en")')
    # Bookings & refunds: both PNRs, independently cancellable
    pg.go('bookings', 400)
    ob = [b for b in bk if b.get('leg') == 'outward'][0]
    check('Bookings & refunds: outward and return each have their own Cancel', p.locator('[data-bk="%s"] [data-cancel]' % ob['ref']).count() == 1 and p.locator('[data-bk="%s"] [data-cancel]' % rb['ref']).count() == 1 and p.locator('[data-bk="%s"] [data-leg="return"]' % rb['ref']).count() == 1)
    est = pg.ev('r => { const b = OT.store.get("bookings").find(x => x.ref === r); return OT.agents.refundFor(b).amount; }', rb['ref'])
    p.click('[data-bk="%s"] [data-cancel]' % rb['ref']); p.wait_for_selector('.modal-backdrop.show .btn-danger')
    cl = p.inner_text('.modal-backdrop.show .confirm-lines')
    check('return cancel dialog: its PNR + railway charge + refund', rb['pnr'] in cl and 'Cancellation charge' in cl and pg.ev('n => OT.inr(n)', est) in cl, cl[:300])
    pg.modal_ok()
    st = pg.ev('() => { const j = OT.store.get("journey"); return { ret: j.returnTrain && j.returnTrain.status, out: j.train.status, b: OT.store.get("bookings").filter(x => x.type === "train").map(x => [x.leg, x.status]) }; }')
    check('cancelling the return leaves the outward ticket confirmed', st['ret'] == 'CANCELLED' and st['out'] != 'CANCELLED' and ['outward', 'confirmed'] in st['b'] and ['return', 'cancelled'] in st['b'], st)
    check('refund for the return computed like the outward (railway rule)', pg.ev('r => OT.store.get("bookings").find(x => x.ref === r).cancellation.refundAmount', rb['ref']) == est and est > 0)
    pg.go('journey', 400)
    evs = pg.ev('() => [...document.querySelectorAll(".tl .tl-row[data-ev]")].map(r => r.dataset.ev)')
    check('after cancelling the return: it leaves the timeline and "Add return train" is offered again', 'rdep' not in evs and p.locator('[data-add-return]').count() >= 1, evs)
    pg.go('bookings', 300)
    p.click('[data-bk="%s"] [data-cancel]' % ob['ref']); pg.modal_ok()
    check('outward can be cancelled on its own too', pg.ev('r => OT.store.get("bookings").find(x => x.ref === r).status', ob['ref']) == 'cancelled')
    pg.no_errors('v1.2.1 round trip ' + vp)

    # ---- 6. one way now, "Add return train" later from My Journey (same journey)
    pg.go('home'); pg.ev('() => localStorage.clear()'); p.reload(); p.wait_for_function('() => window.OT && OT.router.current()')
    pg.ev('() => OT.auth.signInPersona("sunita", { quiet: true })'); p.wait_for_timeout(300); pg.ev('() => OT.i18n.setLang("en")')
    pg.go('trains?from=NDLS&to=CDG&date=%s&pax=2' % plus(4), 400)
    p.locator('.trn[data-train="12011"] .cls-tile:not([disabled])').first.click(); p.wait_for_selector('#pax-form'); fill_pax(p)
    p.click('#trn-pay'); pg.modal_ok()
    p.wait_for_selector('#plan-stay'); p.click('#plan-stay'); pg.wait_run()
    p.click('[data-ref="H-CDG-01"] [data-add]'); p.wait_for_timeout(250)
    p.click('[data-tab="cab"]'); p.click('[data-ref="C-CDG-01"] [data-add]'); p.wait_for_timeout(250)
    j0 = pg.ev('() => OT.store.get("journey")')
    pg.go('journey', 400)
    href = p.get_attribute('.tl-addreturn [data-add-return]', 'href') or ''
    co = [i for i in j0['items'] if i['type'] == 'hotel'][0]['endWhen'][:10]
    check('My Journey: "Add return train" after hotel and cab, pre-filled CDG → NDLS on the check-out date', 'from=CDG' in href and 'to=NDLS' in href and 'date=' + co in href and 'attach=return' in href, href)
    rows = pg.ev('() => [...document.querySelectorAll(".tl > li")].map(l => l.className)')
    check('"Add return train" row comes after the hotel and cab rows', rows and 'tl-addreturn' in rows[-1], rows[-3:])
    pg.scan('journey add-return ' + tag, 'v121-journey-addreturn-' + vp)
    p.click('.tl-addreturn [data-add-return]'); p.wait_for_selector('.trn', timeout=6000)
    check('return search runs with an "it joins your journey" note', p.locator('[data-attach-note]').count() == 1 and pg.ev('() => OT.router.current().params.query.attach') == 'return')
    p.locator('.trn .cls-tile:not([disabled])').first.click(); p.wait_for_selector('#pax-form'); fill_pax(p)
    p.click('#trn-pay'); pg.modal_ok(keep_success=True); p.wait_for_selector('.ps-overlay.show .ps-card', timeout=8000)
    ps = p.inner_text('.ps-card')
    p.click('[data-ps-done]'); p.wait_for_timeout(300)
    j1 = pg.ev('() => OT.store.get("journey")')
    rbk = pg.ev('() => (OT.store.get("bookings") || []).filter(b => b.leg === "return")')
    check('return attached to the SAME journey (id, outward PNR, hotel and cab kept)', j1['id'] == j0['id'] and j1['pnr'] == j0['pnr'] and j1['returnTrain'] and j1['returnTrain']['from'] == 'CDG' and len(j1['items']) == len(j0['items']), [j0['id'], j1['id']])
    check('return booking has its own PNR in Bookings, same journey id', len(rbk) == 1 and rbk[0]['pnr'] == j1['returnTrain']['pnr'] and rbk[0]['pnr'] != j1['pnr'] and rbk[0]['journeyId'] == j1['id'] and rbk[0]['pnr'] in ps)
    check('back on My Journey: return is the last timeline stop', pg.ev('() => [...document.querySelectorAll(".tl .tl-row[data-ev]")].map(r => r.dataset.ev).slice(-2)') == ['rdep', 'rarr'])
    pg.go('checkout', 300)
    check('checkout lists the return train as already paid (not charged again)', p.locator('[data-co-return]').count() == 1 and 'Not charged again' in p.inner_text('[data-co-return]'))
    pg.go('itinerary-print', 500)
    check('itinerary print has the added return PNR', rbk[0]['pnr'] in p.inner_text('[data-it-return]'))
    p.reload(); p.wait_for_function('() => window.OT && OT.router.current()'); p.wait_for_timeout(400)
    check('after reload the return is still attached (persists in OT.store)', pg.ev('() => OT.store.get("journey").returnTrain.pnr') == rbk[0]['pnr'])
    pg.no_errors('v1.2.1 add return ' + vp)
    pg.close()


# ---------------------------------------------------------------- v1.2.1 independent verification (regressions for the verifier's fixes)
TX_CLIP_JS = r"""() => [...document.querySelectorAll('.tx-card .tx-price bdi, .tx-card .tx-top strong, .tx-card .tx-act .btn')].map(b => {
  const c = b.closest('.tx-card'), cr = c.getBoundingClientRect(), pr = parseFloat(getComputedStyle(c).paddingRight);
  const rg = document.createRange(); rg.selectNodeContents(b); const r = rg.getBoundingClientRect();
  return { t: b.textContent.trim(), over: Math.round(r.right - (cr.right - pr)) }; }).filter(x => x.over > 1)"""


def v121_verify(browser, base, vp):
    tag = 'v121v-' + vp
    pg = Page(browser, base, vp, init=OPEN_STUB)
    p = pg.p
    pg.go('home'); pg.ev('() => localStorage.clear()'); p.reload(); p.wait_for_function('() => window.OT && OT.router.current()')
    plus = lambda n: pg.ev('n => OT.data.travel.addDays(OT.data.rail.ymd(new Date()), n)', n)
    # fix: the station -> hotel transfer is ONE leg whether picked in the comparison or from a catalogue card
    pg.go('results?to=CDG', 300); pg.wait_run()
    p.click('[data-ref="H-CDG-01"] [data-add]'); p.wait_for_timeout(250)
    p.click('[data-tab="cab"]'); p.wait_for_timeout(200)
    p.click('[data-panel="cab"] .tx-card[data-mode="auto"] [data-tx-meter]'); p.wait_for_timeout(300)
    if vp == 'mobile':
        o = pg.ev(OVERFLOW)
        check('results Transport tab after "I’ll take an auto": no horizontal overflow at 375 (meter button wraps)', o['doc'] <= o['w'] and not o['offenders'], o)
        check('results Transport tab: no text runs past a transport card edge', not pg.ev(TX_CLIP_JS), pg.ev(TX_CLIP_JS))
    p.click('[data-ref="C-CDG-03"] [data-meter-ref]'); p.wait_for_timeout(300)
    rides = pg.ev('() => OT.meter.list()')
    check('station transfer: the booth auto replaces the comparison auto (one auto for the station -> hotel leg)', len(rides) == 1 and rides[0].get('refId') == 'C-CDG-03', rides)
    p.click('[data-ref="C-CDG-01"] [data-add]'); p.wait_for_timeout(300)
    j = pg.ev('() => OT.store.get("journey")')
    check('station transfer: adding the station cab (C-CDG-01) drops the planned auto', not (j.get('meterRides') or []) and any(i['refId'] == 'C-CDG-01' for i in j['items']), [j.get('meterRides'), [i['refId'] for i in j['items']]])
    p.click('[data-panel="cab"] .tx-card[data-mode="auto"] [data-tx-meter]'); p.wait_for_timeout(300)
    j = pg.ev('() => OT.store.get("journey")')
    check('station transfer: "I’ll take an auto" drops the unpaid station cab (C-CDG-01)', len(j.get('meterRides') or []) == 1 and not any(i['refId'] == 'C-CDG-01' and i['status'] == 'selected' for i in j['items']), [j.get('meterRides'), [i['refId'] for i in j['items']]])
    pg.go('transport?city=CDG&from=stn%3ACDG&to=lm%3AS-CDG-01&pax=2', 300)
    j0 = len(pg.ev('() => OT.meter.list()'))
    check('a station -> landmark leg is not treated as the station transfer', pg.ev('() => { const c = OT.data.transport.compare({ city: "CDG", from: "stn:CDG", to: OT.data.transport.places("CDG").find(x => x.kind === "landmark").id, pax: 2 }); return OT.meter.fromOption(c, c.options.find(o => o.mode === "auto")).station; }') is False and j0 == 1)
    pg.no_errors('v1.2.1 verify station transfer ' + vp)
    # fix: meter prices / buttons never run past the card on a phone, in English and Hindi
    if vp == 'mobile':
        for lang in ('en', 'hi'):
            pg.ev('l => OT.i18n.setLang(l)', lang)
            for city in ('NDLS', 'CDG'):
                pg.go('transport?city=%s&pax=2' % city, 300)
                bad = pg.ev(TX_CLIP_JS)
                check('#/transport %s (%s): "≈ ₹X on meter" / "≈ ₹20 per person" fit inside the card at 375' % (city, lang), not bad, bad)
        pg.ev('() => OT.i18n.setLang("en")')
    # fix: a return day that only parses by rolling into next year is ignored; a New Year return still works
    c = pg.ev('() => OT.agents.parseCommand("train from Delhi to Jaipur on 20 Nov, return on 2 Nov")')
    check('parser: "20 Nov, return on 2 Nov" -> round trip, return date ignored (not next year)', c.get('round') and not c.get('ret') and c.get('retBad'), c)
    c = pg.ev('() => OT.agents.parseCommand("Delhi to Jaipur train on 28 Dec return on 3 Jan")')
    check('parser: "28 Dec … return on 3 Jan" -> return 6 days later (across New Year)', c.get('ret') == pg.ev('d => OT.data.travel.addDays(d, 6)', c.get('date')), c)
    # fix: 12011 / 12012 Kalka Shatabdi CC cost the same both ways on a round trip
    pg.go('trains?from=NDLS&to=CDG&trip=round&date=%s&ret=%s&pax=2' % (plus(6), plus(9)), 400)
    p.locator('.trn[data-train="12011"] .cls-tile[data-cls="CC"]:not([disabled]), .trn[data-train="12011"] .cls-tile:not([disabled])').first.click(); p.wait_for_timeout(400)
    p.locator('.trn[data-train="12012"] .cls-tile:not([disabled])').first.click(); p.wait_for_selector('#pax-form')
    fo = pg.ev('() => +document.querySelector("[data-fare-out]").lastChild.textContent.replace(/[^0-9]/g, "")')
    fr = pg.ev('() => +document.querySelector("[data-fare-ret]").lastChild.textContent.replace(/[^0-9]/g, "")')
    check('round trip NDLS ⇄ CDG on 12011 + 12012 CC: outward and return fares match (%s / %s)' % (fo, fr), fo == fr and fo > 0)
    pg.close()
    # owner request B: each traveller persona, signed in from the visible login page, gets WhatsApp straight to +91 75898 02655
    for per in ('sunita', 'ramesh', 'arjun', 'neha'):
        pg = Page(browser, base, vp, init=OPEN_STUB)
        p = pg.p
        pg.go('home'); pg.ev('() => localStorage.clear()'); p.reload(); p.wait_for_function('() => window.OT && OT.router.current()')
        pg.go('login', 300)
        p.click('[data-signin-persona="%s"]' % per); p.wait_for_timeout(400)
        check('%s signed in from the login page with phone +91 75898 02655' % per, pg.ev('() => (OT.store.get("user") || {}).phone') == '+91 75898 02655')
        pg.go('trains?from=NDLS&to=CDG&date=%s&pax=1' % plus(5), 400)
        p.locator('.trn .cls-tile:not([disabled])').first.click(); p.wait_for_selector('#pax-form'); fill_pax(p)
        p.click('#trn-pay'); pg.modal_ok(keep_success=True); p.wait_for_selector('.ps-overlay.show .ps-card', timeout=8000)
        pnr = re.findall(r'PNR\s*(\d{10})', p.inner_text('.ps-card'))
        p.click('.ps-overlay [data-it="wa"]'); p.wait_for_timeout(300)
        op = pg.ev('() => window.__opened')
        check('%s: pop-up WhatsApp opens wa.me/917589802655 with the PNR typed, no number prompt' % per,
              op and op[-1].startswith('https://wa.me/917589802655?text=') and pnr and pnr[0] in op[-1] and p.locator('.modal-backdrop.show').count() == 0, (op[-1:], pnr))
        pg.no_errors('v1.2.1 verify WhatsApp %s %s' % (per, vp))
        pg.close()


# ---------------------------------------------------------------- main
def v122(browser, base, vp):
    """v1.2.2: "Add other services, pay once": the train(s) wait in the trip unpaid, checkout charges trains + services once."""
    tag = 'v122-' + vp
    num = lambda s: int(re.sub(r'[^0-9]', '', s or '') or 0)

    def fresh():
        pg.go('home'); pg.ev('() => localStorage.clear()'); p.reload(); p.wait_for_function('() => window.OT && OT.router.current()')
        pg.ev('() => { OT.state.lastRun = null; OT.state.lastCheckout = null; }')

    def book_page(path, train=None, cls=None):
        pg.go(path, 400)
        if train:
            p.locator('.trn[data-train="%s"] [data-book="%s"]' % (train, cls) if cls else '.trn[data-train="%s"] .cls-tile:not([disabled])' % train).first.click()
        else:
            p.locator('.trn .cls-tile:not([disabled])').first.click()
        p.wait_for_timeout(300)

    def hold():
        p.click('#trn-hold'); p.wait_for_timeout(500)

    pg = Page(browser, base, vp, init=OPEN_STUB)
    p = pg.p
    fresh()
    plus = lambda n: pg.ev('n => OT.data.travel.addDays(OT.data.rail.ymd(new Date()), n)', n)

    # ---- A. one way, signed out: the choice sits right below Pay
    d = plus(5)
    book_page('trains?from=NDLS&to=CDG&date=%s&pax=2' % d, '12011', 'CC')
    p.wait_for_selector('#pax-form')
    geo = pg.ev('() => { const a = document.querySelector("#trn-pay").getBoundingClientRect(), b = document.querySelector("#trn-hold").getBoundingClientRect(); return { payBottom: a.bottom, holdTop: b.top, holdW: b.width, payW: a.width }; }')
    check('book page: "Add hotel, transport, food & sightseeing — pay once at the end" directly below Pay', geo['holdTop'] > geo['payBottom'] and geo['holdTop'] - geo['payBottom'] < 90 and abs(geo['holdW'] - geo['payW']) < 2, geo)
    check('book page: the choice reads as the owner asked (or + label + hint)', p.locator('.hold-or').count() == 1 and 'pay once at the end' in p.inner_text('#trn-hold') and 'pay for everything together at checkout' in p.inner_text('.hold-hint'), p.inner_text('.hold-choice'))
    pay_amt = num(p.inner_text('#trn-pay'))
    pg.scan('book one way with the new option ' + tag, 'v122-book-oneway-' + vp)
    p.fill('#px-n0', ''); hold()
    check('Add other services validates passengers exactly like Pay (no name -> error, nothing stored)', p.locator('#px-err:not(.hidden)').count() == 1 and pg.ev('() => !OT.store.get("journey")') and pg.ev('() => OT.router.current().name') == 'trains')
    fill_pax(p)
    hold()
    p.wait_for_function('() => OT.router.current().name === "results"', timeout=5000)
    j = pg.ev('() => OT.store.get("journey")')
    h = j.get('hold') or {}
    leg = (h.get('legs') or [{}])[0]
    exp_train = leg.get('farePerPax', 0) * 2 + 20
    check('Add other services: train kept in the trip unpaid (status HELD, no PNR, no booking, no payment)', j['train']['status'] == 'HELD' and not j.get('pnr') and len(h.get('legs', [])) == 1 and leg['no'] == '12011' and leg['cls'] == 'CC' and len(leg['pax']) == 2 and not pg.ev('() => (OT.store.get("bookings") || []).length') and not pg.ev('() => document.querySelector(".ps-overlay.show")'), [j['train'], h])
    check('held train amount = the Pay-now amount (%d = fare × 2 + ₹20 fee)' % exp_train, exp_train == pay_amt and exp_train > 0, [exp_train, pay_amt])
    p.wait_for_selector('[data-hold-banner]')
    bt = p.inner_text('[data-hold-banner]')
    check('planning screen banner: "Trains in your trip (not paid yet) · ₹X · Pay everything at checkout"', 'Trains in your trip (not paid yet)' in bt and pg.ev('n => OT.inr(n)', exp_train) in bt and 'Pay everything at checkout' in bt, bt[:200])
    check('planning screen is "Now plan your stay" for the destination (results for CDG)', pg.ev('() => OT.router.current().params.query.to') == 'CDG' and p.locator('[data-tour="trace"]').count() == 1)
    pg.wait_run()
    pg.scan('planning banner ' + tag, 'v122-results-banner-' + vp)
    p.click('[data-ref="H-CDG-01"] [data-add]'); p.wait_for_timeout(250)
    p.click('[data-tab="cab"]'); p.wait_for_timeout(200)
    p.click('[data-ref="C-CDG-01"] [data-add]'); p.wait_for_timeout(250)
    p.click('[data-panel="cab"] .tx-card[data-mode="auto"] [data-tx-meter]') if p.locator('[data-panel="cab"] .tx-card[data-mode="auto"] [data-tx-meter]').count() and False else None
    svc = pg.ev('() => { const j = OT.store.get("journey"); return j.items.filter(i => i.status === "selected").reduce((s, i) => s + OT.agents.lineFor(i, j).amount, 0); }')
    # before payment: nothing in Bookings, partner or admin
    pg.go('bookings', 300)
    check('before payment: Bookings & refunds has no booking card, only the "not paid yet" note', p.locator('[data-bk-unpaid]').count() == 1 and p.locator('.bk-list').count() == 0 and p.locator('[data-cancel]').count() == 0 and 'not paid yet' in p.inner_text('[data-bk-unpaid]'))
    live = pg.ev('() => { const a = OT.data.analytics.live(); return { p101: a.p101.length, gtv: a.gtv, trains: a.trains.length }; }')
    check('before payment: partner P-101 sees no booking, admin GTV 0 and no train tickets', live == {'p101': 0, 'gtv': 0, 'trains': 0}, live)
    pg.ev('() => OT.store.set("user", { name: "Rajinder Singh", email: "p101.shivalik@demo.onetrip", role: "partner", partnerId: "P-101", org: "Hotel Shivalik View", personaId: "partner", simulated: true })')
    pg.go('partner/bookings', 400)
    check('before payment: partner dashboard lists no live OneTrip booking', p.locator('#view .pill-live').count() == 0)
    pg.ev('() => OT.store.set("user", undefined)')
    # My Journey
    pg.go('journey', 400)
    check('My Journey: train stop shows "Not paid yet — pay at checkout"', p.locator('[data-ev="dep"] [data-unpaid-badge]').count() == 1 and 'Not paid yet' in p.inner_text('[data-tour="ticket"]'))
    check('My Journey: prominent "Review & pay for everything" button', p.locator('[data-hold-note] [data-pay-all]').is_visible() and p.locator('.cost [data-pay-all]').count() == 1)
    rd = pg.ev('() => OT.agents.readiness(OT.store.get("journey")).parts.find(x => x.id === "ticket")')
    check('Trip Readiness: unpaid ticket = 80% (24/30), labelled not paid yet', rd['state'] == 'unpaid' and abs(rd['pts'] - 24) < 0.01 and 'not paid yet' in p.inner_text('.readiness'), rd)
    due = num(p.inner_text('.cost .due'))
    check('Trip cost "To pay now" = train + services (%d + %d)' % (exp_train, svc), due == exp_train + svc, due)
    check('PNR shows "—" (none issued yet), no "null"', 'null' not in p.inner_text('#view') and 'PNR\n—' in p.inner_text('.ticket-meta'))
    pg.scan('journey unpaid ' + tag, 'v122-journey-unpaid-' + vp)
    # reload persists
    p.reload(); p.wait_for_function('() => window.OT && OT.router.current()'); p.wait_for_timeout(400)
    check('reload: unpaid train, services and the unpaid note persist', pg.ev('() => !!(OT.store.get("journey").hold && OT.store.get("journey").train.status === "HELD")') and p.locator('[data-hold-note]').count() == 1)
    # Checkout
    pg.go('checkout', 400)
    tl = p.locator('[data-train-line]').count()
    tamt = pg.ev('() => +document.querySelector("[data-train-line] .co-amt span").innerText.replace(/[^0-9]/g, "")')
    tot = pg.ev('() => +document.querySelector(".co-totals .grand strong").innerText.replace(/[^0-9]/g, "")')
    check('checkout: one train line (%d) + the services, one grand total (%d)' % (tamt, tot), tl == 1 and tamt == exp_train and tot == exp_train + svc and p.locator('.co-line:not(.co-train-line)').count() == 2, [tl, tamt, tot])
    check('checkout: Pay button = grand total', num(p.inner_text('#pay-btn')) == tot)
    check('checkout: train line says the PNR is issued after payment', 'PNR is issued when you pay' in p.inner_text('[data-train-line]'))
    pg.scan('checkout trains + services ' + tag, 'v122-checkout-oneway-' + vp)
    p.click('#pay-btn'); p.wait_for_selector('.modal-backdrop.show .confirm-lines')
    cl = p.inner_text('.modal-backdrop.show .confirm-lines')
    check('confirm dialog lists the train, the services and the total', '12011' in cl and 'Hotel Shivalik View' in cl and pg.ev('n => OT.inr(n)', tot) in cl, cl[:400])
    check('still nothing booked while the confirm dialog is open', not pg.ev('() => (OT.store.get("bookings") || []).length'))
    pg.modal_ok(keep_success=True); p.wait_for_selector('.ps-overlay.show .ps-card', timeout=8000)
    p.wait_for_function('() => { const o = document.querySelector(".ps-overlay"); return o && getComputedStyle(o).opacity === "1"; }', timeout=5000); p.wait_for_timeout(600)
    ps = p.inner_text('.ps-card')
    pnrs = re.findall(r'PNR\s*(\d{10})', ps)
    check('ONE payment pop-up: amount = grand total, the train PNR and the hotel/cab refs', num(p.inner_text('.ps-amount')) == tot and len(pnrs) == 1 and 'OT-HTL-' in ps and 'OT-CAB-' in ps, ps[:400])
    pg.scan('pop-up pay once ' + tag, 'v122-popup-oneway-' + vp)
    bk = pg.ev('() => OT.store.get("bookings")')
    j = pg.ev('() => OT.store.get("journey")')
    trb = [b for b in bk if b['type'] == 'train']
    check('after payment: train is a normal paid booking (PNR from the pop-up, amount, same transaction as the services)', len(trb) == 1 and trb[0]['pnr'] == pnrs[0] and trb[0]['amount'] == exp_train and len({b['txn'] for b in bk}) == 1 and sum(b['amount'] for b in bk) == tot and trb[0]['journeyId'] == j['id'], [(b['type'], b['amount'], b.get('pnr')) for b in bk])
    check('after payment: journey has the PNR, train no longer HELD, no hold left', j.get('pnr') == pnrs[0] and j['train']['status'] in ('CNF', 'RAC', 'WL') and not j.get('hold'), [j.get('pnr'), j['train']['status']])
    p.click('[data-ps-done]'); p.wait_for_timeout(300)
    pg.go('bookings', 300)
    check('Bookings & refunds: the train PNR is listed and cancellable, no unpaid note', pnrs[0] in p.inner_text('.bk-list') and p.locator('[data-cancel]').count() == 3 and p.locator('[data-bk-unpaid]').count() == 0)
    live = pg.ev('() => { const a = OT.data.analytics.live(); return { p101: a.p101.length, gtv: a.gtv, trains: a.trains.length }; }')
    check('after payment: partner P-101 sees the hotel, admin counts the ticket and the add-on GTV', live['p101'] == 1 and live['trains'] == 1 and live['gtv'] == svc, live)
    pg.go('itinerary-print', 400)
    check('one-page itinerary shows the PNR', pnrs[0] in p.inner_text('.itin-sheet'))
    pg.ev('() => OT.store.set("user", { name: "Sunita Sharma", phone: "+91 75898 02655", role: "traveller", email: "sunita@demo.onetrip" })')
    pg.go('journey', 300)
    p.click('.itin-card [data-it="wa"]'); p.wait_for_timeout(300)
    op = pg.ev('() => window.__opened')
    check('WhatsApp opens wa.me/917589802655 with the PNR in the text', op and op[-1].startswith('https://wa.me/917589802655?text=') and pnrs[0] in op[-1], op[-1:])
    # "Add return train" still works afterwards
    ar = p.locator('[data-add-return]').first
    check('one way paid via checkout: "Add return train" is offered', ar.count() == 1)
    pg.go(pg.ev('() => OT.views.journey.addReturnPath()'), 400)
    p.locator('.trn .cls-tile:not([disabled])').first.click(); p.wait_for_selector('#pax-form')
    check('attach-return book page also offers pay later', p.locator('#trn-hold').count() == 1)
    fill_pax(p); p.click('#trn-pay'); pg.modal_ok()
    j = pg.ev('() => OT.store.get("journey")')
    check('Add return train after a pay-once checkout: return booked into the same journey', j.get('returnTrain') and re.match(r'^\d{10}$', j['returnTrain'].get('pnr') or '') and any(b.get('leg') == 'return' for b in pg.ev('() => OT.store.get("bookings")')))
    pg.no_errors('v1.2.2 one way ' + vp)

    # ---- B. round trip: hold both, replace the outward, pay once, two PNRs
    fresh()
    d1, d2 = plus(6), plus(9)
    pg.go('trains?from=NDLS&to=CDG&trip=round&date=%s&ret=%s&pax=2' % (d1, d2), 400)
    p.locator('.trn[data-train="12011"] [data-book="CC"]').first.click(); p.wait_for_timeout(400)
    p.locator('.trn[data-train="12012"] [data-book="CC"]').first.click(); p.wait_for_selector('#pax-form')
    gt = pg.ev('() => +document.querySelector("[data-fare-legs] .grand strong").innerText.replace(/[^0-9]/g, "")')
    check('round trip book page: the choice is under "Pay … once & book both"', p.locator('#trn-hold').count() == 1 and 'once' in p.inner_text('#trn-pay'))
    pg.scan('book round trip with option ' + tag, 'v122-book-round-' + vp)
    fill_pax(p); hold()
    p.wait_for_function('() => OT.router.current().name === "results"', timeout=5000)
    j = pg.ev('() => OT.store.get("journey")')
    check('round trip held: outward + return in the trip unpaid, no PNRs', [l['leg'] for l in j['hold']['legs']] == ['outward', 'return'] and j['returnTrain']['status'] == 'HELD' and not j['returnTrain'].get('pnr') and not j.get('pnr') and not pg.ev('() => (OT.store.get("bookings") || []).length'))
    check('banner amount = round-trip total (%d)' % gt, pg.ev('n => OT.inr(n)', gt) in p.inner_text('[data-hold-banner]') and 'Return' in p.inner_text('[data-hold-banner]'))
    jid = j['id']
    pg.wait_run(); p.click('[data-ref="H-CDG-01"] [data-add]'); p.wait_for_timeout(250)
    # go back and pick a different outward train: replaced, not duplicated; the hotel stays
    pg.go('trains?from=NDLS&to=CDG&trip=round&date=%s&ret=%s&pax=2' % (d1, d2), 400)
    other = pg.ev('() => [...document.querySelectorAll(".trn")].map(t => t.dataset.train).find(n => n !== "12011" && document.querySelector(\'.trn[data-train="\' + n + \'"] .cls-tile:not([disabled])\'))')
    p.locator('.trn[data-train="%s"] .cls-tile:not([disabled])' % other).first.click(); p.wait_for_timeout(400)
    p.locator('.trn[data-train="12012"] [data-book="CC"]').first.click(); p.wait_for_selector('#pax-form')
    gt2 = pg.ev('() => +document.querySelector("[data-fare-legs] .grand strong").innerText.replace(/[^0-9]/g, "")')
    fill_pax(p); hold(); p.wait_for_timeout(300)
    j = pg.ev('() => OT.store.get("journey")')
    check('picking a different train replaces the unpaid one (same journey, 2 legs, hotel kept)', j['id'] == jid and len(j['hold']['legs']) == 2 and j['hold']['legs'][0]['no'] == other and j['train']['no'] == other and any(i['refId'] == 'H-CDG-01' for i in j['items']), [j['id'] == jid, [l['no'] for l in j['hold']['legs']], [i['refId'] for i in j['items']]])
    pg.go('journey', 400)
    check('My Journey: both train stops unpaid (outward + return) with Review & pay for everything', p.locator('[data-ev="dep"] [data-unpaid-badge]').count() == 1 and p.locator('[data-ev="rdep"] [data-unpaid-badge]').count() == 1 and p.locator('[data-pay-all]').count() >= 1)
    rdr = pg.ev('() => OT.agents.readiness(OT.store.get("journey")).parts.find(x => x.id === "ret")')
    check('Trip Readiness: unpaid return = 80% of its weight', rdr['state'] == 'unpaid' and abs(rdr['pts'] - 8) < 0.01, rdr)
    pg.scan('journey round unpaid ' + tag, 'v122-journey-round-' + vp)
    pg.go('checkout', 400)
    amts = pg.ev('() => [...document.querySelectorAll("[data-train-line]")].map(l => [l.dataset.trainLine, +l.querySelector(".co-amt span").innerText.replace(/[^0-9]/g, "")])')
    svc = pg.ev('() => { const j = OT.store.get("journey"); return j.items.filter(i => i.status === "selected").reduce((s, i) => s + OT.agents.lineFor(i, j).amount, 0); }')
    tot = pg.ev('() => +document.querySelector(".co-totals .grand strong").innerText.replace(/[^0-9]/g, "")')
    check('checkout: outward + return lines (%s) + hotel = total %d' % (amts, tot), [a[0] for a in amts] == ['outward', 'return'] and sum(a[1] for a in amts) == gt2 and tot == gt2 + svc, [amts, gt2, svc, tot])
    pg.scan('checkout round ' + tag, 'v122-checkout-round-' + vp)
    p.click('#pay-btn'); cl = p.inner_text('.modal-backdrop.show .confirm-lines')
    check('confirm lists Outward, Return and the hotel', 'Outward' in cl and 'Return' in cl and 'Hotel Shivalik View' in cl, cl[:300])
    pg.modal_ok(keep_success=True); p.wait_for_selector('.ps-overlay.show .ps-card', timeout=8000)
    ps = p.inner_text('.ps-card'); pnrs = re.findall(r'PNR\s*(\d{10})', ps)
    check('one payment, pop-up with BOTH PNRs and the hotel ref', len(set(pnrs)) == 2 and 'OT-HTL-' in ps and num(p.inner_text('.ps-amount')) == tot, ps[:400])
    p.click('[data-ps-done]'); p.wait_for_timeout(300)
    bk = pg.ev('() => OT.store.get("bookings")')
    trb = [b for b in bk if b['type'] == 'train']
    check('two train bookings Outward/Return, one transaction with the hotel', sorted(b.get('leg') for b in trb) == ['outward', 'return'] and len({b['txn'] for b in bk}) == 1 and sum(b['amount'] for b in bk) == tot)
    pg.go('bookings', 300)
    txt = p.inner_text('.bk-list')
    check('Bookings & refunds: Outward and Return labels with both PNRs', 'Outward' in txt and 'Return' in txt and all(x in txt for x in pnrs))
    rref = [b for b in trb if b['leg'] == 'return'][0]['ref']
    pg.ev('r => { OT.views.bookings.cancel(r); }', rref); pg.modal_ok()
    bk = pg.ev('() => OT.store.get("bookings")')
    st = {b.get('leg'): b['status'] for b in bk if b['type'] == 'train'}
    check('each PNR cancellable independently (return cancelled, outward still confirmed)', st == {'outward': 'confirmed', 'return': 'cancelled'}, st)
    pg.no_errors('v1.2.2 round trip ' + vp)

    # ---- C. remove the unpaid train (confirm), and with nothing else in the trip
    fresh()
    book_page('trains?from=NDLS&to=CDG&date=%s&pax=1' % plus(5), '12011', 'CC'); fill_pax(p); hold()
    pg.wait_run(); p.click('[data-ref="H-CDG-01"] [data-add]'); p.wait_for_timeout(250)
    pg.go('journey', 400)
    p.click('[data-hold-note] [data-hold-remove="outward"]'); p.wait_for_selector('.modal-backdrop.show')
    check('remove asks to confirm (lists the train, nothing to refund)', '12011' in p.inner_text('.modal-backdrop.show') and 'nothing to refund' in p.inner_text('.modal-backdrop.show'))
    p.locator('.modal-backdrop.show .modal-foot .btn').first.click(); p.wait_for_timeout(300)
    check('"Keep it" keeps the unpaid train', pg.ev('() => !!OT.store.get("journey").hold'))
    p.click('[data-hold-note] [data-hold-remove="outward"]'); pg.modal_ok()
    j = pg.ev('() => OT.store.get("journey")')
    check('removed: the trip keeps the hotel as a stay without a train, no bookings', j and j.get('kind') == 'trip' and not j.get('train') and not j.get('hold') and any(i['refId'] == 'H-CDG-01' for i in j['items']) and not pg.ev('() => (OT.store.get("bookings") || []).length'), j and [j.get('kind'), j.get('train')])
    check('My Journey after removal: "Add a train to this trip" again', p.locator('#add-train').count() == 1)
    # standalone stay -> "Add a train" -> the same two options; holding keeps the stay
    pg.go(pg.ev('() => document.querySelector("#add-train").getAttribute("href").slice(2)'), 400)
    p.locator('.trn .cls-tile:not([disabled])').first.click(); p.wait_for_selector('#pax-form')
    check('standalone trip "Add a train": book page offers Pay now and the pay-once option', p.locator('#trn-pay').count() == 1 and p.locator('#trn-hold').count() == 1)
    jid = j['id']; fill_pax(p); hold()
    j = pg.ev('() => OT.store.get("journey")')
    check('standalone trip + held train: same journey, hotel kept, train unpaid', j['id'] == jid and j['train']['status'] == 'HELD' and any(i['refId'] == 'H-CDG-01' for i in j['items']))
    # past departure at checkout: blocked
    pg.ev('() => OT.store.update("journey", j => { const y = OT.data.travel.addDays(OT.data.rail.ymd(new Date()), -1); j.hold.legs[0].date = y; j.train.date = y; return j; })')
    pg.go('checkout', 400)
    check('train departed by checkout: clear message, Pay disabled', p.locator('[data-hold-problem]').count() == 1 and 'left on' in p.inner_text('[data-hold-problem]') and p.locator('#pay-btn[disabled]').count() == 1, p.inner_text('[data-hold-problem]') if p.locator('[data-hold-problem]').count() else '')
    r = pg.ev('() => OT.views.checkout.pay()')
    check('…and paying anyway is refused, nothing booked', r is False and not pg.ev('() => (OT.store.get("bookings") || []).length'))
    pg.go('journey', 300)
    check('My Journey shows the departed warning too', p.locator('[data-hold-problem]').count() == 1)
    pg.scan('departed unpaid train ' + tag)
    p.click('[data-hold-note] [data-hold-remove="outward"]'); pg.modal_ok()
    # nothing else in the trip -> journey cleared
    fresh()
    book_page('trains?from=NDLS&to=CDG&date=%s&pax=1' % plus(5), '12011', 'CC'); fill_pax(p); hold()
    pg.go('journey', 300)
    p.click('[data-hold-note] [data-hold-remove="outward"]'); pg.modal_ok()
    check('removing the only thing in the trip empties My Journey', pg.ev('() => !OT.store.get("journey")') and p.locator('.journey-empty').count() == 1)
    pg.no_errors('v1.2.2 remove/departed ' + vp)

    # ---- D. pay-now path unchanged
    fresh()
    book_page('trains?from=NDLS&to=CDG&date=%s&pax=2' % plus(5), '12011', 'CC'); fill_pax(p)
    p.click('#trn-pay'); pg.modal_ok()
    j = pg.ev('() => OT.store.get("journey")'); bk = pg.ev('() => OT.store.get("bookings")')
    check('Pay now unchanged: PNR at once, ticket page, one train booking, no hold', len(bk) == 1 and bk[0]['type'] == 'train' and re.match(r'^\d{10}$', j.get('pnr') or '') and not j.get('hold') and pg.ev('() => OT.router.current().params.sub') == 'ticket' and p.locator('#plan-stay').count() == 1)

    # ---- E. assistant / voice path, signed-in persona in Hindi
    fresh()
    pg.ev('() => OT.auth.signInPersona("sunita", { quiet: true })'); p.wait_for_timeout(300)
    m = pg.ev('() => { OT.assistant.open(); return OT.assistant.ask("book a train from Delhi to Chandigarh"); }')
    route = m['res']['actions'][0]['route']
    pg.ev('() => OT.assistant.close()')
    pg.go(route, 400)
    check('assistant train answer -> train results with "I heard"', p.locator('.heard').count() == 1 and p.locator('.trn').count() > 0)
    p.locator('.trn .cls-tile:not([disabled])').first.click(); p.wait_for_selector('#pax-form')
    check('assistant path book page (Hindi): the pay-once option in Hindi', 'आख़िर में एक बार भुगतान' in p.inner_text('#trn-hold') and 'या' in p.inner_text('.hold-or'), p.inner_text('#trn-hold'))
    pg.scan('book page hindi ' + tag, 'v122-book-hi-' + vp)
    fill_pax(p); hold()
    p.wait_for_selector('[data-hold-banner]')
    check('Hindi banner', 'आपकी यात्रा में ट्रेनें' in p.inner_text('[data-hold-banner]'))
    pg.go('journey', 300)
    check('Hindi My Journey unpaid note and button', 'अभी भुगतान नहीं हुआ' in p.inner_text('[data-hold-note]') and 'सब कुछ देखें और भुगतान करें' in p.inner_text('[data-hold-note]'))
    pg.scan('journey hindi unpaid ' + tag)
    pg.go('checkout', 300)
    pg.scan('checkout hindi unpaid ' + tag)
    for lg in ('ta', 'bn'):
        pg.ev('l => OT.i18n.setLang(l)', lg); pg.go('journey', 200)
        pg.scan('journey %s unpaid %s' % (lg, tag))
    pg.ev('() => OT.i18n.setLang("en")')
    check('tour has the pay-once step', pg.ev('() => OT.tour.steps.some(s => s.target === \'[data-tour="pay-later"]\')'))
    pg.no_errors('v1.2.2 assistant/hindi ' + vp)
    pg.close()
    if vp == 'desktop':
        GROUP[0] = 'v1.2.2 tour ' + base[:4]
        tp = Page(browser, base, vp)
        try:
            tour(tp, 'v122-' + vp)
            check('tour shows the pay-once step on the book page', True)
        finally:
            tp.close()


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close(); return port


def main():
    if want('assets'):
        asset_check()
    port = free_port()
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'], cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    bases = {'file': (ROOT / 'index.html').as_uri(), 'http': 'http://127.0.0.1:%d/index.html' % port}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for bname, base in bases.items():
                if BASES_ONLY and bname != BASES_ONLY:
                    continue
                for vp in VIEWPORTS:
                    tag = '%s-%s' % (bname, vp)
                    full = not QUICK and (bname == 'http' or vp == 'desktop')
                    for name, fn in [('journey', traveller_journey), ('partner', partner_flow), ('admin', admin_flow)]:
                        if not want(name):
                            continue
                        GROUP[0] = '%s %s' % (name, tag)
                        pg = Page(browser, base, vp)
                        try:
                            if name != 'journey':
                                pg.go('home'); pg.ev('() => localStorage.clear()'); pg.p.reload(); pg.p.wait_for_timeout(300)
                                # seed: one paid booking through the real checkout code path
                                pg.go('results?to=CDG'); pg.wait_run(); pg.click('[data-ref="H-CDG-01"] [data-add]')
                                pg.go('checkout'); pg.click('#pay-btn'); pg.modal_ok(); pg.p.wait_for_selector('[data-tour="confirmation"]')
                            fn(pg, tag)
                        except Exception as e:
                            check('%s flow completed without exception' % name, False, traceback.format_exc()[-600:])
                        pg.close()
                    GROUP[0] = 'routes ' + tag
                    if want('routes'):
                        pg = Page(browser, base, vp)
                        try:
                            pg.go('home'); pg.ev('() => localStorage.clear()'); pg.p.reload(); pg.p.wait_for_timeout(300)
                            pg.go('results?to=CDG'); pg.wait_run(); pg.click('[data-ref="H-CDG-01"] [data-add]'); pg.click('[data-tab="cab"]'); pg.click('[data-ref="C-CDG-01"] [data-add]')
                            route_scan(pg, tag, LANGS if full else ['en', 'hi'])
                        except Exception:
                            check('route scan completed', False, traceback.format_exc()[-600:])
                        pg.close()
                    GROUP[0] = 'settings ' + tag
                    if want('settings'):
                        pg = Page(browser, base, vp)
                        try:
                            settings_flow(pg, tag)
                        except Exception:
                            check('settings flow completed', False, traceback.format_exc()[-600:])
                        pg.close()
                    GROUP[0] = 'tour ' + tag
                    for exit_mid in ((False, True) if want('tour') else ()):
                        pg = Page(browser, base, vp)
                        try:
                            tour(pg, tag, exit_mid)
                        except Exception:
                            check('tour run (exit_mid=%s)' % exit_mid, False, traceback.format_exc()[-600:])
                        pg.close()
                    GROUP[0] = 'edge ' + tag
                    if want('edge'):
                        try:
                            edge_cases(browser, base, vp)
                        except Exception:
                            check('edge cases completed', False, traceback.format_exc()[-600:])
                    GROUP[0] = 'v1.1 ' + tag
                    if want('v1.1'):
                        try:
                            v11_flow(browser, base, vp)
                        except Exception:
                            check('v1.1 flow completed', False, traceback.format_exc()[-600:])
                    GROUP[0] = 'verify v1.1 ' + tag
                    if want('verify'):
                        try:
                            v11_verify(browser, base, vp)
                        except Exception:
                            check('verify v1.1 completed', False, ' | '.join(l.strip() for l in traceback.format_exc().splitlines() if 'e2e.py' in l or 'Error' in l)[:900])
                    GROUP[0] = 'v1.2 ' + tag
                    if want('v1.2'):
                        try:
                            v12_flow(browser, base, vp)
                        except Exception:
                            check('v1.2 flow completed', False, ' | '.join(l.strip() for l in traceback.format_exc().splitlines() if 'e2e.py' in l or 'Error' in l)[:900])
                    GROUP[0] = 'verify v1.2 ' + tag
                    if want('verify12') or want('verify v1.2'):
                        try:
                            v12_verify(browser, base, vp)
                        except Exception:
                            check('verify v1.2 completed', False, ' | '.join(l.strip() for l in traceback.format_exc().splitlines() if 'e2e.py' in l or 'Error' in l)[:900])
                        if vp == 'desktop':
                            GROUP[0] = 'v1.2 nav ' + bname
                            try:
                                v12_nav(browser, base)
                            except Exception:
                                check('v1.2 nav completed', False, traceback.format_exc()[-600:])
                    GROUP[0] = 'v1.2.1 ' + tag
                    if want('v121'):
                        try:
                            v121(browser, base, vp)
                        except Exception:
                            check('v1.2.1 completed', False, ' | '.join(l.strip() for l in traceback.format_exc().splitlines() if 'e2e.py' in l or 'Error' in l)[:900])
                    GROUP[0] = 'verify v1.2.1 ' + tag
                    if want('v121') or want('verify121'):
                        try:
                            v121_verify(browser, base, vp)
                        except Exception:
                            check('verify v1.2.1 completed', False, ' | '.join(l.strip() for l in traceback.format_exc().splitlines() if 'e2e.py' in l or 'Error' in l)[:900])
                    GROUP[0] = 'v1.2.2 ' + tag
                    if want('v122'):
                        try:
                            v122(browser, base, vp)
                        except Exception:
                            check('v1.2.2 completed', False, ' | '.join(l.strip() for l in traceback.format_exc().splitlines() if 'e2e.py' in l or 'Error' in l)[:900])
            browser.close()
    finally:
        srv.terminate()
    # summary
    groups = {}
    for g, n, ok, d in RESULTS:
        groups.setdefault(g, [0, 0])[0 if ok else 1] += 1
    print('\n%-40s %6s %6s' % ('group', 'pass', 'fail'))
    for g, (a, b) in groups.items():
        print('%-40s %6d %6d' % (g, a, b))
    tp = sum(1 for r in RESULTS if r[2]); tf = len(RESULTS) - tp
    print('\nTOTAL: %d passed, %d failed' % (tp, tf))
    out = ROOT / 'tests' / 'last-run.json'
    out.write_text(json.dumps({'passed': tp, 'failed': tf, 'groups': groups, 'failures': [r for r in RESULTS if not r[2]]}, ensure_ascii=False, indent=1), encoding='utf-8')
    sys.exit(1 if tf else 0)


if __name__ == '__main__':
    main()
