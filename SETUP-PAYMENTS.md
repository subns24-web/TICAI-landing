# Payments → Google Sheet → email: one-time setup (about 15 minutes)

How it works:

```
Landing form (name, WhatsApp, email)
   ├─► Google Sheet "Leads" tab           (everyone who clicked Pay)
   └─► Razorpay ₹199 page  https://rzp.io/rzp/fp4Jd12
          └─ paid ─► success.html
                       └─► Google Sheet "Payments" tab  (checked with Razorpay first)
                             └─► email to subns24@gmail.com
```

With Razorpay API keys added (Step 2), a 5-minute background check also records any payment whose buyer closed the
browser before reaching the success page, so no paid customer is missed.

---

## Step 1 — Open the sheet and add the script

The sheet is **already created** in subns24@gmail.com's Google Drive:
**[SNTG Workshop Registrations](https://docs.google.com/spreadsheets/d/1CpZI9srdFq_H44pJv5SK3QQb0XymaVMFGnKNnRvvlUg/edit)**

1. Open the sheet above → **Extensions → Apps Script**.
2. Delete what's in `Code.gs`, paste everything from **`apps-script/Code.gs`** in this repo, and click **Save** (💾).
   The script already knows this sheet's ID, so nothing to edit.

## Step 2 — Razorpay API keys (REQUIRED)

The script adds a buyer to the **Payments** tab and sends their emails **only after Razorpay
confirms the payment succeeded**. It asks Razorpay with these keys, so without them nothing is
recorded and no buyer emails go out (you get a daily "add Razorpay keys" reminder instead).
With keys, it checks every 5 minutes and right away when a buyer reaches the success page,
and on its first run it picks up successful payments from the last 7 days.

1. Razorpay Dashboard → **Account & Settings → API Keys → Generate Key** (use **Live** mode).
2. In Apps Script: **⚙ Project Settings → Script properties → Add script property**:

   | Property | Value |
   |---|---|
   | `RAZORPAY_KEY_ID` | `rzp_live_...` |
   | `RAZORPAY_KEY_SECRET` | the secret |

   Never paste the secret into `index.html`, chat, or GitHub.
   After adding keys, run `setup` again (Step 3).

## Step 3 — Run setup once

1. In the Apps Script editor, choose **`setup`** in the function dropdown → **Run**.
2. Google asks for permission → choose your account → **Advanced → Go to project (unsafe) → Allow**.
   (It says "unsafe" only because it's your own unpublished script.)
3. The log should say **"Setup done"**, the sheet now has **Leads** and **Payments** tabs, and you get a
   **"SNTG sheet connected ✅"** email at subns24@gmail.com — proof that emails work.

## Step 4 — Publish the script as a web app

1. **Deploy → New deployment →** gear icon **→ Web app**.
2. **Execute as:** Me · **Who has access:** **Anyone**.
3. **Deploy** → copy the **Web app URL** (ends in `/exec`).
4. Paste it into **both** files, in the CONFIG section:
   - `index.html` → `const SHEET_ENDPOINT = "https://script.google.com/macros/s/.../exec";`
   - `success.html` → same line, same URL

   (Or send the URL to Claude and it will update both and push.)

> If you edit `Code.gs` later: **Deploy → Manage deployments → ✏ → Version: New version → Deploy**.
> The URL stays the same.

## Step 5 — Send buyers to the success page after paying

Razorpay Dashboard → **Payment Pages** → open the ₹199 page → **Edit** →
**Page settings / After payment** → **Redirect to your website** → enter:

```
https://<your-live-site>/success.html
```

For testing before the site is live, you can use:
`https://raw.githack.com/subns24-web/TICAI-landing/paymentgatewayupdate/success.html`

Also in the page editor, make sure **Email** and **Phone** are required fields
(rename Phone to "WhatsApp number").

## Step 6 — Test

1. Open the landing page, fill the form, click **Pay ₹199**.
2. Check the **Leads** tab — a new row appears within seconds.
3. Pay ₹199 (you can refund yourself afterwards from the Razorpay dashboard).
4. You land on the success page → a **Payments** row appears and an email arrives at subns24@gmail.com.
   If you close the browser instead, the row and email arrive within 5 minutes.

## Step 7 — Automatic messages to buyers (email + WhatsApp)

After you paste the new `Code.gs`, **run `setup` once more**. It adds a **Settings** tab,
four "…sent" columns to **Payments**, and one 5-minute timer that does everything.

| Message | When | Email | WhatsApp template |
|---|---|---|---|
| Welcome + community link | as soon as the payment is verified | ✅ | `sntg_welcome` |
| Reminder | evening before (16 h before start) | ✅ | `sntg_reminder` |
| Live link | 1 hour before start | ✅ | `sntg_live_link` |
| Thank-you + feedback | 30 min after the workshop ends (12:30 PM) | ✅ | `sntg_thank_you` |

**Settings tab — fill these before each batch:**

| Setting | Example |
|---|---|
| Workshop date & time (IST, yyyy-mm-dd hh:mm) | `2026-11-22 10:00` |
| Live link (Zoom / Meet) | `https://meet.google.com/abc-defg-hij` — if empty when it's due, you get a ⚠️ email |
| WhatsApp community link | already filled |
| Feedback / bonus link | a Google Form or Drive folder (optional) |
| Your WhatsApp number (for test messages) | `919876543210` |
| Send messages to buyers (ON / OFF) | `OFF` pauses everything |

**Rules**
- Only payments Razorpay confirms as successful (Status `captured`, ₹199) are added and get messages.
- Each send is stamped in the row, e.g. `22 Nov 09:05 · Email ✓ · WA ✓`. **Clear the cell to resend.**
- **Test first:** run `sendTestToMe` (or menu **SNTG → Send all 4 test messages to me**) — all four
  messages go to subns24@gmail.com and your WhatsApp from Settings; the sheet isn't changed.
- Moving to the next batch: change the date, clear the live link, and start a fresh Payments tab
  (rename the old one, e.g. `Payments 22 Nov`; `setup` creates a new empty one).

Emails work immediately. **WhatsApp stays off** (`WA off` in the stamps) until you finish 7a–7c.

### 7a — Meta WhatsApp Cloud API account (one time, ~1 hour + approval wait)

1. <https://business.facebook.com> → create a **Business portfolio** for SNTG.
2. <https://developers.facebook.com> → **My Apps → Create app** → type **Business** → add the **WhatsApp** product.
3. **WhatsApp → API Setup → Add phone number.** Use a number that is **not** currently on the
   WhatsApp app (or delete WhatsApp from it first). Verify by SMS. Copy the **Phone number ID**.
4. **Permanent token:** Business settings → **Users → System users → Add** (Admin) →
   **Assign assets** (your app + WhatsApp account, full control) → **Generate token** with
   `whatsapp_business_messaging` and `whatsapp_business_management`. Copy it — shown once.
5. **WhatsApp Manager → Payment settings** → add a card (Meta bills per message; utility
   messages in India cost well under ₹1 each).

### 7b — Create the 4 message templates

WhatsApp Manager → **Message templates → Create template** → Category **Utility**, Language
**English**, and use exactly these names and bodies (the `{{n}}` values are filled in by the script):

| Name | Body |
|---|---|
| `sntg_welcome` | `Hi {{1}}, congratulations on taking your first steps! Your registration for the SNTG Live AI Workshop is confirmed for {{2}}. Join our WhatsApp community for live updates: {{3}}` |
| `sntg_reminder` | `Hi {{1}}, a reminder that your SNTG Live AI Workshop is tomorrow, {{2}}. Keep your phone charged. We will send the live link 1 hour before we start.` |
| `sntg_live_link` | `Hi {{1}}, the SNTG Live AI Workshop starts at {{2}}. Join here: {{3}}` |
| `sntg_thank_you` | `Hi {{1}}, thank you for attending the SNTG Live AI Workshop! Please share your feedback and get your bonus files here: {{2}}` |

Approval usually takes minutes to a day. Telugu templates work too — create them in Telugu and
set the script property `WA_TEMPLATE_LANG` to `te`.

### 7c — Connect it

Apps Script → ⚙ **Project Settings → Script properties**:

| Property | Value |
|---|---|
| `WA_TOKEN` | the permanent token from 7a step 4 |
| `WA_PHONE_NUMBER_ID` | the Phone number ID from 7a step 3 |

Then run **`sendTestToMe`**. You should get 4 emails and 4 WhatsApp messages. If a stamp says
`WA ✗ …`, the text after it is Meta's reason (usually "template not approved yet" or a token problem).

## Step 8 — Website login for buyers (TIC AI Academy)

Every buyer Razorpay confirms gets a login on https://tic-ai-academy.vercel.app in the Supabase
project **xexcztrlcnqptlhjxqjg** (set as `SUPABASE_URL` in `Code.gs`):

- **Login ID:** their registered email. **Password:** `ticai2026` (they can change it under My account).
- The "🎁 free access to our website" email carries these details; its button opens the login
  page with both filled in.
- **Plans:** ₹199 → `academy`, ₹4999 → `course` (stored in `app_metadata.plan`, which students
  cannot change). A ₹199 student who later pays ₹4999 is upgraded automatically.
- An existing account keeps its password; its plan only ever goes up.
- The **Website access sent** column in Payments shows the email result and what happened to the
  account (`account created (academy)`, `account upgraded to course`, `account ✗ …`).

One setting is needed — the project's secret key, in Apps Script only:

1. Supabase → project **xexcztrlcnqptlhjxqjg** → **Project Settings → API Keys** → copy the
   **service_role** (secret) key.
2. Apps Script → ⚙ **Project Settings → Script properties** → add or edit
   `SUPABASE_SERVICE_KEY` = that key → Save. (Never put it in a website, a commit or a chat.)
   An old `SUPABASE_URL` property is no longer used and can be deleted.

Until the key is set, buyers still get the email and the column says
`account not created (SUPABASE_SERVICE_KEY not set)`.

## Settings in `Code.gs`

| Setting | Default | Meaning |
|---|---|---|
| `OWNER_EMAIL` | `subns24@gmail.com` | Who gets the "new payment" and "add live link" emails; reply-to on buyer emails |
| `AMOUNT_PAISE` | `19900` | Only ₹199 payments are recorded. Change if the price changes |
| `WORKSHOP_HOURS` | `2` | Workshop length (10 AM – 12 PM) — the thank-you goes 30 min after it ends |

Gmail limit for scripts: **about 100 emails/day** on a free Google account (1,500 on Google Workspace).
Each buyer gets 4 emails spread over several days, so this covers ~100 new buyers a day. If the limit
is hit, unsent messages are retried automatically the next day.
