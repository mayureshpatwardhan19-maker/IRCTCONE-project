# IRCTC OneTrip — AI-powered, multilingual integrated travel platform (prototype v1.2.2)

> **One journey. One dashboard. In your language.**
> A working prototype for **Case 13 — "How should IRCTC expand its digital travel platform?"**
> (Business in the Digital Age, SPJIMR PGDM 2026–28).

OneTrip starts with the train: pick two stations and a date, see the trains, book one (simulated), and the
PNR becomes your journey. Then it plans the rest of the trip around the train: hotel, cab, food and sightseeing. AI agents research and *independently verify* every option. The
traveller can speak or type in 11 Indian languages, and every arrangement is managed from one
**My Journey** dashboard with a **Trip Readiness** score.

> ⚠️ **Academic prototype.** All trains, hotels, cabs, prices, payments and analytics are **simulated** and labelled as such.
> There is **no live IRCTC, BHASHINI or bank integration**, and no real payment data is collected. The "BHASHINI layer" is a
> BHASHINI-ready simulation built on the browser's speech APIs, plus optional Gemini.

---

## ▶️ How to run

### Option 1 — Double-click (no installs)
1. Download or clone this repo.
2. Double-click **`index.html`**. It opens in your browser and everything works offline.
   *Use Chrome or Edge for voice input.*

### Option 2 — VS Code
1. `git clone https://github.com/debasishmandal23/IRCTC-Prototype.git` and open the folder in VS Code.
2. Install the recommended extension **Live Server** (VS Code will prompt you; see `.vscode/extensions.json`).
3. Right-click `index.html` → **Open with Live Server** (opens at `http://127.0.0.1:5500`).

### Option 3 — Any static server
```bash
./start-server.sh          # macOS / Linux  → http://localhost:8080
start-server.bat           # Windows (double-click)
# or: python -m http.server 8080   /   npx serve .
```
A local server (Option 2/3) is the most reliable way to get **microphone** permission in Chrome.

There is no build step and no dependencies: plain HTML, CSS and JavaScript (classic scripts, no frameworks, no CDNs).

---

## 🎬 3-minute jury demo

Click **Start demo** in the header. The 25-step guided tour drives the app by itself, so you only press **Next**:

1. **Sign in as a persona** (`#/login`): Sunita Sharma, a family traveller from New Delhi who prefers Hindi. The language,
   home city, party of 3 and preferences load automatically.
2. **For you, Sunita**: the long-weekend detector finds **Christmas (Fri 25 Dec 2026) → a 3-day weekend**. It shows where
   travellers from Delhi are going (aggregated, anonymised, simulated) and a train + hotel + cab + sight **package**.
3. Speak (or play the sample) *"क्रिसमस पर दिल्ली से चंडीगढ़ की ट्रेन बुक करो"* → the app replies **"I heard: …"** with chips
   (Intent, From, To, Date) and opens the **train results** for that date.
4. Book **12011 Kalka Shatabdi, CC** → passengers prefilled → fare summary → **human-in-the-loop confirm** → simulated payment →
   a Google-Pay-style **payment success** screen (amount, UPI ref, transaction ID, PNR) → **PNR + e-ticket**
   (CNF / RAC / WL with a chance of confirmation).
5. **"Now plan your stay in Chandigarh"** → Agent Trace: Orchestrator → Multilingual → Research → **Verification** →
   Recommendation → Itinerary. The package hotel (*Hotel Shivalik View*, partner P-101) and cab are added.
   The **Transport** tab compares the station → hotel leg by cab, auto, bus, metro, e-rickshaw and walking, side by side
   (*"No metro in Chandigarh"* is shown honestly).
6. **My Journey**: the ticket is the first item on the route-line timeline. The conflict between the **11:05 arrival** and the
   **14:00 check-in** is flagged; resolve it → Trip Readiness rises.
7. Checkout → confirm → payment success with **"Your one-page itinerary"** (A4 PDF, PNG, WhatsApp, email). Assistant refund
   question in Hindi → 🔊 listen → escalate.
8. **Partner dashboard** shows the new booking; **Admin & Bank** shows the **long-weekend demand forecast**
   (the data-monetisation use case) and GTV; **Business case** closes the story.

Not taking a train? The home widget has tabs for **Trains | Hotels | Local transport | Food | Sightseeing | Packages**:
any service can be booked on its own and becomes a light trip in My Journey (e.g. *"Stay in Jaipur, 9–11 Nov"*), with
**"Add a train to this trip"** any time.

