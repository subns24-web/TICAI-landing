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

A 5-minute background check also records any payment whose buyer closed the
browser before reaching the success page, so no paid customer is missed.

---

## Step 1 — Open the sheet and add the script

The sheet is **already created** in subns24@gmail.com's Google Drive:
**[SNTG Workshop Registrations](https://docs.google.com/spreadsheets/d/1CpZI9srdFq_H44pJv5SK3QQb0XymaVMFGnKNnRvvlUg/edit)**

1. Open the sheet above → **Extensions → Apps Script**.
2. Delete what's in `Code.gs`, paste everything from **`apps-script/Code.gs`** in this repo, and click **Save** (💾).
   The script already knows this sheet's ID, so nothing to edit.

## Step 2 — (Recommended, can be done later) Razorpay API keys

Without keys, payments from the success page are saved as **UNVERIFIED** and the
email asks you to check the payment ID in Razorpay. With keys, the script confirms
each payment with Razorpay itself and also catches buyers who closed the browser.

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

## Settings in `Code.gs`

| Setting | Default | Meaning |
|---|---|---|
| `OWNER_EMAIL` | `subns24@gmail.com` | Who gets the "new payment" email |
| `AMOUNT_PAISE` | `19900` | Only ₹199 payments are recorded. Change if the price changes |
| `SEND_CUSTOMER_EMAIL` | `false` | `true` = also email the buyer a seat-confirmed note |

Gmail limit for scripts: about 100 emails/day on a free Google account.
