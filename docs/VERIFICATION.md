# IRCTC OneTrip: v1.2.2 builder notes (to be verified)

Builder notes for the owner's v1.2.2 request, written by the builder on 4 Nov 2026. **Not yet independently verified.** The v1.2.1 verification report and everything before it follow unchanged.

> Owner: "Without paying the train tickets, we are not able to go to booking the other services like hotels and transport. Once I have selected both the trains or one train … give an option below the pay option: do you want to add other services, or just pay for the booked trains. If I click on the other services, I can add other services and pay at the last."

## v1.2.2-1. What changed

- **Book page** (`#/trains/book`, one way, round trip, `attach=return`, "Add a train to this trip", the voice / assistant path): under the unchanged **Pay ₹X & book** button there is now an *or* divider and **"Add hotel, transport, food & sightseeing — pay once at the end"** (`#trn-hold`, `data-tour="pay-later"`) with the hint "Your train choice is kept in your trip; you pay for everything together at checkout and the PNR is issued then." When adding a return to an existing journey the label is "Add to my trip and pay later at checkout, with everything else".
- **Holding** validates passengers exactly like Pay, then stores the train(s) in `journey.hold = { legs: [{ leg: 'outward'|'return', no, name, from, to, date, dep, arr, arrDate, cls, farePerPax, chance, pax:[…] }], method, createdAt }`. `journey.train` (and `journey.returnTrain` for a round trip) get `status: 'HELD'`, `held: true`, no PNR, no coach/seats. **Nothing** is written to `bookings`, so Bookings & refunds, partner P-101 and admin GTV/train counts cannot see it. The app opens the destination planning screen (`#/results?to=<city>`, the same "plan your stay" agents run) with the banner **"Trains in your trip (not paid yet) · ₹X · Pay everything at checkout"** and a "Review & pay for everything" button. A pending For-you package is applied as after a paid train.
- **Replace, never duplicate:** holding again for the same destination (another train, another class, or a round trip) replaces the held legs in the same journey and keeps the hotel/cab/food/sights and meter rides. A standalone stay in that city keeps its items too (as with pay-now). Paying now for a train while an unpaid one for the same city is in the trip also keeps the services and drops the unpaid train.
- **My Journey:** the ticket card shows PNR "—" and the badge **"Not paid yet — pay at checkout"**; a saffron box with the amount, **Review & pay for everything**, "Change … train" and **Remove train from trip** (confirm dialog: "nothing to refund"; a held return can be removed alone). Timeline dep/arr (and return) stops carry the same badge. Trip cost lists "Train ticket (not paid yet)" / "Return train (not paid yet)" and adds them to "To pay now"; the main button becomes "Review & pay for everything (n)". **Trip Readiness**: an unpaid ticket / return counts 80% (like any planned item), labelled "In your trip, not paid yet (80%)". Removing the outward when services remain turns the trip into a stay without a train ("Add a train to this trip" again); when nothing remains, My Journey is empty.
- **Checkout:** an intro line, then one line per held train ("Outward · 12011 …", "Return · 12012 …", route, date, class × passengers, names, "Not paid yet · PNR is issued when you pay", Choose another train / Remove), amount = fare × passengers + convenience fee (₹20 UPI/wallet, ₹35 card, same rule as pay-now; the checkout opens on the method chosen on the train page), then the services. Totals: Train tickets (n) + OneTrip services = **one grand total**, "of which train convenience fee". The confirm dialog lists each train (with passengers and amount), each service and the total. One payment books every held leg through the same simulated gateway (`OT.data.rail.book`) and the services in **one transaction**; the pop-up shows **the PNR(s) and the service refs**. The trains then become ordinary train bookings (`leg: 'outward'/'return'` when there are two legs), so Bookings & refunds (independent cancellation, Outward/Return labels), partner/admin counts, the one-page itinerary, WhatsApp text and "Add return train" behave exactly as after pay-now.
- **Departed train:** if a held train has left (or booking has closed 30 min before departure, or it became full), checkout shows "Train 12011 left on … at …, so it can no longer be booked. Remove it from your trip or choose another train.", Pay is disabled and `pay()` refuses; My Journey and the planning banner show the same warning.
- **Bookings & refunds** shows a note "n train(s) in your trip, not paid yet" (not a booking card) while a hold exists.
- **Tour:** new step 8 "Or: add the stay first, pay once" highlights the option; the tour still pays now for the main path. 25 steps.
- **i18n:** Hindi for all 41 new strings (+ `trainStatus.HELD`); the button label in bn, mr, ta, te, kn, ml, gu, pa, or; the rest falls back to English.
- Small hardening: no "PNR null" anywhere for an unpaid train (timeline sub-line, consolidated itinerary, A4/PNG/text itinerary, assistant PNR/status answers).

## v1.2.2-2. Files touched

| File | Change |
|---|---|
| `js/views/trains.js` | option HTML under Pay, `holdForLater`, `OT.trainHold` (get, amount, legAmount, problem, banner, issue, remove, searchPath), pay-now keeps services of an unpaid same-city trip, `attachReturn` drops a held return, `trainBooking` takes the method label |
| `js/views/checkout.js` | train lines, totals, confirm lines, one payment issues PNRs + service refs, departed block, remove |
| `js/views/journey.js` | unpaid badge / note / buttons, cost rows, readiness label, consolidated itinerary |
| `js/views/results.js` | planning banner |
| `js/views/bookings.js` | "not paid yet" note |
| `js/views/itinerary.js` | "Not paid yet" instead of a status code / null PNR |
| `js/agents/agents.js` | readiness HELD = 80%, timeline sub-line, assistant PNR fallback |
| `js/tour.js` | step 8 |
| `js/core/i18n.js` | Hindi + button label in 9 languages |
| `css/traveller.css` | option, banner, note, checkout line styles; checkout Pay button wraps |
| `tests/e2e.py` | new group `v122` |

## v1.2.2-3. Tests

New group `v122` (`python3 tests/e2e.py --only v122`), 1440 and 375, file and http: option position and wording; passenger validation; one-way hold (HELD, no PNR, no booking, amount = pay-now amount, banner text and amount); nothing in Bookings / partner / admin before payment; My Journey badges, button, readiness 24/30, "To pay now" arithmetic, no "null"; reload persistence; checkout line + total + Pay label; confirm dialog; one pop-up with PNR + hotel + cab refs and amount = total; after payment one transaction, sums, Bookings cancellable, partner/admin counts, itinerary PNR, WhatsApp wa.me/917589802655 with the PNR, "Add return train" afterwards; round trip hold, replace the outward with another train (same journey, hotel kept), readiness of the unpaid return, checkout outward + return + hotel arithmetic, two PNRs, Outward/Return, independent cancellation; remove with confirm / Keep it, stay kept as a trip, empty journey when nothing remains; standalone stay → Add a train → both options → same journey; departed train blocked; pay-now unchanged; assistant path + Hindi strings; scans in hi/ta/bn; the full tour (desktop) with the new step.

## v1.2.2-4. Results (builder runs, 4 Nov 2026)

RESULTS_PLACEHOLDER

## v1.2.2-5. Known limitations

1. The unpaid train is not a real seat hold (the prototype has no inventory): availability, RAC/WL status and the chance are decided at checkout. The hint says the PNR is issued at payment.
2. Removing an unpaid outward train while a *paid* return (added with pay-now) exists drops the return from the journey view; its booking stays in Bookings & refunds.
3. Passengers of a held return added later ("Add return train" → pay later) are kept per leg, so they can differ from the outward's.
4. Only Hindi has the new wording; the other 9 languages translate the button label only.

---

# IRCTC OneTrip: v1.2.1 independent verification