**New in v1.2.1:** a flight-style **One way | Round trip** toggle on every train search (outward train → return train → passengers →
one payment, two PNRs), **"Add return train"** on My Journey for trips booked one way, and **autos / e-rickshaws are never booked**:
they show "≈ ₹X on meter" with "No booking needed: take one from the prepaid auto booth outside … station; pay the driver".
Say it too: *"book from Chandigarh to Mumbai train on Friday and back on Sunday"*, *"… aur Sunday ko wapas"*, *"वापसी रविवार"*.

**New in v1.2.2:** don't want to pay for the train first? Under **Pay** on the passenger page choose **"Add hotel, transport, food & sightseeing — pay once at the end"**: the train (or both trains of a round trip) waits in your trip unpaid, you add the stay and transport, and checkout charges everything in **one payment** and issues the PNR(s) then.

Try typing any route in the home box, e.g. **"book from Chandigarh to Mumbai train"**, "चंडीगढ़ से मुंबई ट्रेन कल",
"hotel in Hyderabad", "status of my train", "refund kab milega".

Pre-demo checklist: see [`docs/VERIFICATION.md`](docs/VERIFICATION.md#jury-demo-checklist).

---

## 🧭 What's inside

| Interface | Route | Highlights |
|---|---|---|
| **Navigation** | header | Always a horizontal bar on top: Plan trip · Trains · Hotels · Transport · My Journey · Bookings & refunds, with "Partners & admin ▾" on desktop. On tablets and phones the bar scrolls sideways (icons + short labels, active tab kept in view). No hamburger list. |
| **Traveller** | `#/home` | Tabbed booking widget: **Trains** (the main, train-first path) · **Hotels** · **Local transport** · **Food** · **Sightseeing** · **Packages**. Below it, the "type or speak" box with **I heard** chips, sample voice queries, PNR import, **For you** suggestions |
| | `#/hotels?city=&in=&out=&guests=&rooms=&min=&max=` | Hotels on their own, with a visible **Budget per night** control (dual slider ₹500–₹15,000, min/max inputs, quick chips, live "x of y hotels within budget") |
| | `#/transport?city=&from=&to=&date=&time=&pax=` | **Cab · auto · bus · metro · e-rickshaw · walk** side by side for any leg (station, airport, hotel, landmark typeahead): total + per-person price, time, wait/frequency, comfort, luggage, door-to-door, last-mile walk, CO₂, availability (metro only in cities that have one), Cheapest / Fastest / Best-for-your-group badges, source + checked time + verification badge. **Cab, metro and bus have a Book button; auto-rickshaws and shared e-rickshaws do not (v1.2.1):** they run on the meter / are flagged down, so they show "≈ ₹X on meter" (e-rick "≈ ₹20 per person") and "No booking needed: take one from the prepaid auto booth outside <station>; pay the driver" |
| | Pay-on-meter rides (v1.2.1) | In the journey flow "I'll take an auto" puts the ride in the plan, timeline and one-page itinerary as "Pay on meter, ≈ ₹X". It is stored apart from bookable items (`journey.meterRides`), so it is **never** in the cart total, charged, given a booking ref, listed in Bookings & refunds or sent to a partner. Catalogue prepaid-booth autos behave the same. Older saved data with an unpaid auto is migrated on load |
| | Pay once for trains + services (v1.2.2) | On `#/trains/book` (one way, round trip, "Add return train", "Add a train to this trip", and the voice / assistant path) a second choice sits right under **Pay**: *or* **"Add hotel, transport, food & sightseeing — pay once at the end"**. Passengers are validated as for Pay; the train(s) go into the trip **unpaid** (`journey.hold`, status "Not paid yet", no PNR, nothing in `bookings`), and the planning screen opens with the banner *"Trains in your trip (not paid yet) · ₹X · Pay everything at checkout"*. My Journey shows the train stop(s) "Not paid yet — pay at checkout", **Review & pay for everything**, Change / Remove (with confirm); readiness counts an unpaid ticket at 80%. Checkout lists Outward / Return train lines (fare × passengers + convenience fee) and the services with one total; one confirm, **one payment**, and the pop-up shows the PNR(s) and the service refs. Only then do the trains become normal bookings (Bookings & refunds, partner, admin, itinerary, WhatsApp). A train that has left by checkout is blocked with a clear message; picking another train replaces the unpaid one |
| | `#/food?city=`, `#/sights?city=` | Meals and entry tickets on their own |
| | `#/itinerary-print` | **One-page itinerary**: A4 print view (Download PDF = print → Save as PDF), PNG drawn on a canvas, one-tap WhatsApp (opens `wa.me/91<number>?text=…` straight away with the signed-in traveller's mobile; asks for a number only if none is on the profile, with "Change number" under the buttons) and email (mailto with consent + confirm); sends are logged for Admin |
| | `#/trains?from=&to=&date=` | Simulated timetable for any of ~40 stations (typeahead in English and Indian scripts), classes, fares, availability (AVAILABLE / RAC / WL / REGRET), filters and sort, verification badge + source + checked time per train |
| | `#/trains?…&trip=round&ret=` (v1.2.1) | **One way \| Round trip** toggle (home Trains tab and `#/trains`); Round trip reveals a Return date (default depart + 2 days, never before departure). Step 1 picks the outward train + class, step 2 the return train B → A on the return date, then one passenger form, a fare summary with outward + return lines and the total, **one payment** and a pop-up with **both PNRs**. Voice / text: "… on Friday and back on Sunday", "return on 28 Nov", "aur Sunday ko wapas", "वापसी रविवार" (Return chip in "I heard") |
| | `#/trains/book`, `#/trains/ticket?pnr=` | Passengers (persona prefilled), fare breakup, confirm, simulated payment, PNR e-ticket, "plan your stay" CTA |
| | `#/login` | **Demo persona cards**: 4 travellers (Sunita · Delhi · Hindi, Ramesh · Chennai · Tamil pilgrim, Arjun · Pune · Marathi student, Neha · Mumbai · business), Partner P-101, Admin/Bank. The header user menu switches persona or signs out |
| | `#/results?to=` | Budget filter bar on top; the **Transport** tab compares the station → hotel leg across every mode. Any destination station (generated, deterministic listings for cities outside the three scripted scenarios). Live Agent Trace, verified hotels, cabs, food and sightseeing, source + checked time + verification badge, price comparison, read aloud |
| | `#/journey` | **My Journey**: Trip Readiness ring with explanation, chronological route-line timeline, conflict flags and fixes. The return train is the last stop; booked one way, an **"Add return train"** row (after hotel and cab) opens the B → A search on the check-out date and attaches the result to the same journey. Conflict check: a return that leaves before hotel check-out is flagged ("I'll check out early") |
| | `#/checkout` | Booking and payment summary, simulated UPI/card, confirm step, confirmation |
| | Payment success | After every payment (train, standalone, journey): animated check, amount, paid to, UPI ref, transaction ID, date-time, booking refs, Done / View itinerary / Share, a soft chime (mutable), confetti off under reduced motion |
| | `#/bookings` | Standalone hotel / transport / food / sight bookings with cancellation, train ticket with railway-style cancellation charge and refund (outward and return each with their own PNR, cancellable independently), persona trip history, status tracking, policy-based cancellation, refund tracker, support tickets |
| | Assistant drawer | Multilingual chat, 🎤 mic, 🔊 speaker, language switch mid-chat, "show original", human escalation |
| **Tourism Partner** | `#/partner` | Login/registration, listings CRUD, price and availability calendar, enquiries with Partner Agent draft replies, bookings, revenue, conversion and cancellations, feedback |
| **Admin & Bank** | `#/admin` | Users and providers, bookings and GTV, complaints, refunds and SLA, partner performance, destination demand, **long-weekend demand forecast**, financial products (escrow, T+1 settlement), language and support analytics, platform health |
| **Business case** | `#/insights` | Problem, survey evidence, personas, Case Q1–Q5, revenue model, social-mandate guardrails, UTAUT, VRIO, Sense–Seize–Transform, roadmap |
| **How it works** | `#/about` | Agent architecture, BHASHINI pipeline, data and verification rules, what is simulated vs real, privacy (DPDP) |
| **Settings** | `#/settings` | Optional Gemini key, AI mode, voice support check, reset demo data |

Demo logins are prefilled on each login screen (traveller, partner P-101, admin/bank), and `#/login` offers one-click persona sign-in.

**For you, <name>** (home and My Journey): upcoming long weekends from a sample holiday calendar (weekdays computed with
`Date`; Tue/Thu holidays become 4-day weekends with one day of leave), "Trending from <home city>" with aggregated,
anonymised counts, % change and "fills N days early", and a priced package per trend. "Why am I seeing this?" explains the
data used; a DPDP consent switch hides the section. All demand data is simulated.

### AI agents (`js/agents/`)
| Agent | Role in the prototype |
|---|---|
| Orchestrator | Plans the task, dispatches specialists, merges results, decides when a human must confirm |
| Multilingual Communication | Detects language, translates queries and responses, **protects** PNR, train no., station codes, ₹ and dates, voice in/out |
| Research | Looks up the (simulated) provider catalogue; records **source + checked time** |
| Verification | Independently re-checks against the provider source; flags changed, stale, missing or sold-out data |
| Recommendation | Ranks by budget, distance to station, rating and preferences |
| Itinerary | Builds the chronological plan around train timings; detects conflicts |
| Customer Support | Answers booking, cancellation and refund questions with policy citations; escalates to a human |
| Partner | Drafts enquiry replies for partners (partner confirms before sending) |

**Agents never invent prices, availability, ratings or timings.** Values come only from the catalogue, and anything
that can't be verified is shown as *Needs confirmation* or *Unavailable*.

### Languages
English, हिन्दी, বাংলা, मराठी, தமிழ், తెలుగు, ಕನ್ನಡ, മലയാളം, ગુજરાતી, ਪੰਜਾਬੀ, ଓଡ଼ିଆ.
English and Hindi are fully translated. The other nine cover the core journey (navigation, search, results, timeline,
readiness, statuses, assistant), and the remaining text falls back to English.

---

## 🤖 Optional: live AI with Gemini

The prototype runs fully **without** any API key, using deterministic simulated agents. To try live language understanding
and phrasing:

1. Open **Settings** (⚙️ in the header).
2. Paste your Gemini API key → **Test key** → Save.

The key is stored **only in your browser's localStorage**, is sent only to Google's Gemini API, and is **never committed to this repo**.
If a call fails or times out, the app silently falls back to the simulated agents, so a demo never breaks because of Wi-Fi.
Gemini is used only for language. Prices and timings always come from the verified catalogue.

> 🔐 Never paste an API key into code, commits or chat. If a key has been shared, rotate it in Google AI Studio / Cloud Console.

### Voice
- **Speech-to-text** uses the browser's Web Speech API (Chrome or Edge, with mic permission).
- **Read-aloud** uses the system's voices. For Hindi on Windows: *Settings → Time & Language → Speech → Add voices → Hindi*.
- No mic? Use the **sample voice query** buttons, which simulate the transcription.
- If a voice isn't available, the app says so and shows the text instead.

---

## 🗂 Project structure
```
index.html              app shell (open this)
css/                    base.css (design tokens) · traveller.css · dashboards.css
js/core/                util · store (localStorage) · i18n (11 languages) · ui · router (hash routes)
js/data/                travel.js (simulated catalogue) · rail.js (stations, timetable, fares, PNR) · cities.js (any-city listings) · personas.js (personas, holidays, demand) · transport.js (local transport comparison) · analytics.js (simulated KPIs) · survey.js (real survey stats, N=52)
js/services/            language.js (BHASHINI-ready layer: ASR/NMT/TTS/transliteration, simulated) · gemini.js (optional)
js/agents/              agents.js · orchestrator.js
js/lib/charts.js        dependency-free SVG charts
js/views/               one file per screen (services.js = hotels/transport/food/sights, itinerary.js, payment.js, budget.js)
js/tour.js              guided jury demo
docs/                   ARCHITECTURE.md · VERIFICATION.md · research/ (requirements, business case, course frameworks, survey stats)
tests/                  automated end-to-end tests (Playwright): `python3 tests/e2e.py` runs file:// and http at 1440 and 375 px
```

## 🔁 Reset
Settings → **Reset demo data** clears journeys and bookings. You can also clear the site data in your browser.

## How this was built
Six AI agents built this prototype:
- **Three explorers** studied the BRD and brief, the survey and case, and the course decks. Their notes are in `docs/research/`.
- **Two builders** built the traveller/AI side and the dashboards/business-case side in parallel, to the contract in `docs/ARCHITECTURE.md`.
- **An independent verifier** tested it end to end and checked it against the requirements (`docs/VERIFICATION.md`).
