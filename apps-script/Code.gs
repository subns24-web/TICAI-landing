/**
 * SNTG ₹199 workshop — Google Sheet + email automation.
 *
 * Paste this into the Apps Script editor of your Google Sheet
 * (Sheet → Extensions → Apps Script). Full steps: SETUP-PAYMENTS.md
 *
 * What it does
 *  1. "Leads" tab    — every landing-page form submit (name, WhatsApp, email, business).
 *  2. "Payments" tab — every successful ₹199 payment, CHECKED WITH RAZORPAY first,
 *                      so nobody can add a fake row by opening the success page.
 *  3. Emails OWNER_EMAIL for each new payment.
 *
 * Payments reach the sheet two ways (duplicates are ignored):
 *  - instantly, when the buyer lands on success.html, and
 *  - every 5 minutes, by checkRecentPayments(), which catches anyone who
 *    closed the browser before the success page loaded.
 *
 * Razorpay API keys (recommended) live in Project Settings → Script properties, never in this file:
 *   RAZORPAY_KEY_ID      rzp_live_...
 *   RAZORPAY_KEY_SECRET  ...
 * Without keys it still works: success-page payments are saved as "UNVERIFIED"
 * and the email asks you to confirm them in the Razorpay dashboard.
 */

// The "SNTG Workshop Registrations" sheet in subns24@gmail.com's Google Drive.
const SHEET_ID = '1CpZI9srdFq_H44pJv5SK3QQb0XymaVMFGnKNnRvvlUg';

const OWNER_EMAIL         = 'subns24@gmail.com';
const AMOUNT_PAISE        = 19900;   // ₹199 — only payments of exactly this amount are recorded
const SEND_CUSTOMER_EMAIL = false;   // true = also email the buyer a confirmation
const WORKSHOP_NAME       = 'SNTG Live AI Workshop (Telugu)';

const LEADS_SHEET    = 'Leads';
const PAYMENTS_SHEET = 'Payments';
const LEAD_HEADERS    = ['Submitted at', 'Name', 'WhatsApp', 'Email', 'Business', 'Language', 'Page'];
const PAYMENT_HEADERS = ['Paid at', 'Payment ID', 'Amount (₹)', 'Name', 'Email', 'WhatsApp / Phone',
                         'Method', 'Status', 'Recorded via', 'Razorpay notes'];

/* ---------------- web app entry points ---------------- */

function doGet() {
  return ContentService.createTextOutput('SNTG sheet endpoint is running.');
}

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (data.type === 'lead') saveLead_(data);
    else if (data.type === 'paid') recordPayment_(String(data.payment_id || ''), null, 'success page', data);
  } catch (err) {
    console.error(err);
  }
  return ContentService.createTextOutput('ok');
}

/* ---------------- leads ---------------- */

function saveLead_(d) {
  if (!d.phone && !d.email) return;
  sheet_(LEADS_SHEET, LEAD_HEADERS).appendRow([
    new Date(), clean_(d.name), clean_(d.phone), clean_(d.email),
    clean_(d.business), clean_(d.lang), clean_(d.page)
  ]);
}

/* ---------------- payments ---------------- */

/** Runs every 5 minutes (installed by setup()). Looks at the last 2 hours of payments. */
function checkRecentPayments() {
  if (!hasKeys_()) return;
  const from = Math.floor(Date.now() / 1000) - 2 * 60 * 60;
  const res = razorpay_('/v1/payments?count=100&from=' + from);
  (res.items || []).forEach(p => recordPayment_(p.id, p, 'auto-check', null));
}

/**
 * Records one payment if Razorpay confirms it is captured and for ₹199.
 * `payment` may be passed in (from the list call) or is fetched by ID.
 * `hint` is what the buyer typed on the landing page, used only to fill gaps.
 */
function recordPayment_(paymentId, payment, via, hint) {
  if (!/^pay_[A-Za-z0-9]{6,30}$/.test(paymentId)) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_(PAYMENTS_SHEET, PAYMENT_HEADERS);
    if (alreadyRecorded_(sh, paymentId)) return;

    let p = payment;
    if (!p && !hasKeys_()) {
      // No API keys: can't ask Razorpay, so save it flagged for a manual check.
      p = { id: paymentId, status: 'UNVERIFIED', amount: AMOUNT_PAISE, method: '',
            created_at: Math.floor(Date.now() / 1000), notes: {} };
    } else {
      p = p || razorpay_('/v1/payments/' + paymentId);
      if (p.status !== 'captured' || p.amount !== AMOUNT_PAISE) return;
    }

    const notes = p.notes || {};
    const name  = notes.name || notes.full_name || notes.customer_name || (hint && hint.name) || '';
    const email = p.email || notes.email || (hint && hint.email) || '';
    const phone = p.contact || notes.phone || notes.whatsapp || (hint && hint.phone) || '';

    sh.appendRow([
      new Date(p.created_at * 1000), p.id, p.amount / 100, clean_(name), clean_(email), clean_(phone),
      p.method || '', p.status, via, clean_(JSON.stringify(notes))
    ]);
    SpreadsheetApp.flush();

    notifyOwner_(p, name, email, phone, via);
    if (SEND_CUSTOMER_EMAIL && email) notifyCustomer_(email, name, p.id);
  } finally {
    lock.releaseLock();
  }
}

