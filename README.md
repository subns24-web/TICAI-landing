# SNTG — ₹99 MSME AI Workshop Landing Page (Telugu)

Single-file landing page. Be10x funnel architecture, rewritten for Telugu MSME owners.
Open `index.html` locally. Deploy with `vercel` — no build step, no config.

**Offer:** ₹99 (from ₹1,999) · live 3-hour Telugu workshop · fixed date + time
**Promise:** save ~₹20,000/month by not hiring the assistant you were about to hire

## Before you run ads — 4 things to replace

1. **WhatsApp number** — in `<script>`:
   ```js
   const WHATSAPP_NUMBER = "91XXXXXXXXXX";   // no +, no spaces
   ```
   Also the footer `https://wa.me/91XXXXXXXXXX` link.

2. **Payment link + Google Sheet** — see `SETUP-PAYMENTS.md`. Current ₹99 page:
   ```js
   const PAYMENT_LINK = "https://rzp.io/rzp/fp4Jd12";
   ```
   With it set, the lead lands on your WhatsApp *and* the user goes straight to pay.

3. **Testimonials** — three cards marked `[...]`. Replace with real attendee quotes,
   or **delete the whole section**. Fake testimonials are what kill a ₹99 offer.

4. **Your photo** — the trainer block has an empty `.f-photo`:
   ```html
   <div class="f-photo"><img src="santhosh.jpg" alt="Santhosh Nimmani"></div>
   ```

Also hand-maintained: the **"82% full" seat meter** appears in three places
(hero, offer box, sticky bar). Static on purpose — no fake auto-decrementing counter.

## "Don't miss this" popup

Headline: **"ఆగండి! ఈ అవకాశాన్ని మిస్ అవ్వాలనుకుంటున్నారా?" / "WAIT! Do you want to miss this
opportunity?"**, in the page's current language, with two buttons: **Register** (closes the
popup and scrolls to the form) and **Close**.

Two triggers, **each shown at most once per visit**:

1. **1 minute on page** — `const POPUP_DELAY = 60;` (seconds). `0` turns it off.
2. **Desktop exit-intent** — the pointer heads for the tab bar / close button.

On the **actual tab or window close**, browsers do not allow a custom popup. With
`ASK_BEFORE_LEAVING = true` the browser shows **its own** "Leave site?" box (its wording and
language, Leave / Cancel). It is skipped on the way to the payment page and after registering.

Suppressed while the visitor is typing in the form, after a registration (`sntg_registered`
in sessionStorage), and on the way to payment. Dismissable by Register, Close, ✕, the
backdrop or Escape.

**Note on the decline link:** the reference page uses a guilt-trip decline
("No thanks, I GIVE UP ON MY DREAMS…"). This one just says "వద్దు, తర్వాత చూస్తాను".
Shaming a visitor who is already unconvinced is a dark pattern, it reads as desperate to
this audience, and it earns negative Meta ad feedback — which raises your CPM.

## Workshop date

By default the page **auto-rolls to the next Sunday 11 AM**, so it never shows a date
that has already passed. To pin one batch:

```js
const WORKSHOP_DATE = "2026-08-30T11:00:00+05:30";
```

Change the weekday/time with `AUTO_DAY` (0 = Sunday) and `AUTO_HOUR`.
The urgency-bar countdown and both date labels read from this one source.

## Brand

Taken from `sntg-logo.svg`:

| Token | Value | Used for |
|---|---|---|
| `--brand` | `#004AAD` | Logo blue — hero, sections, badges, icons, links |
| `--brand-3` | `#2B8AF0` | Lighter blue for gradients and glows |
| `--gold` | `#F4C320` | **Action only** — buttons, price, countdown accents |
| `--ink` | `#04101F` | Blue-black for dark sections |

Gold is deliberately rationed: if it's gold, it's clickable. That contrast against
royal blue is what makes the CTA pop. To go strictly two-colour, change `--gold`
and `--gold-2` to white and `--gold-ink` to `#004AAD` — buttons become white-on-blue.

## Content: real MSME problems, not generic "AI is the future"

The pain section and all 8 modules are built on problems a Telugu MSME owner
actually has, not on "make a PPT in 10 seconds":

- 90-day pending payments and how to chase them without losing the customer
- Quotations going out Thursday when the competitor's went Tuesday
- A GST notice in English you can't read, and a CA who takes four days
- A ₹15,000 quote for a bank loan project report (DPR)
- Skipping a GeM tender because the bid documents are in English
- Finding out about a subsidy *after* buying the machine

## Compliance — do not delete this

The footer disclaimer states the ₹20,000/₹21,000 figures are an **illustrative
calculation, not a guarantee**, that this is educational only and **not a substitute
for a CA, advocate or financial advisor**, and that statutory work (GST filing,
audit) must stay with a qualified professional. A dedicated FAQ ("Are you telling me
to stop using my CA?") makes the same point. Keep both — a page that implies AI
replaces a CA for statutory filing is a real liability, and being straight about it
also converts better with this audience.

## Copy strategy

Be10x sells a ₹9 impulse workshop; ₹99 filters out no-shows far better while staying
an impulse decision. Everything else carries over: urgency bar → specific pain →
proof of mechanism (the ₹21,000 table) → curriculum → value stack → who it's NOT for
→ objection FAQ → sticky CTA.

Telugu is written the way owners in AP/Telangana actually speak — Telugu script with
English business terms left in (`quotation`, `payment`, `GST notice`, `tender`,
`project report`). Pure literary Telugu reads like a government notice and converts
worse. Full తెలుగు/EN toggle: 196 strings, each carrying `data-te` and `data-en`,
Telugu default, choice stored in `localStorage`.