Independent verification of v1.2.1 against the owner's three v1.2.1 requests, written on 3 Nov 2026 by a separate agent that did not build v1.2.1. Every claim in the builder notes below was re-checked with the verifier's own Playwright scripts (real clicks, 1440×900 and 375×812, file:// and http), not with the builder's tests. The builder notes and the v1.2 report follow unchanged.

**Result (v1.2.1):** after the 5 fixes in section v1.2.1-V3, `python3 tests/e2e.py --base file` passes **1914 checks with 0 failures** and `--base http` passes **2283 checks with 0 failures** (both at 1440×900 and 375×812, 0 console errors, 0 page errors; http includes the full 11-language route sweep). The verifier's new group `verify v1.2.1` (`--only verify121`) is part of both runs and fails on the builder's code (8 failures) before the fixes.

## v1.2.1-V1. Traceability: owner request → evidence

| ID | The owner asked for | Verdict | Evidence (verifier's own probes + tests) |
|---|---|---|---|
| A | Autos run on the meter / are caught at the station: **no booking option**, only an approximate amount and "get it from the station" (builder also applied this to shared e-rickshaws); cab, metro and bus keep Book | **Pass** (after fixes #1, #2) | `#/transport?city=NDLS`, `JP`, `CDG`, the home "Local transport" tab and the journey Transport tab: auto and e-rick cards have **no button at all** on `#/transport`, show "≈ ₹30 on meter" / "≈ ₹20 per person" and "No booking needed: take one from the prepaid auto booth outside {city} station; pay the driver" / "flag one down at the e-rickshaw stand outside …". Cab, bus and metro (NDLS → airport) keep **Book** and booking them works (checkout → pay → confirmed). Journey: "I’ll take an auto" → My Journey row "Pay on meter, ≈ ₹30" with Remove (Remove works) → checkout has no auto line → payment ₹5,300 = hotel only (with a cab: ₹5,300 + ₹350 = ₹5,650, pop-up amount = sum of bookings) → no auto in booking refs, Bookings & refunds, Partner P-101 or Admin live data / GTV → the itinerary (A4, 1 page; PNG; WhatsApp text) shows the auto as "Pay on meter" and "not included in the total". Cab replaces auto and auto replaces cab for the same leg, **including the catalogue booth auto and the station cab** (fix #1). Older v1.2 data with unpaid autos/e-ricks migrates without errors (V2 item 8). |
| B | All persona mobiles = 7589802655; WhatsApp after payment opens **wa.me directly** for the signed-in user's number with the itinerary typed, no prompt when the profile has a number; a **clean** prompt when it has to ask | **Pass** | Signed in from the visible `#/login` page as Sunita, Ramesh, Arjun and Neha in turn: phone "+91 75898 02655"; after a train payment the pop-up WhatsApp button calls `window.open('https://wa.me/917589802655?text=…')` with the itinerary text containing the PNR, and no modal opens (both widths, both bases). Partner and Admin personas: "+91 75898 02655". Signed out: a clean prompt (+91 prefix, placeholder "98765 43210", save-to-profile tick, DPDP line); "98765 43210" opens `wa.me/919876543210`, the next click opens directly, **Change number** re-prompts and "+91 70000 12345" is used, "12345" shows "Enter a 10-digit Indian mobile number." Email from the pop-up opens **above** it (topmost element is the email dialog). A stale v1.2 profile (old masked phone) still resolves to 7589802655. |
| C | Return train, flight-style **One way \| Round trip**; after A → B (and other services) also book B → A | **Pass** (after fixes #3, #4) | Home and `#/trains`: toggle, Return date (default +2/+3 days), return-before-departure, past departure and past return all rejected on both forms. NDLS ⇄ CDG: "step 1 of 2" → "step 2 of 2" (CDG → NDLS on the return date, outward shown with Change) → one passenger form → fare summary outward ₹1,850 + return ₹1,850 = ₹3,700 (12012 now priced like 12011, fix #4) → confirm lists both trains → **one** payment → pop-up with **both PNRs**, each on its own row, inside the 375 px screen → Bookings shows Outward / Return; cancelling the return alone shows the railway refund and brings "Add return train" back; the outward then cancels on its own. One way + hotel + auto → My Journey "Add return train" (CDG → NDLS on the check-out date, `attach=return`) → book → same journey id, return is the last timeline stop, persists after reload, in the A4 itinerary (1 page) with its PNR; check-out 11:00 vs 12:15 return correctly raises no conflict. Voice and text (typed **and** the mic with a fake recogniser) for the four owner phrases give the right dates against the browser's real date (Tue 3 Nov 2026 → Fri 6 Nov / Sun 8 Nov; 20 Nov / 28 Nov), the Return chip and Round trip on; "book from Chandigarh to Mumbai train" stays one way (tomorrow). |
| REG | Guided tour, every route in 11 languages, no regressions | **Pass** (after fix #5) | "Start demo" with only Next: all 24 steps on desktop and phone, file and http, 0 errors; step 16 opens the pre-filled return search, step 17 books it (6 bookings at the end, no auto). Full suites below. |

## v1.2.1-V2. Verifier results per item

| # | Item | Result | Notes |
|---|---|---|---|
| 1 | `#/transport` NDLS / JP / CDG, home Local transport tab, journey Transport tab | PASS | Every card checked in 3 cities × 2 widths × 2 bases; metro and bus booked from `#/transport` (NDLS → airport). |
| 2 | Auto through journey, checkout, pay, refs, Bookings, partner, admin, itinerary; one mode per leg; arithmetic | PASS after fix #1 | Totals: ₹5,300 + ₹350 = ₹5,650 paid = pop-up = confirm dialog; itinerary "Total paid" ₹8,270 = outward ₹1,850 + hotel ₹5,300 + return ₹1,120 (fares before fix #4); the ≈ ₹30 auto is shown separately and never added. |
| 3 | Four owner phrases, typed and voice; v1.1 one-way phrase | PASS | 5 phrases × typed/mic × 2 widths × 2 bases; edge phrases probed (see limitation 2). |
| 4 | Round trip NDLS ⇄ CDG via the UI | PASS after fix #4 | Validation, steps, fare = total, one payment, 2 PNRs readable on a phone, Outward/Return, cancel return then outward. |
| 5 | One way + hotel → Add return train → book → reload | PASS | Same journey, last stop, itinerary, persists. |
| 6 | WhatsApp per persona, signed-out prompt, Change number, email over pop-up, partner/admin phones | PASS | Now also a permanent test (`verify v1.2.1`). |
| 7 | Start demo, Next only | PASS | 24/24 steps, desktop and phone. |
| 8 | v1.2 localStorage with unpaid autos (generated by running the v1.2 `main` code: paid auto booking, unpaid e-rick, unpaid booth auto) | PASS | Migrated to 2 pay-on-meter rides; paid auto stays a cancellable booking; 11 routes render on both bases and widths with no errors. |
| 9 | Routes × 11 languages, no NaN/undefined/placeholders/mojibake, no 375 overflow; Hindi for new strings | PASS after fix #2 | Hindi has all 120 new keys; the other 9 languages fall back to English for 108 of them (limitation 1). |
| 10 | Screenshots reviewed by eye | PASS after fixes #2, #5 | See the list in section V5. |

## v1.2.1-V3. Bugs found and fixed

| # | File(s) | Fix |
|---|---|---|
| 1 | `js/views/services.js`, `js/views/results.js` | **Two autos and a cab for the same station → hotel transfer:** the catalogue "Prepaid auto-rickshaw (station booth)", the comparison auto and the "Station → hotel sedan transfer" had different leg keys, so a presenter could plan all three (timeline showed 11:15 booth auto, 11:20 cab, 11:20 auto). The station transfer is now one leg whichever card it comes from: a station auto replaces the other station auto and drops an unpaid station cab, and any station cab drops the planned auto (also in `OT.trip.add`). A station → landmark auto is not treated as the transfer. |
| 2 | `css/traveller.css` | **Meter prices clipped on phones:** "≈ ₹20 per person" ran 9 px past the e-rickshaw card at 375 px (37 px at 320) and "In your plan · pay on meter" ran 28 px past the card, making the results page 2 px wider than the screen. The meter price and the meter button now wrap inside the card. |
| 3 | `js/agents/agents.js` | **Return date in the wrong year:** "train from Delhi to Jaipur on 20 Nov, return on 2 Nov" set the return to **2 Nov 2027**. A return that only parses by rolling into the next year (more than 180 days out) is now ignored like any return before departure; "28 Dec … return on 3 Jan" still gives 3 Jan. |
| 4 | `js/data/rail.js` | **Return cheaper than outward on the same route:** 12011 Kalka Shatabdi CC was ₹915 but 12012 (the return) was a generated ₹550, so the headline round trip read ₹1,850 out / ₹1,120 back. 12012 now has the same CC sample fare as 12011. |
| 5 | `tests/e2e.py` | New group `verify v1.2.1` (`--only verify121`, runs with `v121` too): station-transfer one-way rule (booth auto, station cab, comparison auto), no text past a transport card and no overflow after "I’ll take an auto" at 375 (en + hi), the year-roll and New-Year return phrases, equal 12011/12012 fares, and WhatsApp from the payment pop-up for each traveller persona signed in from the visible login page. |

## v1.2.1-V4. Full runs (after the last code change)

| Run | Passed | Failed |
|---|---|---|
| `python3 tests/e2e.py --base file` | 1914 | 0 |
| `python3 tests/e2e.py --base http` | 2283 | 0 |
| of which `verify v1.2.1` | 46 per base (20 desktop + 26 mobile) | 0 |

Builder baseline before the fixes, same machine: file 1868 / 0.

## v1.2.1-V5. Screens reviewed by eye

Transport comparison (1440, 375, e-rick card after fix), results Transport tab with the meter button, home Round trip (1440, 375), "I heard" with the Return chip, return list (step 2 of 2), round-trip book page, two-PNR pop-up (1440, 375), WhatsApp number prompt and its error state, email dialog over the pop-up, Bookings with Outward/Return, My Journey with the meter auto row and the return as the last stop (375), the one-page itinerary with return band and meter auto (A4, 1440), and tour steps 9, 12, 15–18. No overlap or clipping remains at 375; full-page phone captures show the sticky header mid-page, which is a capture artefact, not a defect.

## v1.2.1-V6. Remaining limitations (most severe first)

1. **Medium: only Hindi has the new v1.2.1 wording.** In the other 9 languages, 108 of the 120 new strings (meter notes, return-train labels, add-return texts) show in English; the toggle, "Return date" and "Pay on meter" are translated. Demo in English or Hindi.
2. **Medium: the return parser is keyword-based.** "I want to go back home to Delhi from Jaipur" or "… going back home" switches on Round trip (return = 2 days later); "back the same day" is not understood (2 days later). "cancel my return ticket" is read as a train search, as "cancel my ticket" already was in v1.2. The toggle can always be switched to One way by hand. Use the rehearsed phrases.
3. **Medium (builder): a paid auto booking from an older version stays a normal, cancellable booking** (money was taken).
4. **Low: at 320 px, My Journey is 16 px wider than the screen** (three cards; present since v1.2). 375 px and wider are clean.
5. **Low: the catalogue station cab and the comparison cab can still both be planned** for the station → hotel leg (v1.2 behaviour; autos can no longer stack with either).
6. **Low: "Autos on meter (1)" in Trip cost also counts e-rickshaws;** the timeline names the mode correctly.
7. **Low (builder): a round trip charges the simulated convenience fee per ticket; "I’ll check out early" does not change the hotel booking; the tour books the first bookable return class.**
8. **WhatsApp is a wa.me hand-off:** the chat opens with the text typed and the traveller taps Send; nothing is sent by a server. All personas share the owner's number 75898 02655, so every demo message goes to that phone.

## Jury demo checklist

1. Use **Chrome or Edge** on a laptop (window ≥ 1280 px). Open `index.html` by double-click, or run `start-server.bat` / `.sh` (a local server remembers mic permission).
2. Before the jury arrives: **Settings → Reset demo data**. Check the top bar shows Plan trip · Trains · Hotels · Transport · My Journey · Bookings & refunds.
3. Set **AI mode to "Simulated only"** unless the Wi-Fi and the Gemini key were tested that morning. Keep the language on **English or Hindi** for the return-train and auto story (other languages show some new labels in English).
4. Make sure **WhatsApp (web or app) is signed in on 75898 02655**: every persona's WhatsApp button opens that chat directly with the itinerary typed. Allow pop-ups for the page.
5. **Allow the microphone.** Rehearse "book from Chandigarh to Mumbai train" (one way, tomorrow) and "book from Chandigarh to Mumbai train on Friday and back on Sunday": the Return chip appears and the form flips to **Round trip**. Avoid "going back home" phrasing.
6. Scripted run: **Start demo** and only *Next* (25 steps since v1.2.2; step 8 points at the new pay-once option). Step 17 opens the pre-filled return search, step 18 books it: point at the two PNRs on My Journey. **×** or Esc exits.
7. Round trip by hand: **Trains → Round trip → New Delhi → Chandigarh**, pick 12011 CC, then 12012 CC on the return date → one passenger form → outward + return = total → **one** payment → pop-up with **both PNRs** → **WhatsApp** opens directly. In **Bookings & refunds** cancel only the return: the refund shows and My Journey offers **Add return train** again.
8. Autos: **Transport → Chandigarh**: the auto and e-rickshaw cards have **no Book button**, only "≈ ₹30 on meter" / "≈ ₹20 per person" and "take one from the prepaid auto booth outside Chandigarh station". In the journey Transport tab press **I’ll take an auto**: My Journey shows "Pay on meter", checkout and the payment exclude it, the one-page itinerary lists it as "not included in the total". Picking the cab replaces the auto.
9. Standalone story: **Hotels → Jaipur → Book now → pay** → pop-up → **Download PDF / WhatsApp** → My Journey "Stay in Jaipur" → **Add a train to this trip**.
10. Close other tabs, zoom 100% (Ctrl+0), notifications off. Trains, fares, hotels, transport and sends are **simulated**; say so if asked.

---

# IRCTC OneTrip: v1.2.1 builder notes (to be verified)

Builder notes for the owner's two v1.2.1 requests, written by the builder on 3 Nov 2026. **Not yet independently verified.** The v1.2 verification report follows below unchanged.

Already on this branch before this work: one-tap WhatsApp share (`js/views/itinerary.js`) and every persona phone set to +91 75898 02655 (`waSample` 7589802655).

## v1.2.1-1. What changed

**Request 1: auto-rickshaws and shared e-rickshaws are never booked.**
- `#/transport`, the home "Local transport" tab and the journey Transport tab show auto and e-rickshaw with **no Book / Select / Add button**. Instead they show "≈ ₹X on meter" (e-rick: "≈ ₹20 per person") and a note: "No booking needed: take one from the prepaid auto booth outside {Station} station; pay the driver" (e-rick: "flag one down at the e-rickshaw stand outside {Station} station"). Cab, metro and bus keep **Book**. The Cheapest / Fastest / Best-for-group badges still consider autos, but an auto card never has a booking button.
- `js/data/transport.js` no longer registers a catalogue item for auto / e-rick (`opt.meter = true`, `opt.note2`). The prepaid-booth autos in the catalogue (`C-CDG-03`, `C-MDU-01`, `C-PURI-01`, generated `C-<city>-2`) are flagged `mode:'auto', meter:true`. Their results cards show "≈ ₹X" and "I’ll take an auto" instead of "Add to journey"; packages never pick them.
- Journey flow: "I’ll take an auto" stores a ride in **`journey.meterRides`** (`OT.meter` in `js/views/services.js`), never in `journey.items`. So it can never reach the cart total, the payment, a booking ref, Bookings & refunds, the partner dashboard or admin GTV. It shows in the plan, the timeline ("Pay on meter", ≈ ₹X, the note, Remove), the trip cost ("not charged here"), checkout (a note, no line), the one-page itinerary (A4, PNG, WhatsApp/email text) and readiness (a station transfer by auto counts in full, as there is nothing to book). One mode per leg: picking the cab drops the auto for that leg and vice versa.
- Older saved data: an unpaid auto / e-rick in `journey.items` is moved to `meterRides` on boot, on My Journey and on checkout; checkout also filters meter items defensively. A paid legacy auto booking still renders (and stays cancellable, since money was taken).

**Request 2: return trains, flight-style.**
- Home Trains tab and `#/trains`: **One way | Round trip** segmented toggle (radio group, arrow keys). Round trip reveals a **Return date** (default departure + 2 days; must be ≥ departure, validated on both forms, past dates rejected).
- Flow: outward list (`trip=round&ret=`, "step 1 of 2") → pick class → return list B → A on the return date (`step=ret&ono=&ocls=`, "step 2 of 2", outward choice shown with Change) → pick class → one passenger form → fare summary with **outward and return lines and the total** → confirm (lists both trains) → **one payment** → pop-up with **both PNRs** and both booking refs. Two train bookings (`leg: 'outward' | 'return'`, same `txn`, same `journeyId`); `journey.returnTrain` holds the return; hotel nights follow the return date. Hotel / cab / food / sightseeing planning then continues for the destination as before.
- Voice and text (`OT.agents.parseCommand` + `splitReturn` in `js/agents/agents.js`): "… on Friday and back on Sunday", "return on 28 Nov", "round trip", "return ticket", Hinglish "aur Sunday ko wapas", Hindi "वापसी रविवार" / "… रविवार को वापस". The return weekday is counted from the outward date. The home "Understood" preview and the trains "I heard" panel show a **Return** chip, and the form flips to Round trip.
- Booked one way: My Journey shows **"Add return train"** as the last timeline row (after hotel and cab), pre-filled B → A on the hotel check-out date (else trip end / arrival + nights), `attach=return`. The booked ticket attaches to the **same** journey (same id, outward PNR and items kept). For sample (IRCTC-imported) journeys the old "Link return PNR" stays next to it.
- The return appears as the **last stop** on the railway timeline (with PNR and status), as a return ticket card under the outward ticket, in the trip cost, in checkout ("Paid, not charged again"), in **Bookings & refunds** with its own PNR and a "Return" label, **cancellable on its own** with the railway refund rule (cancelling it frees "Add return train" again and leaves the outward ticket), in the one-page itinerary (A4 return band, PNG band, "Return PNR" in WhatsApp/email text) and in admin live data (two train tickets).
- Trip Readiness counts the return (CNF full, RAC/WL partial). New conflicts: return leaves before the outward arrival, and **return leaves before hotel check-out** (fix: "I’ll check out early").
- Guided tour: the train-search step mentions the toggle; step 15 now only fixes the cloakroom; **new step 16 "Add the return train"** opens the pre-filled return search; **new step 17 "Return booked"** books it through the real flow (pax, confirm, pay) and lands on My Journey. 24 steps.
- Hindi strings for every new text; ret.oneWay / ret.round / ret.date / tx.meterBadge / ret.add for the other 9 languages, the rest falls back to English.

## v1.2.1-2. Files touched

| File | Change |
|---|---|
| `js/data/transport.js` | auto / e-rick → `meter`, no catalogue item, `meterNote()`, `isMeter()` |
| `js/data/travel.js`, `js/data/cities.js` | prepaid-booth autos flagged `mode:'auto', meter:true`, honest descriptions |
| `js/data/personas.js` | packages never pick a meter auto |
| `js/views/services.js` | `OT.meter` (rides, migrate), meter cards in the comparison, "I’ll take an auto", `OT.trip.add` refuses meter items |
| `js/views/results.js` | meter catalogue cards, `addItem` routes meter items to `OT.meter`, one way per leg |
| `js/views/checkout.js` | payable lines exclude meter items, meter note, return-train line |
| `js/views/trains.js` | toggle + date pair (shared with home), round-trip steps, book/pay both, attach return, ticket shows the return |
| `js/views/home.js`, `js/views/assistant.js` | toggle on the Trains tab, return from voice/text |
| `js/views/journey.js` | meter rows, return card / cost, "Add return train", return conflicts, readiness label |
| `js/views/bookings.js` | Outward / Return labels, cancelling the return only cancels the return |
| `js/views/itinerary.js` | return PNR band (A4 + PNG), text, meter rows and note |
| `js/agents/agents.js` | parser `splitReturn`, meter + return events, `liveReturn`, readiness, conflicts |
| `js/tour.js` | 2 new steps, Round trip mention |
| `js/core/i18n.js` | Hindi for all new strings + 5 core labels in 9 languages |
| `js/app.js` | migrate older meter data on boot |
| `css/traveller.css` | toggle, date pair, return cards, meter notes |
| `tests/e2e.py` | new `v121` group; one v1.2 check now excludes meter modes from "bookable modes need a verified source" |

## v1.2.1-3. Tests

New group `v121` (`python3 tests/e2e.py --only v121`), at 1440 and 375, on file and http:
- `#/transport` for New Delhi, Jaipur and Chandigarh: auto and e-rick have no Book button and show the ≈ meter fare and the booth / flag-down note; cab, bus and metro keep Book; Hindi wording; the home Local transport tab.
- Journey flow: the catalogue prepaid auto has no "Add"; "I’ll take an auto" → `meterRides`, swaps with the cab per leg; timeline row, cost note, "To pay now" excludes it, readiness; checkout has no auto line; payment creates only the hotel booking; Bookings has nothing to cancel for it; the partner dashboard never sees it; the itinerary shows it but not in the total; legacy data with an unpaid auto + a paid old auto booking migrates and every page renders.
- Round-trip UI: toggle, default return date, validation on home and `#/trains`, back to One way, Hindi labels.
- Parser and voice: the three Friday/Sunday phrases (English, Hinglish, Hindi), "return on 28 Nov", no-return regression, the typed path opens `ret=Sunday` with a Return chip in "I heard", the simulated-ASR Hindi path.
- Round-trip booking: return list B → A, both summaries, outward + return fare lines = total, one Pay, confirm lists both, pop-up with 2 PNRs, 2 bookings in one transaction, `journey.returnTrain`, the timeline ends with the return, readiness, planning continues, hotel check-out on the return day, return-before-checkout conflict + fix, A4 1 page, PNG, text, WhatsApp opens `wa.me/917589802655` with the return PNR, admin counts both tickets, independent cancellation with the railway refund.
- Add return later: the pre-filled `attach=return` link after hotel and cab, same journey, own PNR, checkout line, itinerary print, persists after reload.


## v1.2.1-4. Results (builder runs, 3 Nov 2026)

| Run | Passed | Failed |
|---|---|---|
| `python3 tests/e2e.py --base file` (all groups, 1440 + 375) | 1868 | 0 |
| `python3 tests/e2e.py --base http` (all groups, 1440 + 375; full 11-language route sweep) | 2237 | 0 |
| of which `v121` | 249 per base (119 desktop + 130 mobile) | 0 |
| of which the guided tour (now 24 steps, plus Exit mid-way) | 161 per base | 0 |

0 console errors and 0 page errors in every group. New screens were screenshotted at 1440 and 375 and reviewed by eye (transport comparison, journey with an auto, home Round trip, return list, round-trip book page, two-PNR pop-up, round-trip journey, add-return journey). Two layout fixes came out of that review: the date pair now gets a full row when Round trip is on, and the pay button wraps instead of clipping.

## v1.2.1-5. Known limitations and risks

1. **Medium: a paid auto booking from an older version stays a normal, cancellable booking** (money was taken, so it must stay refundable). Only unpaid autos are migrated to pay-on-meter.
2. **Medium: the parser handles one return phrase per sentence** in English, Hinglish, Hindi, Marathi ("परत") and Bengali ("ফিরে"). Other languages fall back to One way (the toggle still works by hand). A return date before the outward date is ignored (2 days later is used).
3. **Low: a round trip charges the simulated convenience fee per ticket** (two PNRs), shown on the fare summary.
4. **Low: hotel check-out for a round trip is the return date at the hotel's check-out time.** If the return leaves before that, the conflict is flagged; "I’ll check out early" marks it resolved but does not change the hotel booking.
5. **Low: in the guided tour the return is booked in step 17 using the first bookable class.** If every class on that date were full (simulated REGRET), the step only shows My Journey.

## v1.2.1-6. What the verifier should probe

- `#/transport?city=NDLS`, `?city=JP`, `?city=CDG`: auto / e-rick cards have no Book or Select button, show "≈ ₹X on meter" / "≈ ₹20 per person", "No booking needed: take one from the prepaid auto booth outside … station; pay the driver".
- `#/results?to=CDG` → Transport tab → "I’ll take an auto" → My Journey (Pay on meter row) → checkout (no auto line) → pay → Bookings (no auto) → Partner P-101 (no auto) → `#/itinerary-print` (auto row, not in total).
- Home: type **"book from Chandigarh to Mumbai train on Friday and back on Sunday"**, then "Chandigarh se Mumbai train Friday ko aur Sunday ko wapas", "चंडीगढ़ से मुंबई ट्रेन शुक्रवार को, वापसी रविवार", "train from Delhi to Jaipur on 20 Nov, return on 28 Nov".
- Round trip NDLS ⇄ CDG: outward → return → pax → one payment → pop-up with 2 PNRs → Bookings: cancel the return only, then the outward.
- One-way booking + hotel → My Journey "Add return train" → book → same journey; reload.
- Start demo: steps 16–17 (return), then checkout and the partner step.

---

# IRCTC OneTrip: Verification report (v1.2)

Independent verification of v1.2 against the owner's six v1.2 requests, in the owner's own words, plus regressions of v1 and v1.1. Verified on 2 Nov 2026 by a separate agent that did not build v1.2. The v1.1 and v1 reports follow below as history.

**Result (v1.2):** after the 10 app fixes in section v1.2-3, `python3 tests/e2e.py --base file` passes **1601 checks with 0 failures**, and `--base http` passes **1970 checks with 0 failures**. Both cover 1440×900 and 375×812, with 0 console errors and 0 page errors. The new screens were screenshotted at 1440 and 375 and reviewed by eye (pop-up, hotels, transport, food, sights, journey without a train, add-a-train, itinerary print in en/hi, nav in en/hi/ta/ml, tour steps 9 and 18 on a phone).

## v1.2-1. Traceability: the owner's six v1.2 requests

| ID | The owner asked for | Where in the UI | Status | Evidence (tests + screenshots) |
|---|---|---|---|---|
| V1 | "book hotels or cabs or any other services individually … from a particular place to particular place", without a train | Home widget tabs (Trains · Hotels · Local transport · Food · Sightseeing · Packages); `#/hotels`, `#/transport`, `#/food`, `#/sights`; standalone checkout → Bookings & refunds → cancel; My Journey "Stay in {city}" with **Add a train to this trip** | Pass (after fixes #2–#5, #9, #10) | Hotel, transport, food and sight booked or added with no train. The standalone hotel and transport legs are cancellable in Bookings. **Adding a train keeps the stay and transport** (checked by refIds). After a reload, the paid amount still equals My Journey's cost. Another city's page says a new trip will start, and **asks before replacing** the current trip. |
| V2 | "plan trip, trains, my journey, booking and refunds all should come on the top, not as a list" | Horizontal tab bar under the header; "Partners & admin" menu on desktop, inline links on phones | Pass (after fixes #6, #7) | No hamburger at 320, 375, 414, 600, 768, 1024, 1280, 1366, 1440 or 1920. **The four requested tabs are fully on screen at every width, in all 11 languages** (probed). There is no page overflow. The menu opens and closes by mouse, Enter, **ArrowDown/Up**, Escape (focus returns) and Tab-out. |
| V3 | A Google-Pay-like "payment confirmed" pop-up | `.ps-overlay` after train, standalone and journey checkouts | Pass (after fix #8) | The builder's washed-out screenshot was a **mid-fade capture**. The settled state (after 1.5 s) has overlay and card opacity 1 and a white card. Done, View itinerary, Share, PDF, WhatsApp and Email are reachable at 375. Reduced motion means no confetti and no transform. Mute persists after a reload. On a phone, the tour card no longer covers the pop-up (steps 9 and 18). |
| V4 | Buses and metros with side-by-side cab/metro/bus prices | `#/transport` and the journey Transport tab | Pass (after fix #2) | Cab, auto, metro, bus, e-rickshaw and walk are shown side by side with total and per-person prices, time, frequency, comfort, luggage, door-to-door and CO₂. The Cheapest, Fastest and Best-for-your-group badges are correct (the auto at 7+4 min beats the cab at 7+6). "No metro in Chandigarh" is stated honestly. Booking a mode works, and the leg can be cancelled. The phone layout is two columns: dense but legible. |
| V5 | A budget range clearly visible and settable (₹3,000/₹5,000) | Budget control on `#/hotels`, results and the ticket "plan the stay" step | Pass | The slider, min/max inputs and chips stay in sync. "x of y hotels within budget" is shown, and every hotel shown is within the range. Typed **and** voiced (fake recogniser) "hotel in Jaipur under 3000" both show **"Up to ₹3,000"**, set max = 3000, give "4 of 6 within budget", and every price is ≤ 3000. |
| V6 | A one-page itinerary snapshot/PDF to WhatsApp and email after payment | Pop-up "Your one-page itinerary"; My Journey card; `#/itinerary-print` | Pass | `page.pdf` is **exactly 1 A4 page** for a long journey (train + meal + hotel + cab + 2 sights + cloakroom + return, 13 rows), in **English and Hindi**. The PNG is drawn on a canvas. WhatsApp uses `https://wa.me/91XXXXXXXXXX?text=` (URL-encoded) after consent and a confirm step. Email uses `mailto:` with subject and body. The admin notifications log masks recipients ("+91 98XXX XX210", "su…@…"). Nothing claims a real send: every result says "(simulated)" and notes that a production system would use the WhatsApp Business API. |
| REG | v1.1 flows, the 22-step tour, no console errors, no secrets | | Pass | The full suites listed below re-ran: persona sign-in, For you, the "book from Chandigarh to Mumbai train" voice and typed paths, train-first booking, refunds, partner "New via OneTrip", admin totals, and the tour at both widths plus Exit mid-way. The secrets grep found only the fake test key. |

## v1.2-2. Test changes

- New **`v12_verify`** group (independent; run with `--only verify12`), at both widths:
  - login persona cards free of the payment-card styles
  - phone nav: four required tabs on screen in en/hi/ta/ml
  - "Partners & admin" keyboard support
  - payment pop-up in its settled state, with all buttons reachable
  - mute after reload
  - Jaipur stay cost after reload = amount paid
  - transport leg resolves after reload
  - other-city banner and "ask before replacing"
  - "Add a train" keeps the items
  - a transport search in a new city doesn't block its listings
  - `#/food` and `#/sights` book and add standalone
  - trains that already left today are not bookable
  - Hindi itinerary is one A4 page with no real-send claim
- **Tour** group: on a phone, while the payment pop-up is open, the highlighted part must sit above the tour card.
- `modal_ok(keep_success=True)` keeps the pop-up open when a test inspects it (the builder's helper closes it by default).

## v1.2-3. Bugs found and fixed in v1.2

| # | File(s) | Fix |
|---|---|---|
| 1 | `js/views/auth.js`, `css/traveller.css` | **Class collision `.ps-card`:** the v1.1 login persona cards and the new payment card shared the class. The login cards picked up the pop-up's centring and `translateY(14px) scale(.98)`, and the pop-up picked up the persona flex/border styles. The login class is now `.login-persona`. |
| 2 | `js/views/services.js`, `js/core/i18n.js` | **Wrong banner:** `#/transport` (and hotels, food, sights) for New Delhi said "Bookings here attach to your trip 'Stay in Jaipur'". The banner now follows the searched city: "Your current trip is to Jaipur. Booking in New Delhi starts a new trip 'Stay in New Delhi'; we ask before replacing anything…" (en + hi). Booking behaviour was already correct: it asks first. |
| 3 | `js/data/travel.js` | **After a reload, generated-city listings vanished:** a paid ₹6,400 two-night Jaipur stay showed **₹3,200** in My Journey (price × 1 night), with its policy and source gone. `travel.get()` now rebuilds the city on demand from the id. |
| 4 | `js/data/transport.js`, `js/core/store.js` | Booked local-transport legs (`TR-…`) could not be resolved after a reload (basis, policy and source were lost). Each offered leg is now persisted (`txItems`, capped at 120) and restored by `get()`. |
| 5 | `js/data/cities.js` | **"No verified options" on Food/Hotels:** `ensureCity` skipped generating a city's listings if any item existed, including a transport leg. After a transport search, or the restored leg in #4, Jaipur food showed nothing. Transport legs are now ignored by that guard. |
| 6 | `js/views/shell.js` | **"Partners & admin" keyboard:** ArrowDown scrolled the page and closed the menu, so items were unreachable by keyboard. ArrowDown/Up now open and move through the items, and Tab-out closes the menu. |
| 7 | `css/traveller.css` | **Phone nav hid the requested tabs:** at 375 px "Bookings & refunds" was off-screen (en), and in ta/ml "My Journey" was too. The inline partner links (`display: contents`) jumped to the front of the row. Malayalam/Telugu labels were clipped. On ≤ 640 px the four requested tabs now come first, each capped at 23 vw with two-line labels (no mid-word breaks), so they fit at 320 px in all 11 languages. Hotels, Transport and Partners follow in the scroll row. |
| 8 | `js/tour.js`, `css/traveller.css` | **The tour card covered the payment pop-up on a phone** (Done, Share and the itinerary buttons at steps 9 and 18). While the pop-up is open, the tour card is compact (2-line notes), the overlay gets scroll room, and the tour lifts the highlighted part above the card. |
| 9 | `js/data/rail.js` | **Trains that had already left today were bookable:** a 04:15 train was booked at 21:40, and 12011 was always "AVAILABLE". Same-day trains now become DEPARTED 30 minutes before departure (the 12011 shortcut comes after this rule), and planned journeys never pick a departed train. |
| 10 | `js/views/journey.js` | **"Add a train to this trip" late in the evening offered only departed trains,** because it searched today. It now searches the evening before the stay only when that is still ahead, otherwise the stay's start day. |
| 11 | `tests/e2e.py` | `v12_verify` group and the tour phone check (see v1.2-2). The builder's pop-up screenshot now waits for the settled state, so review shots are no longer mid-fade; the v1.2 group was re-run after that change: 148/148 on file and on http. |

## v1.2-4. Remaining known limitations (most severe first)

1. **Medium: WhatsApp and email are hand-offs** (wa.me / mailto). No server send; this is labelled "(simulated)" everywhere and explained in the dialogs. A production system would need the WhatsApp Business API and a mail service.
2. **Medium: voice needs Chrome/Edge, mic permission and an OS voice for read-aloud** (unchanged from v1.1). The mic path is verified with a fake recogniser.
3. **Low: transport comparison on a 375 px phone uses two narrow columns,** so some facts wrap ("5 min +4 / wait"). Legible, and intentional to keep the side-by-side view.
4. **Low: the payment pop-up's chime is WebAudio and fails silently** where audio is blocked. Mute is remembered per browser.
5. **Low: the phone tab bar scrolls sideways for Hotels, Transport and Partners & admin.** The four requested tabs are always visible.
6. **Low: local fares, frequencies, CO₂ and train timetables are deterministic simulations** (labelled).
7. **Low: the success sound, confetti and PNG rendering depend on the browser.** With reduced motion there is no confetti or animation.
8. The live Gemini path is still untested (no key); the offline fallback is verified.

### v1.2 jury demo checklist (superseded by the v1.2.1 one at the top)

1. Use **Chrome or Edge** on a laptop (window ≥ 1280 px). Open `index.html` by double-click, or run `start-server.bat` / `.sh` (a local server remembers mic permission).
2. Before the jury arrives: **Settings → Reset demo data**, then check the top bar shows Plan trip · Trains · Hotels · Transport · My Journey · Bookings & refunds.
3. Set **AI mode to "Simulated only"** unless the Wi-Fi and the Gemini key were tested that morning.
4. Windows: install the Hindi voice (**Settings → Time & Language → Speech → Add voices → Hindi**) and reopen the browser. Check **Settings → Voice capability check**.
5. Unmute the success sound (speaker icon on the pop-up) if you want the chime. It stays as you leave it.
6. **Allow the microphone**. Rehearse "book from Chandigarh to Mumbai train" and "hotel in Jaipur under 3000": the budget should show "Up to ₹3,000".
7. Scripted run: **Start demo** and only *Next* (22 steps). **×** or Esc exits at any point. On a phone, scroll the payment pop-up if needed; the tour card stays compact.
8. Standalone story: **Hotels → Jaipur → Book now → pay** → pop-up → **Your one-page itinerary → Download PDF / WhatsApp** (consent + confirm) → My Journey "Stay in Jaipur" → **Add a train to this trip** (the stay is kept).
9. Local transport story: **Transport → Chandigarh**. Cab, auto, bus, e-rickshaw and walk compared, "No metro in Chandigarh", then book the bus. Partner and admin are under **Partners & admin**.
10. Close other tabs, set zoom to 100% (Ctrl+0), and turn off notifications. Trains, fares, hotels, transport and sends are **simulated**; say so if asked.

---

# v1.1 report (history, 2 Nov 2026)

Independent verification of the static prototype against the project brief, the requirements traceability (`docs/research/01_requirements.md`), the survey statistics (`docs/research/survey_stats.json`), the build contract (`docs/ARCHITECTURE.md`) and the owner's four v1.1 requests. Verified on 2 Nov 2026 by a separate agent that did not build the app. The v1 report follows below as history (section "v1 report").

**Result (v1.1):** after the 21 fixes listed in section v1.1-4, the automated suite passes **2389 of 2389 checks, with 0 failures**. It covers file:// and http, at 1440×900 and 375×812, with 0 console errors and 0 page errors. (The last full run, after the final app fix, gave 2377/2377. The verifier group was then re-run on both bases after a test-only change that pins the package to Chandigarh, so the partner "New via OneTrip" and admin checks always run: 584/584. The total combines the two.) Every new screen was also screenshotted at both widths in English, Hindi and Tamil and reviewed by eye.

## v1.1-1. What changed in the test suite

`tests/e2e.py` now has three v1.1 layers:
- **Builder suite** (`v11_flow`): trains, voice commands, personas, For you, package → PNR → journey, train cancel, any-city results.
- **Verifier suite** (`v11_verify`, independent): see the matrix below.
- **v1 suites, re-run unchanged** (journey, checkout, refunds, assistant, partner, admin, settings, 11-language route sweep, the guided tour at both widths including Exit mid-way, and edge cases).

New options: `--only verify,tour` runs selected groups, and `--base file|http` runs one entry point. The test helper `go()` now forces a re-render when the hash does not change, as a presenter's click would.

## v1.1-2. Test matrix and results

| Suite (×4 = file/http × desktop/mobile) | Checks | Fail |
|---|---|---|
| Assets (local refs, no modules/fetch) | 2 | 0 |
| Traveller journey (v1 9 steps + cancel/refund + assistant) | 136 | 0 |
| Partner (CRUD, calendar, enquiries, New via OneTrip) | 82 | 0 |
| Admin (9 tabs, live totals) | 110 | 0 |
| Route sweep (11 languages; en+hi on file-mobile) | 783 | 0 |
| Settings (key test offline, modes, reset) | 38 | 0 |
| Guided demo, 20 steps + Exit mid-way | 278 | 0 |
| Edge cases (empty, reload, 404, rapid language switch, no SR, no localStorage) | 86 | 0 |
| Builder v1.1 suite (trains, voice, personas, For you) | 290 | 0 |
| Verifier v1.1 suite (independent; see list below) | 584 | 0 |
| **Total** | **2389** | **0** |

The verifier suite (`v11_verify`) covers, at both widths:
- **Header:** the globe icon is ≥ 14 px; "Sign in" text is shown; the desktop nav stays visible both signed out and signed in; header icon buttons are never squeezed.
- **Request 2, every phrase, all three paths:** typing + Enter, the → button, and the **real mic code path** with a fake `SpeechRecognition`.
  - "book from Chandigarh to Mumbai train" → CDG→CSMT, tomorrow
  - "चंडीगढ़ से मुंबई ट्रेन" → CDG→CSMT
  - "Chandigarh to Mumbai on Friday" → the next Friday, and the date bar shows "Fri"
  - "train from Delhi to Varanasi tomorrow" → NDLS→BSB, tomorrow
  - "hotel in Jaipur under 2000" → Jaipur results with budget ₹2,000, and every hotel shown is ≤ ₹2,000
  - gibberish → stays on home with guidance
  - "train from Delhi" (no destination) → asks "where to?"
  - Each must show a visible "I heard …" within 4 s.
- **Request 1, search:** the same search gives the same trains; past dates are rejected in both forms; the previous-day button never goes before today.
- **Timetable integrity**, over 232 train-dates on 12 routes × 4 dates:
  - arrival = departure + duration, and arrOffset is dated
  - average speed 25–110 km/h
  - fares by class 1A > 2A > 3A > 3E > SL, and EC > CC
  - fare breakup adds up exactly to the total
  - fare/km within sane bands for trips ≥ 300 km
  - 3A fares grow with distance
  - no DEPARTED status on future dates
  - deterministic results; every station code is a real IR code
  - overnight arrivals carry the next date
- **Request 3, personas:**
  - `#/login` layout: 6 cards, each ≥ 220 px wide, no text overflowing a card, no overlapping "Sign in as" buttons
  - persona sign-in sets language, home city, party and trip history (shown in Bookings)
  - header menu: switch persona and sign out
  - the home city fills a missing "from"
  - Neha's default consent is off, so she gets no suggestions
- **Request 4, For you:**
  - long-weekend dates and weekdays computed independently and compared, for today's date
  - no past travel dates
  - trending routes from the home city
  - package total = sum of its lines; savings = separate − total
  - the package train runs on its date
  - **hotel nights cover arrival → return**
  - "Why am I seeing this?"; the consent toggle hides suggestions, and that persists after reload
- **"Book this package", end to end:** package train → passengers → fare lines add up → confirm → PNR → arrival date checked → plan stay → the package hotel, cab and sight are in the journey → **nothing is scheduled before the train arrives** → the checkout services total equals the package lines → pay → the partner sees the hotel (not the train) as "New via OneTrip" → admin add-on GTV excludes train fares → the admin forecast names the same weekend.
- **Train cancel:** the refund equals an independent railway-rule calculation; the dialog shows the amount; the journey shows CANCELLED, readiness "Cancelled" with ticket 0/30, and a warning that the hotel and cab are still active.
- **Any-city results:** Mumbai and Varanasi hotels and cabs, each verified, labelled and sourced.
- **Languages:** en, hi and ta on home, trains, train booking, login, bookings and journey.

## v1.1-3. Traceability: the owner's four v1.1 requests

| ID | Requirement | Where in the UI | Status | Evidence |
|---|---|---|---|---|
| R1.1 | Enter from/to/date | Home "Step 1 · Find trains" (station typeahead in any script, date, class, travellers); `#/trains` form | Pass | typeahead finds Mumbai from "मुं" and Chennai from "சென்"; past dates blocked |
| R1.2 | Different trains for that date | `#/trains?from&to&date`: running days, "does not run on", time slots, sort, "available only", previous/next day | Pass | determinism + integrity checks (232 train-dates) |
| R1.3 | Book the train → PNR | `#/trains/book` (passengers prefilled from the persona, itemised fare, human-in-the-loop confirm) → `#/trains/ticket` (10-digit PNR, CNF berth or RAC/WL with chance) | Pass | "nothing booked before confirm"; PNR regex; fare lines add up |
| R1.4 | Then hotels/cabs/food/sights for the destination | e-ticket "Now plan your stay & travel in {city}" → `#/results?to=` (any of 39 stations) | Pass | Mumbai, Varanasi, Hyderabad, Jaipur, Goa and Guwahati results verified |
| R2.1 | "book from Chandigarh to Mumbai train" responds visibly and shows trains | home ask box: "I heard …" + chips (intent / from / to / date), then train results with an "I heard" banner | Pass | Enter, button and mic paths all tested |
| R2.2 | Hindi, weekday, "tomorrow", hotel-with-budget, gibberish, missing destination | same | Pass | 7 phrases × 3 paths (the mic path is skipped for the two "stay on home" inputs except gibberish) |
| R3.1 | Persona cards on `#/login` (4 travellers + partner + admin) | `#/login` "Choose a demo persona" | Pass (after fix #1) | layout assertions at 1440 and 375 |
| R3.2 | Header "Sign in" text + user menu (switch persona / sign out) | header `#hdr-user` → `#user-menu` | Pass (after fixes #2–#4) | |
| R3.3 | Persona sets language, home city, history | persona sign-in; "Keep {language}" offer; Bookings "Past trips" | Pass | Sunita → hi / NDLS / 3 travellers / 3 past trips |
| R4.1 | Long-weekend detector with correct dates | home + My Journey "For you" tabs; admin forecast | Pass | 24 Nov 2026 Tue → Sat 21–Tue 24 (leave Mon 23); 25 Dec 2026 Fri → 25–27; 26 Jan 2027 Tue → Sat 23–Tue 26; no past weekends (the travel date must be ≥ today, fix #12) |
| R4.2 | Trending routes from the home city | "For you": N travellers from {home city}, +x% vs a normal weekend, fills N days early | Pass | aggregated and anonymised; labelled simulated |
| R4.3 | Packages with total and savings | package card | Pass (after fix #10) | total = sum of lines; savings = separate − total; nights cover arrival → return |
| R4.4 | "Book this package" does the whole chain | package → trains → book → PNR → plan stay → journey → pay | Pass (after fixes #11, #13) | nothing planned before the train arrives; checkout total = package |
| R4.5 | "Why am I seeing this?" + consent toggle hides the section | "For you" | Pass | consent persists after reload |
| R4.6 | Admin long-weekend forecast | `#/admin/demand` | Pass | same next weekend as the traveller view |
| REG | v1 regressions (journey, checkout, refunds, assistant, partner "New via OneTrip", admin totals, 20-step tour) | | Pass (after fix #9) | v1 suites re-run, the tour run fully at both widths, and Exit mid-way |

## v1.1-4. Bugs found and fixed in v1.1

| # | File | Fix |
|---|---|---|
| 1 | `js/views/auth.js`, `css/traveller.css` | **Persona cards crushed into ~85 px columns at 1440.** The login section reused the class `.personas`, which `dashboards.css` (loaded later) defines as the Business-case 4-column grid. Renamed to `.login-personas` / `.ps-card`. |
| 2 | `css/base.css` | **The header globe shrank to a ~6 px dot.** The flex item was squeezed; it is now pinned at 16×16. |
| 3 | `css/traveller.css` | **At 1440 the main nav collapsed into the hamburger** (the new "Trains" link plus the "Sign in" button made the header overflow). Tight mode now trims spacing first, and drops only the signed-in first name (initials stay), so the nav stays visible with the "Sign in" text. |
| 4 | `css/traveller.css` | The mobile hamburger was squeezed to 24 px. Header icon buttons no longer shrink. |
| 5 | `js/views/auth.js` | The persona card showed "Mumbai CSMT CSMT". The code is now appended only when the name lacks it. |
| 6 | `js/data/rail.js` | **2A cheaper than 3A** on trains with one fixed sample fare (e.g. 12837: 2A ₹1,125 < 3A ₹1,240). Other classes now scale by the same ratio. |
| 7 | `js/data/rail.js` | **The fare summary did not add up** (e.g. lines ₹3,076 vs total ₹3,080, from ₹5 rounding). GST (or the base fare on non-AC trains) absorbs the rounding. |
| 8 | `js/views/home.js`, `js/views/trains.js`, `js/core/i18n.js` | Past travel dates could be searched (every class then showed "Departed"). Both forms now set `min` = today and reject past dates with a message (en + hi). |
| 9 | `js/data/analytics.js`, `js/views/admin.js` | **Admin "add-on GTV" counted IRCTC train fares.** Trains are now excluded from add-on GTV and orders, and shown separately ("{n} train ticket(s) ₹X counted as IRCTC ticketing"). |
| 10 | `js/data/personas.js` | **Package hotel nights did not cover the trip** (e.g. travel 20 Nov → return 24 Nov priced as 2 nights). Nights are now computed from the train's arrival date to the last day of the long weekend. |
| 11 | `js/agents/agents.js` | **Late trains created impossible itineraries:** a Jaipur train arriving at 23:55 had Amber Fort at 09:00 and check-in at 12:00 the same day ("planned before your train arrives" ×2). Check-in now moves to arrival + 45 min when the train lands after the hotel's check-in time, and sights/meals move to the next day when they would start before arrival + 1 h. |
| 12 | `js/data/personas.js` | (Guard) A long weekend whose travel date has already passed is skipped. |
| 13 | `js/views/trains.js`, `js/views/foryou.js`, `js/tour.js` | Booking a package train on a different date than suggested kept the package's night count, so the stay ran past the weekend. Nights are now derived from the package's return date and the actual arrival. |
| 14 | `js/agents/agents.js`, `js/views/journey.js`, `js/core/i18n.js` | After a train cancel, readiness said "Train ticket: Missing". It now says **Cancelled**, and My Journey warns that the hotel, cab and sights are still booked, with a link to Bookings. |
| 15 | `js/views/journey.js` | Trip cost still read "Train ticket (paid on IRCTC)" after a cancel. It now shows the struck-through fare with "cancelled, refund as per railway rules". |
| 16 | `js/views/foryou.js` | The Hindi "For you" line mixed in an English weekday ("… Tue को है"). The weekday is now localised. |
| 17 | `js/views/admin.js` | The admin forecast showed raw "11-21…11-24". It now shows "21 Nov – 24 Nov". |
| 18 | `tests/e2e.py` | Verifier suite added (layout, phrases × 3 input paths, data integrity, package chain, refunds, admin), plus `--only` / `--base` and a re-render-safe `go()`. |
| 19 | `tests/e2e.py` | Test races fixed: reading `#voice-status` during navigation, and a stale typeahead dropdown after a same-hash `go()`. |
| 20 | `css/traveller.css` | **Horizontal scroll on phones in 6 languages** (ta, te, ml, gu, pa, or): the localised "Sign in" label pushed the 375 px header to 380–406 px. When signed in, the name was also shown on phones. On phones, the signed-out label is now capped and ellipsised, the signed-in name is hidden (initials only), and at ≤ 400 px the globe icon is hidden so the language name (e.g. "English") stays readable. Probed in all 11 languages, signed in and out: header width = 375 px. |
| 21 | `js/views/partner.js` | The partner's live hotel row said "1 night(s)" for a 3-night ₹7,950 package stay. Nights are now computed from the stay's check-in and check-out dates. |

Security (v1.1): grep of the repository and git history for `AIza…`, `AQ.Ab8`, `key=…`, `sk-…` and `api_key` literals found only the deliberately fake test value `AIzaFAKE-test-key-not-real` in `tests/e2e.py`. **There are no secrets.** The new user/AI text (the heard query, passenger names, persona fields) is escaped (`OT.esc` / `OT.lang.highlight`).

## v1.1-5. Remaining known limitations (most severe first)

1. **Medium: voice depends on the device.** ASR needs Chrome or Edge plus mic permission, and read-aloud needs an OS voice for the language. Without them the app explains and offers sample voice chips. The mic path is verified with a fake recogniser, not a real microphone.
2. **Medium: partner listing and calendar edits do not change traveller results.** The traveller side uses the fixed, simulated catalogue; the partner pages say so.
3. **Low: the For-you tabs scroll sideways on narrow screens.** The third weekend's label is cut at the edge until scrolled (desktop shows about 2.5 tabs).
4. **Low: the train refund is simplified railway logic.** Charges are flat per class above 48 h, 25 % within 12–48 h and 50 % within 4–12 h, with no refund within 4 h (chart prepared). WL/RAC carry a ₹60 clerkage. GST on cancellation is ignored, and the convenience fee is non-refundable. All of it is labelled simulated.
5. **Low: the holiday calendar is a sample.** Movable festivals (Holi, Good Friday, Guru Nanak Jayanti 2027) carry "sample date" or "verify with the official gazette" notes.
6. **Low: language coverage.** English and Hindi are complete. Tamil and the other 8 languages translate the header, search, statuses, assistant and the main new labels, and fall back to English elsewhere (as explained on About).
7. **Low: on a 375 px phone the guided tour's card covers the lower screen.** The tour still completes all 20 steps; a laptop is the better demo device.
8. Low: on phones ≤ 400 px wide the header globe icon is hidden (the language select is still labelled), and long localised "Sign in" labels are ellipsised.
9. The Gemini live path was tested only offline (graceful fallback); no real key was available.

### v1.1 jury demo checklist (superseded by the one above)

1. Use **Chrome or Edge** on a laptop (window ≥ 1280 px). Open `index.html` by double-click, or run `start-server.bat` / `start-server.sh` (a local server remembers mic permission).
2. Before the jury arrives, open **Settings → Reset demo data**. Then open **Sign in** (header) and check that the six persona cards render side by side.
3. Set **AI mode to "Simulated only"** unless the venue Wi-Fi and the Gemini key were tested that morning (Settings → *Test key*).
4. Windows: install the Hindi voice under **Settings → Time & Language → Speech → Add voices → Hindi** (and Tamil if you demo Ramesh), then reopen the browser. macOS: System Settings → Accessibility → Spoken Content → Manage Voices.
5. Check **Settings → Voice capability check**: Hindi shows "voice(s)" and speech recognition shows "supported". Press *Play a Hindi sample* through the room's speakers.
6. **Allow the microphone** on the first prompt. Rehearse once: say "book from Chandigarh to Mumbai train" on the home page. You should see "I heard …" and then the train list. If the mic fails, type it and press Enter, or use the **English · train** / **हिन्दी** sample chips.
7. For the scripted run, press **Start demo** and then only *Next* (20 steps). **×** or Esc exits at any point. It signs in as Sunita (Hindi) and books the 12011 Shatabdi, then the stay.
8. For the live "For you" moment, sign in as **Sunita** from the header menu. The Christmas weekend (Fri 25 Dec) and Guru Nanak Jayanti (Tue 24 Nov) appear. Show "Why am I seeing this?" and the consent switch, then **Book this package**.
9. For the "wow" moment after paying, use the header menu to switch to **Rajinder (partner)**: the hotel booking is highlighted "New via OneTrip". Then switch to **Ananya (admin) → Destination demand** for the long-weekend forecast.
10. Close other tabs, turn off notifications and screen savers, set browser zoom to 100% (Ctrl+0), and keep this checklist on a second screen. Train timetables, fares and holiday dates are **simulated samples**; say so if asked.

---

# v1 report (history, 1 Nov 2026)

Independent verification of the static prototype against the project brief, the requirements traceability (`docs/research/01_requirements.md`), the survey statistics (`docs/research/survey_stats.json`) and the build contract (`docs/ARCHITECTURE.md`). Verified on 1 Nov 2026 by a separate agent that did not build the app.

**Result:** after the fixes listed below, the automated suite passes **1354 of 1354 checks, with 0 failures**. It covers file:// and http, at 1440×900 and 375×812. We found 0 console errors and 0 page errors.

### v1 · 1. Test environment (unchanged for v1.1)

| Item | Value |
|---|---|
| Browser | Chromium 153 (Playwright 1.63, headless), Python 3.13 |
| Entry points | `file:///…/index.html` (double-click) and `python3 -m http.server` (same as VS Code Live Server / `start-server.*`) |
| Viewports | Desktop 1440×900, mobile 375×812 |
| Network | Offline. Google Fonts and the Gemini endpoint are blocked on purpose: the fonts fall back to the system font, and Gemini falls back to the simulated agents. These two failures are the only ones the suite expects. |
| Voice | Headless Chromium has no TTS voices. Speech recognition is tested both as "present but failing" and as "absent", via an init script. |
| Test script | `tests/e2e.py`. Run it from the repo root with `python3 tests/e2e.py` (add `--quick` to test only en+hi on most matrices, or `--shots DIR` to save screenshots). The run writes `tests/last-run.json`, which git ignores. |

### v1 · 2. Test matrix and results

The matrix is {file, http} × {desktop, mobile}. The full language sweep runs on every combination except file-mobile, which runs en + hi.

| Suite | What it does (real clicks unless noted) | Checks | Fail |
|---|---|---|---|
| Assets | Every `src`/`href` in index.html and every CSS `url()` resolves to a file; no ES modules; no `fetch()` of local files | 2 | 0 |
| Traveller journey (×4) | The brief's 9 steps: select Hindi in the header → sample Hindi voice query (the brief's exact sentence) → live parse (CDG, ₹3,000) → *Find verified options* → Agent Trace (orchestrator + 5 specialists) → Hindi summary with ₹ amounts left untranslated → source, check time, badge and SIMULATED tag on **every** card → speaker → add hotel + cab → *View journey* → conflict flagged → fix (cloakroom) + link return → readiness rises → consolidated itinerary → *Review & pay* → double-click opens exactly one confirm dialog → nothing booked before confirming → confirm → `OT-XXX-XXXXX` refs → My Journey shows Confirmed → Bookings → cancel (confirm first) → refund tracker advances → assistant: Hindi refund question answered in Hindi with the booking ref → speaker → switch to Tamil mid-chat (history kept) → *Talk to a human* creates a `SUP-` ticket | 136 | 0 |
| Partner (×4) | Gate → register (validation, HTML escaped) → login → overview shows the live booking → listings: add, edit, pause, delete (with confirm), title escaped → calendar: day price/availability saved, next month, Fri–Sat +15% → enquiry: Partner Agent draft (has listing ₹) → send (confirm) → bookings (row "New via OneTrip"), performance, feedback, original/translation toggle | 82 | 0 |
| Admin (×4) | All 9 tabs render; the live booking ref appears; live GTV > 0 is included in totals; language analytics; financial products | 110 | 0 |
| Route sweep (×4) | home, results, journey, checkout, bookings, login, register, insights, about, settings and 404, in **all 11 languages** (en + hi on file-mobile): no NaN/undefined/`[object Object]`/`{placeholder}`/U+FFFD/mojibake text, no horizontal overflow at 375 px, zero console errors | 656 | 0 |
| Settings (×4) | Save key → *Test key* fails gracefully offline ("✗ … the app will keep using simulated agents") → with a broken key in hybrid mode, the agents and assistant still answer (fallback) → simulated mode → remove key (confirm) → voice check → reset (confirm) clears journey and bookings | 38 | 0 |
| Guided demo (×4) | Header *Start demo* (or the hero button on mobile). All 17 steps: Next is never stuck (25 s cap), every step has a highlighted target, the card stays inside the viewport and does not cover its target (desktop). The tour finishes on Business case with a confirmed booking. A second run presses Exit at step 5: the overlay is removed and the user restored. | 244 | 0 |
| Edge cases (×4) | Empty states (journey, checkout, bookings, partner, admin), *Load sample trip*, unknown route → not-found page, reload mid-flow (journey item kept, results re-render), reload on #/journey, **rapid language switching during an agent run** (ends in Hindi, single trace), header mic with failing SR, **no SpeechRecognition** (explains and offers a sample; the assistant mic also explains), **localStorage throwing** (whole flow works in memory) | 86 | 0 |
| **Total** | | **1354** | **0** |

Visual QA: each route was screenshotted at both widths, in en and hi, plus every tour step. The screenshots were reviewed by eye. The defects found are fixed below. Traveller and dashboard styling is consistent: both use navy/blue on white with saffron accents and the same cards, badges and buttons. No CSS class collision between `traveller.css` and `dashboards.css` was found. The traveller side uses `.ot-eyebrow`, `.board-*` and `.bkg/.bk-*`, while the dashboards use `.eyebrow`, `.board` and `.bk`. One collision inside `traveller.css` was found and fixed (#5 in section 4).

### v1 · 3. Traceability matrix

Status: **Pass** = present and tested; **Partial** = present with a stated limitation. No requirement is Fail.

#### Brief: interfaces (§2)

| ID | Requirement | Where in the UI | Status | Evidence |
|---|---|---|---|---|
| T-1 | Home with journey search | `#/home`: `#trip-form` (from/to/date/travellers/budget/prefs) + "Ask in your language" box | Pass | journey suite |
| T-2 | Login and registration | `#/login`, `#/register` (role picker, consent toggles off by default) | Pass | route sweep, 11 langs |
| T-3 | My Journey dashboard | `#/journey`: ticket card, readiness ring, cost, timeline | Pass | journey suite |
| T-4 | Hotel, cab, food, sightseeing recommendations | `#/results`, 4 tabs | Pass | journey suite |
| T-5 | Consolidated itinerary | `#/journey` → *Consolidated itinerary* (modal table, Print) | Pass | ≥5 rows asserted |
| T-6 | Booking and payment summary | `#/checkout` (itemised, GST, IRCTC ticket shown as already paid) | Pass | journey suite |
| T-7 | Cancellation and refund tracking | `#/bookings`: cancel → 4-stage refund tracker | Pass | tracker advances |
| T-8 | Multilingual AI assistant | header chat icon → drawer | Pass | Hindi Q/A, switch to Tamil |
| T-9 | Voice search and voice support | header mic, home mic, assistant mic, sample voice chips | Pass (browser-dependent) | SR present/absent tests |
| P-1…P-7 | Partner register/login, listings, price & availability, enquiries, confirmed bookings, revenue/conversion/cancellations, feedback | `#/partner/{overview,listings,pricing,enquiries,bookings,performance,feedback}` | Pass (P-3 Partial) | partner suite. P-3: calendar/listing edits stay in the partner view; traveller results use the fixed sample catalogue (stated on screen) |
| A-1…A-6 | Users and providers, bookings and GTV, complaints/refunds/partner performance, destination demand, financial products, language usage/translation quality/support | `#/admin/{users,bookings,complaints,partners,demand,finance,language}` (+ overview, platform) | Pass | admin suite. Live booking included in totals |

#### Brief: agents (§3), BHASHINI (§4), data rules (§7)

| ID | Requirement | Where | Status | Evidence |
|---|---|---|---|---|
| AG-1 | Orchestrator assigns tasks and combines results | Agent Trace: plan → Multilingual → intent → Research → Verification → reflection → Recommendation → Itinerary → Multilingual | Pass | ≥6 agents asserted |
| AG-2 | Research records source + check time | each card's `.source-line` ("Source: … checked 01 Nov 2026, 19:13 IST (9 min ago)") | Pass | asserted on every card |
| AG-3 | Verification re-checks independently; flags missing/stale/contradictory | Verification log per card; "Needs confirmation", stale "Re-check now", sold-out hidden list | Pass | `agents.js verifyOne()` compares against `providerSource` |
| AG-4 | Recommendation by destination/budget/date/prefs | "Why this?" chips; over-budget items listed as filtered | Pass | |
| AG-5 | Itinerary: chronological, conflicts | timeline + "Arrival 11:05 vs check-in 14:00" with 3 fixes | Pass | |
| AG-6 | Customer Support agent + human escalation | assistant drawer, *Talk to a human* → `SUP-` ticket | Pass | |
| AG-7 | Partner Agent | partner enquiries → *Draft reply with Partner Agent* | Pass | |
| AG-8 | Multilingual agent | detect + NMT (phrasebook/Gemini) + TTS + transliteration | Pass (simulated) | |
| DR-1 | AI never invents prices, availability, ratings or timings | Code review: all prices come from `OT.data.travel` (`livePrice = providerSource.price`). Gemini is used only for intent (validated against an allow-list) and phrasing. The support-agent and Partner-Agent Gemini replies are rejected if they contain a ₹ amount that is not in the data (the Partner-Agent guardrail was **added** during verification) | Pass | |
| DR-2 | Unverifiable data shown as unavailable / needs confirmation | "Rating unavailable at source", "Needs confirmation" badges, checkout blocks payment until a changed price is accepted or stale data is re-checked | Pass | |
| DR-3 | BHASHINI is not a source of truth | About → Data & verification rules | Pass | |
| ML-1 | Select preferred language (11) | header `#lang-select` | Pass | all 11 swept |
| ML-2 | Speak → text | mic (Web Speech) or sample voice (simulated ASR) | Pass | |
| ML-3 | Recommendations in that language | Hindi summary, labels, policies | Pass (en/hi full; 9 others partial UI coverage, explained on About) | |
| ML-4 | Speaker button | results summary, assistant messages, journey "Play itinerary aloud", confirmation | Pass (needs an OS voice; otherwise a text card explains) | |
| ML-5 | Continue in the same language / change at any point | assistant keeps history across switches; every route re-renders | Pass | |
| ML-6 | Transliteration | type "mujhe hotel chahiye" → suggestion in Devanagari (home and assistant) | Pass (hi/ta/bn word maps) | |
| ML-7 | Language detection | parse chip "हिन्दी · 9x%", user-message meta | Pass | |
| SG-1 | Do not modify train no., PNR, dates, prices, station codes, refs | `bdi.keep` tokens; Gemini NMT restores ⟦n⟧ placeholders or falls back | Pass | test: ₹ in Latin digits, no Devanagari digits in hi output; confirm dialog shows 4521837690 / 12011 / ₹ unchanged |
| SG-2 | Preserve the original next to the translation | "Show original" on summaries, assistant replies, cancellation policy | Pass | |
| SG-3 | Verify critical policy translations | policy text from reviewed templates, marked "(reviewed translation)" | Pass (simulated) | |
| SG-4 | Confirm important actions | confirm dialogs for pay, cancel, listing delete, partner reply, key removal, reset, new trip | Pass | "nothing booked before confirm" asserted |
| SG-5 | Uncertain translation → original or human | low confidence → "Low confidence: original shown; a human can help." and escalation chip | Pass | |
| SG-6 | Explain unavailable language/voice | "Voice input is not supported…", "No Hindi voice is installed…", partial-coverage note | Pass | no-SR test |

#### Brief: UI/UX (§5), features (§6), prototype (§8), deliverables (§9)

| ID | Requirement | Where | Status |
|---|---|---|---|
| UX-1 | Blue/white, subtle orange, modern cards, icons | global | Pass |
| UX-2 | Clear booking-status indicators | badges Verified / Needs confirmation / Planned / Confirmed / Cancelled / Refunded | Pass |
| UX-3 | Timeline-based trip dashboard | `#/journey` railway route-line timeline | Pass |
| UX-4 | Mobile responsive | 375 px sweep: no horizontal overflow on any route, in 11 languages | Pass |
| UX-5 | Language selector in header; mic + speaker | header | Pass |
| UX-6 | 9-step main journey | journey suite walks all 9 | Pass |
| F-1…F-13 | Consolidated dashboard, Trip Readiness, hotel/transport recs, chronological timeline, price comparison, clear policies, status tracking, partner performance, admin analytics, AI assistance, multilingual text+voice, switching throughout, audio playback | as above | Pass |
| PR-1 | Sample train, simulated hotels/cabs | 12011 NDLS→CDG (+ MDU, PURI) | Pass |
| PR-2 | Demonstrate research and verification, itinerary, adding services, readiness, Hindi voice query, translate + read aloud | guided demo, 17 steps | Pass |
| PR-3 | Simulated payments; no real payment data; label simulated data; no live-integration claim | global banner "No live IRCTC, BHASHINI or bank integration", SIMULATED tags on every price, masked demo payment fields (disabled inputs) | Pass |
| D-1…D-7 | Traveller, partner, admin, agent workflow, labelled simulated BHASHINI, responsive, sample data, full journey demo | | Pass |

#### Explorer-1 "Must" items not covered above

| ID | Where | Status |
|---|---|---|
| FR-01/02/03/05/06/08/10/11/14/15/16 | home, results cards (provider, IRCTC-managed vs partner, Sponsored label, policy and refund owner), "Not for me" dismiss + Undo (kept for the session) | Pass |
| ECO-01 | checkout "owners" box (Partner Bank payments, provider refunds, OneTrip support) | Pass |
| DAT-01 | Business case → Q2 data parameters table | Pass |
| DAT-02 | register consents (all off), partner role gate | Pass |
| BNK-01/02 | checkout payment owner; admin Bank & finance names the issuer/lender | Pass |
| TRUST-01 | every card: provider, price, availability, check time, policy; partner listing without a policy cannot go live | Pass |
| CORE-01 | admin overview "Social-mandate guardrails" (ticket success, p95 latency), "Continue to IRCTC ticketing" link | Pass (simulated KPIs) |
| BR-AG02, BR-ML01–08, BR-PR01 | see DR / ML / SG / PR rows | Pass |

#### Business case and course

| Check | Result |
|---|---|
| Survey figures match `survey_stats.json` exactly | **Pass.** `js/data/survey.js` was compared key by key with the JSON (identical). Every hard-coded figure in `insights.js` text was checked (42.3/36.5, 23.1/21.2, 30.8, 44.2, 69.2, 7.7, 81.2, 41.2, 73.3, 68.6/29.4, 13.5, 15.4, 78.8 …). The illustrative model is labelled "ILLUSTRATIVE ASSUMPTIONS". |
| 5 case questions visibly addressed | **Pass.** Business case has Q1 Solution review, Q2 Data parameters, Q3 Marketing & advertising, Q4 Role of banks, Q5 Financial products for 3 segments |
| Course frameworks | **Pass.** Platform/flywheel, VRIO, Sense–Seize–Transform (insights + admin), hype cycle, agentic autonomy levels / human-in-the-loop (Agent Trace + About) |

### v1 · 4. Bugs found and fixed

| # | File | Fix |
|---|---|---|
| 1 | `js/views/shell.js` | **Mobile menu never opened** when the hamburger icon was tapped: the click handler re-rendered the SVG, so the outside-click handler saw a detached target and closed the menu at once. Fixed with stopPropagation plus an `isConnected` guard. |
| 2 | `js/core/ui.js` | Double-clicking *Pay* / *Cancel* opened the confirm dialog, and the 2nd click landed on the new backdrop and closed it. Backdrop clicks are now ignored for 500 ms after a dialog opens. |
| 3 | `js/core/ui.js` | Toasts piled up (4+) during the tour and covered the tour card on mobile. At most 2 toasts are now shown. |
| 4 | `css/base.css` | During the tour, toasts move to the top of the screen so they never cover the presenter card. |
| 5 | `css/traveller.css` | `.co-ticket span {display:block}` broke the "Paid on IRCTC" / "CNF" badges on checkout and bookings (icon on its own line). Badges are now scoped back to inline-flex. |
| 6 | `css/base.css` | The empty-journey "Load sample trip (New Delhi → Chandigarh)" button overflowed at 375 px. Empty-state buttons can now wrap. |
| 7 | `js/views/partner.js` | Gemini Partner-Agent drafts had no price guardrail. A draft with any ₹ amount not in the listings now falls back to the listing-grounded template. |
| 8 | `js/views/partner.js` | The copy claimed "Prices you set here are what travellers see". It now says this happens in production, and that the prototype's traveller results use the fixed sample catalogue. |
| 9 | `js/agents/agents.js` | The Hindi Partner-Agent draft inserted the English "your date" when no date was given. It now uses Hindi. |
| 10 | `js/views/auth.js` | `partnerId` on the signed-in card is now HTML-escaped. |

Security: `grep` of the repository and git history for `AIza…`, `AQ.Ab8`, `key=…`, `sk-…` and hard-coded `api_key` literals found **no secrets**. The Gemini key lives only in the browser's localStorage (Settings), and `.gitignore` excludes `config.js`, `*.local.js` and `.env`. All user-supplied and AI text reaches the DOM through `OT.esc`, `OT.lang.highlight` (which escapes) or `textContent`. This was confirmed by an XSS probe in partner registration and listing titles. Confirm-dialog `lines` are HTML by contract, and every caller escapes its variables.

### v1 · 5. Remaining known limitations

1. **Voice depends on the device.** Speech recognition needs Chrome or Edge, and read-aloud needs an installed voice for the selected language (Hindi is often missing on Windows). Without them the app shows the text and a clear message, and the sample voice chips always work.
2. **Language coverage.** English and Hindi are complete. The other 9 languages cover the header, search, timeline, statuses and assistant chrome, and the rest falls back to English, as the About page explains. Several assistant answers in those languages fall back to English, with a visible note.
3. **Partner edits are not reflected in traveller results** (sample catalogue). This is stated on the partner pages.
4. **The tour captions are in English** (presenter notes), while the UI switches to Hindi as part of the story.
5. **On a 375 px phone, the tour card covers the lower part of the screen,** including the confirm dialog's buttons at step 12. The tour presses them for you, so this does not block the demo, but a laptop is the better demo device.
6. Data checked-at times are relative to page load ("9 min ago"), because the data is simulated. The stale-data flag is deterministic by design.
7. Gemini (optional) has been tested only offline (graceful failure). A live key was not available to the verifier.