function alreadyRecorded_(sh, paymentId) {
  const last = sh.getLastRow();
  if (last < 2) return false;
  return sh.getRange(2, 2, last - 1, 1).getValues().some(r => r[0] === paymentId);
}

/* ---------------- email ---------------- */

function notifyOwner_(p, name, email, phone, via) {
  const when = Utilities.formatDate(new Date(p.created_at * 1000), 'Asia/Kolkata', 'dd MMM yyyy, hh:mm a');
  const rows = [
    ['Name', name], ['Email', email], ['WhatsApp / Phone', phone],
    ['Amount', '₹' + (p.amount / 100)], ['Payment ID', p.id], ['Method', p.method],
    ['Paid at (IST)', when], ['Recorded via', via]
  ].map(r => '<tr><td style="padding:4px 12px 4px 0;color:#47576B">' + r[0] + '</td><td><b>' +
             escape_(r[1] || '—') + '</b></td></tr>').join('');
  const unverified = p.status === 'UNVERIFIED';
  MailApp.sendEmail({
    to: OWNER_EMAIL,
    subject: (unverified ? '⚠️ ₹199 payment to verify — ' : '✅ New ₹199 workshop payment — ') +
             (name || email || phone || p.id),
    htmlBody: (unverified
                ? '<p><b>Check this payment ID in the Razorpay dashboard before confirming the seat.</b> ' +
                  'Add Razorpay API keys to the script to verify payments automatically.</p>'
                : '<p>A new seat was paid for the ' + WORKSHOP_NAME + '.</p>') +
              '<table>' + rows + '</table>' +
              '<p><a href="' + ss_().getUrl() + '">Open the sheet</a></p>'
  });
}

function notifyCustomer_(email, name, paymentId) {
  MailApp.sendEmail({
    to: email,
    replyTo: OWNER_EMAIL,
    subject: 'Your seat is confirmed — ' + WORKSHOP_NAME,
    htmlBody: '<p>నమస్కారం ' + escape_(name || '') + ' 🙏</p>' +
              '<p>Your ₹199 payment is received and your seat is confirmed.</p>' +
              '<p>We will send the live workshop link to this email and your WhatsApp before the session.</p>' +
              '<p style="color:#7A8CA3">Payment ID: ' + escape_(paymentId) + '</p><p>— SNTG</p>'
  });
}

/* ---------------- helpers ---------------- */

function razorpay_(path) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('RAZORPAY_KEY_ID');
  const secret = props.getProperty('RAZORPAY_KEY_SECRET');
  if (!id || !secret) throw new Error('Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Script properties.');
  const res = UrlFetchApp.fetch('https://api.razorpay.com' + path, {
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(id + ':' + secret) },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('Razorpay ' + res.getResponseCode() + ': ' + res.getContentText());
  return JSON.parse(res.getContentText());
}

function hasKeys_() {
  const props = PropertiesService.getScriptProperties();
  return !!(props.getProperty('RAZORPAY_KEY_ID') && props.getProperty('RAZORPAY_KEY_SECRET'));
}

function ss_() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function sheet_(name, headers) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sh;
}

/** Trim, cap length, and stop spreadsheet formula injection (=, +, -, @). */
function clean_(v) {
  let s = String(v == null ? '' : v).trim().slice(0, 300);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function escape_(v) {
  return String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------------- one-time setup: run this once from the editor ---------------- */

function setup() {
  // The sheet was created with the Leads headers on its first tab — rename it to "Leads".
  const first = ss_().getSheets()[0];
  if (!ss_().getSheetByName(LEADS_SHEET) && first.getRange('A1').getValue() === LEAD_HEADERS[0]) {
    first.setName(LEADS_SHEET).setFrozenRows(1);
    first.getRange(1, 1, 1, LEAD_HEADERS.length).setFontWeight('bold');
  }
  sheet_(LEADS_SHEET, LEAD_HEADERS);
  sheet_(PAYMENTS_SHEET, PAYMENT_HEADERS);

  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'checkRecentPayments')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkRecentPayments').timeBased().everyMinutes(5).create();

  if (hasKeys_()) {
    razorpay_('/v1/payments?count=1');   // fails loudly here if the API keys are wrong
    console.log('Setup done: tabs ready, 5-minute payment check installed, Razorpay keys OK.');
  } else {
    console.log('Setup done: tabs ready. No Razorpay keys yet — payments will be saved as UNVERIFIED.');
  }
  MailApp.sendEmail(OWNER_EMAIL, 'SNTG sheet connected ✅',
    'Your workshop sheet is connected: ' + ss_().getUrl());
}
