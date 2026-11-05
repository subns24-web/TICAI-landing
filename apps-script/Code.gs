/**
 * SNTG ₹199 workshop — Google Sheet + payment checks + buyer messaging.
 *
 * Paste this into the Apps Script editor (Sheet → Extensions → Apps Script, or
 * script.google.com). Steps: SETUP-PAYMENTS.md
 *
 * Tabs it manages in the "SNTG Workshop Registrations" sheet:
 *  - Leads     every landing-page form submit (name, WhatsApp, email, business)
 *  - Payments  every ₹199 payment CONFIRMED BY RAZORPAY + when each message was sent
 *  - Settings  workshop date, live link, community link, feedback link, ON/OFF switch
 *
 * Messages to each paid buyer (email always; WhatsApp once Meta Cloud API is set up):
 *  1. Welcome     as soon as Razorpay confirms the payment (registration confirmed)
 *  2. Reminder    the evening before (16 h before start)
 *  3. Live link   1 hour before start  (needs "Live link" filled in Settings)
 *  4. Thank-you   30 min after the workshop ends (WORKSHOP_HOURS)
 * A timer runs every 5 minutes and sends whatever is due. Each send is stamped in the
 * buyer's row; clear that cell to send that message again.
 *
 * Script properties (Project Settings → Script properties) — secrets never go in this file:
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET      REQUIRED: confirm payments with Razorpay
 *   WA_TOKEN, WA_PHONE_NUMBER_ID              Meta WhatsApp Cloud API (turns WhatsApp on)
 *   WA_TEMPLATE_LANG                          optional, template language code (default "en")
 */

// The "SNTG Workshop Registrations" sheet in subns24@gmail.com's Google Drive.
const SHEET_ID = '1CpZI9srdFq_H44pJv5SK3QQb0XymaVMFGnKNnRvvlUg';

const OWNER_EMAIL   = 'subns24@gmail.com';
const AMOUNT_PAISE  = 19900;   // ₹199 — only payments of exactly this amount are recorded
const TEST_AMOUNT_PAISE = 100; // ₹1 — also accepted while the Settings "Testing" switch is ON

/** ₹199, or ₹1 while testing. */
function isWorkshopAmount_(paise) {
  if (paise === AMOUNT_PAISE) return true;
  if (paise !== TEST_AMOUNT_PAISE) return false;
  try { return String(settings_().testing).trim().toUpperCase() === 'ON'; } catch (e) { return false; }
}
const WORKSHOP_NAME = 'SNTG Live AI Workshop (Telugu)';
const SENDER_NAME   = 'SNTG AI Workshop';
const WORKSHOP_HOURS = 2;   // 10 AM – 12 PM

const LEADS_SHEET    = 'Leads';
const PAYMENTS_SHEET = 'Payments';
const SETTINGS_SHEET = 'Settings';
const LEAD_HEADERS    = ['Submitted at', 'Name', 'WhatsApp', 'Email', 'Business', 'Language', 'Page'];
const PAYMENT_HEADERS = ['Paid at', 'Payment ID', 'Amount (₹)', 'Name', 'Email', 'WhatsApp / Phone',
                         'Method', 'Status', 'Recorded via', 'Razorpay notes',
                         'Welcome sent', 'Reminder sent', 'Live link sent', 'Thank-you sent'];
const COL = { name: 4, email: 5, phone: 6, status: 8 };   // 1-based columns in Payments

// Settings tab: label → default value. Edit the values in the sheet, not here.
const SETTINGS = {
  date:      ['Workshop date & time (IST, yyyy-mm-dd hh:mm)', '2026-11-22 10:00'],
  live:      ['Live link (Zoom / Meet)', ''],
  community: ['WhatsApp community link', 'https://chat.whatsapp.com/KUMcVB1BMy64Pvjbu79zj0'],
  feedback:  ['Feedback / bonus link', ''],
  ownerWa:   ['Your WhatsApp number (for test messages)', ''],
  enabled:   ['Send messages to buyers (ON / OFF)', 'ON'],
  testing:   ['Testing: email every payment, even repeats by the same person (ON / OFF)', 'ON']
  // While Testing is ON, each NEW payment also gets the reminder, live-link and thank-you emails
  // immediately, and subns24@gmail.com gets a copy (BCC) of every buyer email.
};

const HOUR = 3600 * 1000, MIN = 60 * 1000;
// Each stage: Payments column it stamps, and when it is due relative to the workshop start.
const STAGES = [
  { key: 'welcome',  col: 11, due: (now, start) => true },
  { key: 'reminder', col: 12, due: (now, start) => now >= start - 16 * HOUR && now < start - 70 * MIN },
  { key: 'live',     col: 13, due: (now, start) => now >= start - 60 * MIN && now < start + WORKSHOP_HOURS * HOUR },
  { key: 'thanks',   col: 14, due: (now, start) => now >= start + (WORKSHOP_HOURS + 0.5) * HOUR && now < start + 72 * HOUR }
];

/* ================= web app entry points ================= */

function doGet() {
  return ContentService.createTextOutput('SNTG sheet endpoint is running.');
}

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (data.type === 'lead') saveLead_(data);
    else if (data.type === 'paid') {
      // Reaching the success page proves nothing by itself: only Razorpay's answer counts.
      const pid = String(data.payment_id || '');
      if (!hasKeys_()) alertMissingKeys_();
      else if (/^pay_/.test(pid)) recordPayment_(pid, null, 'success page', data);
      else checkRecentPayments();                           // no ID in the redirect: ask Razorpay now
    }
  } catch (err) {
    console.error(err);
  }
  return ContentService.createTextOutput('ok');
}

/** Sheet menu (shows when the script was opened from the sheet via Extensions → Apps Script). */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('SNTG')
      .addItem('Send due messages now', 'runMessages')
      .addItem('Send all 4 test messages to me', 'sendTestToMe')
      .addItem('Resend already-sent emails to all buyers', 'resendToAllBuyers')
      .addItem('Send all 4 test messages to the latest form entry', 'sendTestToLatestLead')
      .addToUi();
  } catch (err) { /* not opened from the sheet */ }
}

/** Runs every 5 minutes (installed by setup()). */
function tick() {
  try { oneTimeUpdates_(); } catch (err) { console.error(err); }
  try { checkRecentPayments(); } catch (err) { console.error(err); }
  runMessages();
}

/* ================= one-time updates (run automatically by the timer) ================= */

/**
 * Sends the live-link (Zoom) and thank-you emails NOW to everyone who has paid (Razorpay
 * "captured"), one of each per person, with a copy to you. These early copies are not
 * stamped in the sheet, so the scheduled ones still go on 22 Nov 9:00 AM and 12:30 PM IST.
 * Runs once automatically after this code is saved; can also be run from the editor.
 */
function sendLiveAndThanksNow() {
  const s = settings_();
  const start = workshopStart_(s);
  const sSend = Object.assign({}, s, { live: s.live || 'https://zoom.us/', testing: 'ON' });   // ON = copy to you
  const sh = sheet_(PAYMENTS_SHEET, PAYMENT_HEADERS);
  if (sh.getLastRow() < 2) return [];
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, PAYMENT_HEADERS.length).getValues();
  const seen = {}, out = [];
  rows.forEach(r => {
    if (String(r[COL.status - 1]).trim().toLowerCase() !== 'captured') return;
    let buyer = { name: String(r[COL.name - 1] || ''), email: String(r[COL.email - 1] || '').trim(),
                  phone: String(r[COL.phone - 1] || '') };
    if (!buyer.name || !buyer.email) {
      const lead = findLead_(buyer.email, buyer.phone);
      if (lead) buyer = { name: buyer.name || lead.name, email: buyer.email || lead.email, phone: buyer.phone || lead.phone };
    }
    const key = buyer.email.toLowerCase() || buyer.phone.replace(/\D/g, '').slice(-10);
    if (!key || seen[key]) return;
    seen[key] = true;
    ['live', 'thanks'].forEach(k => {
      if (MailApp.getRemainingDailyQuota() < 2) return;
      out.push(k + ' → ' + (buyer.email || buyer.phone) + ': ' + sendStage_(k, buyer, sSend, start));
    });
  });
  console.log(out.join('\n') || 'No paid buyers yet.');
  return out;
}

/**
 * Sets the sheet's timezone to IST and re-saves the existing timestamps (column A of
 * Leads and Payments) so rows written while the sheet was on GMT also show India time.
 */
function switchSheetToIST_() {
  const ss = ss_();
  const cols = [LEADS_SHEET, PAYMENTS_SHEET].map(n => ss.getSheetByName(n)).filter(sh => sh && sh.getLastRow() > 1)
    .map(sh => ({ range: sh.getRange(2, 1, sh.getLastRow() - 1, 1) }));
  cols.forEach(c => c.values = c.range.getValues());          // read as real moments in time (old zone)
  ss.setSpreadsheetTimeZone('Asia/Kolkata');
  cols.forEach(c => c.range.setValues(c.values));             // write back: now shown in IST
  SpreadsheetApp.flush();
}

// Test emails go here once, addressed by the name this email typed on the website.
const ONE_TIME_TEST_EMAIL = 'priyankka.156@gmail.com';

/**
 * Runs each update once, the first time the timer fires after this code is saved:
 *  1. moves the Settings date from the old batch (14 Nov 11:00) to 22 Nov 10:00
 *  2. sends the four test emails to ONE_TIME_TEST_EMAIL with the name from the Leads tab
 */
function oneTimeUpdates_() {
  const props = PropertiesService.getScriptProperties();

  // Show every time in the sheet in India time (it was created on GMT).
  if (ss_().getSpreadsheetTimeZone() !== 'Asia/Kolkata') switchSheetToIST_();

  if (!props.getProperty('DONE_DATE_2026_11_22')) {
    const sh = ensureSettings_();
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    rows.forEach((r, i) => {
      const v = isDate_(r[1]) ? Utilities.formatDate(r[1], ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm') : String(r[1]).trim();
      if (r[0] === SETTINGS.date[0] && (v === '' || v === '2026-11-14 11:00')) {
        sh.getRange(i + 2, 2).setValue('2026-11-22 10:00');
      }
    });
    props.setProperty('DONE_DATE_2026_11_22', new Date().toISOString());
  }

  // Early test copies sent before a stage opened were stamped by an older version; clear
  // them once so the real reminder / live link / thank-you still go on schedule.
  if (!props.getProperty('DONE_CLEAR_EARLY_STAMPS_V1')) {
    props.setProperty('DONE_CLEAR_EARLY_STAMPS_V1', new Date().toISOString());
    const start = workshopStart_(settings_()).getTime(), now = Date.now();
    const opens = { reminder: start - 16 * HOUR, live: start - 60 * MIN,
                    thanks: start + (WORKSHOP_HOURS + 0.5) * HOUR };
    const sh = sheet_(PAYMENTS_SHEET, PAYMENT_HEADERS);
    if (sh.getLastRow() >= 2) {
      const rows = sh.getRange(2, 1, sh.getLastRow() - 1, PAYMENT_HEADERS.length).getValues();
      rows.forEach((r, i) => STAGES.forEach(st => {
        if (opens[st.key] && now < opens[st.key] && r[st.col - 1] !== '') sh.getRange(i + 2, st.col).setValue('');
      }));
    }
  }

  if (!props.getProperty('DONE_PREVIEW_LIVE_THANKS_V1')) {
    props.setProperty('DONE_PREVIEW_LIVE_THANKS_V1', new Date().toISOString());   // set first: never twice
    sendLiveAndThanksNow();
  }

  if (!props.getProperty('DONE_TEST_EMAILS_V3')) {
    props.setProperty('DONE_TEST_EMAILS_V3', new Date().toISOString());   // set first: never sends twice
    const lead = findLead_(ONE_TIME_TEST_EMAIL, '') || { name: '', phone: '', email: ONE_TIME_TEST_EMAIL };
    lead.email = ONE_TIME_TEST_EMAIL;
    const s = settings_();
    const start = workshopStart_(s);
    const sTest = Object.assign({}, s, { live: s.live || 'https://meet.google.com/test-link' });
    const out = STAGES.map(st => st.key + ': ' + sendStage_(st.key, lead, sTest, start));
    MailApp.sendEmail(OWNER_EMAIL, 'SNTG: script updated ✅ test emails sent',
      'The new script is running.\n\nWorkshop date in Settings: ' + settings_().date +
      '\nTest emails sent to ' + (lead.name || '(no name)') + ' <' + lead.email + '>:\n' + out.join('\n') +
      '\n\nSheet: ' + ss_().getUrl());
  }
}

/* ================= leads ================= */

function saveLead_(d) {
  if (!d.phone && !d.email) return;
  sheet_(LEADS_SHEET, LEAD_HEADERS).appendRow([
    new Date(), clean_(d.name), clean_(d.phone), clean_(d.email),
    clean_(d.business), clean_(d.lang), clean_(d.page)
  ]);
}

/* ================= payments ================= */

/** Looks at the last 2 hours of Razorpay payments (only when API keys are set). */
function checkRecentPayments() {
  if (!hasKeys_()) return;
  const props = PropertiesService.getScriptProperties();
  const now = Math.floor(Date.now() / 1000);
  const lastRun = Number(props.getProperty('LAST_RAZORPAY_CHECK') || 0);
  // From 2 h before the last check (overlap is safe: duplicates are skipped); first run: last 7 days.
  let from = lastRun ? lastRun - 2 * 3600 : now - 7 * 24 * 3600;
  for (let page = 0; page < 10; page++) {
    const res = razorpay_('/v1/payments?count=100&from=' + from + '&to=' + now + '&skip=' + page * 100);
    const items = res.items || [];
    items.forEach(p => recordPayment_(p.id, p, 'Razorpay', null));
    if (items.length < 100) break;
  }
  props.setProperty('LAST_RAZORPAY_CHECK', String(now));
}

/** Emails you (once a day) that payments can't be confirmed until the Razorpay keys are added. */
function alertMissingKeys_() {
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  if (props.getProperty('KEYS_ALERT') === today) return;
  props.setProperty('KEYS_ALERT', today);
  MailApp.sendEmail(OWNER_EMAIL, '⚠️ A buyer reached the success page — add Razorpay keys to confirm payments',
    'Someone just reached the payment success page, but the script cannot ask Razorpay whether the payment ' +
    'succeeded, so nothing was added to the Payments tab and no emails were sent.\n\n' +
    'Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Apps Script → Project Settings → Script properties. ' +
    'Within 5 minutes the script then picks up every successful payment from the last 7 days, adds it ' +
    'to the sheet and sends the welcome email.\n\n' + ss_().getUrl());
}

/**
 * Records one payment only if Razorpay confirms it is captured (successful) and for ₹199.
 * Nothing is recorded without the Razorpay API keys.
 */
function recordPayment_(paymentId, payment, via, hint) {
  if (!/^pay_[A-Za-z0-9]{6,30}$/.test(paymentId)) return;

  let recorded = false;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_(PAYMENTS_SHEET, PAYMENT_HEADERS);
    if (alreadyRecorded_(sh, paymentId)) return;

    if (!payment && !hasKeys_()) return;                 // can't confirm with Razorpay
    const p = payment || razorpay_('/v1/payments/' + paymentId);
    if (p.status !== 'captured' || !isWorkshopAmount_(p.amount)) return;   // only successful ₹199 (₹1 while testing)

    const notes = p.notes || {};
    let email = p.email || notes.email || (hint && hint.email) || '';
    let phone = p.contact || notes.phone || notes.whatsapp || (hint && hint.phone) || '';
    // The name typed on the website form wins; Razorpay's fields are the fallback.
    const lead = findLead_(email, phone);
    const name = (hint && hint.name) || (lead && lead.name) ||
                 notes.name || notes.full_name || notes.customer_name || '';
    email = email || (lead && lead.email) || '';
    phone = phone || (lead && lead.phone) || '';

    sh.appendRow([
      new Date(p.created_at * 1000), p.id, p.amount / 100, clean_(name), clean_(email), clean_(phone),
      p.method || '', p.status, via, clean_(JSON.stringify(notes)), '', '', '', ''
    ]);
    SpreadsheetApp.flush();
    notifyOwner_(p, name, email, phone, via);
    recorded = p.status === 'captured';
  } finally {
    lock.releaseLock();
  }
  if (recorded) runMessages();   // send the welcome straight away
}

function alreadyRecorded_(sh, paymentId) {
  const last = sh.getLastRow();
  if (last < 2) return false;
  return sh.getRange(2, 2, last - 1, 1).getValues().some(r => r[0] === paymentId);
}

/* ================= buyer messages ================= */

/** Sends every message that is due to every verified buyer. Safe to run any time. */
function runMessages() {
  const s = settings_();
  if (String(s.enabled).trim().toUpperCase() === 'OFF') return;
  const start = workshopStart_(s);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = sheet_(PAYMENTS_SHEET, PAYMENT_HEADERS);
    const last = sh.getLastRow();
    if (last < 2) return;
    const rows = sh.getRange(2, 1, last - 1, PAYMENT_HEADERS.length).getValues();
    const now = Date.now();

    // One set of messages per person: a buyer who paid more than once is messaged once per stage.
    const buyerKey = r => {
      const e = String(r[COL.email - 1] || '').trim().toLowerCase();
      const ph = String(r[COL.phone - 1] || '').replace(/\D/g, '').slice(-10);
      return e || ph;
    };
    const DUP = 'not sent — same person already received this';
    const REFUNDED = 'not sent — payment no longer successful in Razorpay';
    const sentTo = {};   // stage key -> { buyerKey: true }
    STAGES.forEach(st => sentTo[st.key] = {});
    rows.forEach(r => {
      if (String(r[COL.status - 1]).trim().toLowerCase() !== 'captured') return;
      STAGES.forEach(st => {
        const v = String(r[st.col - 1] || '');
        if (v && v.indexOf('not sent') === -1 && buyerKey(r)) sentTo[st.key][buyerKey(r)] = true;
      });
    });

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const status = String(r[COL.status - 1]).trim().toLowerCase();
      if (status !== 'captured') continue;   // confirmed by Razorpay only
      const testingNow = String(s.testing).trim().toUpperCase() === 'ON';
      // Testing: a new payment (welcome not sent yet) gets all four emails immediately.
      const allNow = testingNow && r[STAGES[0].col - 1] === '';
      const due = STAGES.filter(st => r[st.col - 1] === '' && (allNow || st.due(now, start.getTime())));
      if (!due.length) continue;

      // Re-confirm with Razorpay before messaging: a refunded payment gets nothing more.
      const pid = String(r[1] || '');
      if (hasKeys_() && /^pay_/.test(pid)) {
        try {
          const p = razorpay_('/v1/payments/' + pid);
          if (p.status !== 'captured') {
            sh.getRange(i + 2, COL.status).setValue(p.status);
            due.forEach(st => sh.getRange(i + 2, st.col).setValue(REFUNDED));
            continue;
          }
        } catch (err) { console.error(err); continue; }   // try again next run
      }
      const buyer = { name: String(r[COL.name - 1] || ''), email: String(r[COL.email - 1] || ''),
                      phone: String(r[COL.phone - 1] || '') };
      if (!buyer.name || !buyer.email || !buyer.phone) {
        const lead = findLead_(buyer.email, buyer.phone);
        if (lead) {
          [['name', COL.name], ['email', COL.email], ['phone', COL.phone]].forEach(([k, c]) => {
            if (!buyer[k] && lead[k]) { buyer[k] = lead[k]; sh.getRange(i + 2, c).setValue(clean_(lead[k])); }
          });
        }
      }

      for (const st of due) {
        if (st.key === 'live' && !s.live && !allNow) { alertMissingLiveLink_(); continue; }
        const k = buyerKey(r) || buyerKey([0, 0, 0, 0, buyer.email, buyer.phone]);
        const testing = String(s.testing).trim().toUpperCase() === 'ON';
        if (!testing && k && sentTo[st.key][k]) { sh.getRange(i + 2, st.col).setValue(DUP); r[st.col - 1] = DUP; continue; }
        if (MailApp.getRemainingDailyQuota() < 1) { console.error('Daily email quota used up; will retry.'); return; }
        // Testing preview of a later email (sent early): don't stamp it, so the real one still
        // goes at its scheduled time (21 Nov 6 PM reminder, 22 Nov 9 AM live link, 12:30 PM thank-you).
        const preview = allNow && st.key !== 'welcome' && !st.due(now, start.getTime());
        const sSend = (allNow && !s.live) ? Object.assign({}, s, { live: 'https://zoom.us/' }) : s;
        const result = sendStage_(st.key, buyer, sSend, start);
        if (preview) continue;
        sh.getRange(i + 2, st.col).setValue(result);
        r[st.col - 1] = result;
        if (k) sentTo[st.key][k] = true;
      }
    }
  } finally {
    lock.releaseLock();
  }
}

/** Sends one message (email + WhatsApp) and returns the text stamped in the sheet. */
function sendStage_(key, buyer, s, start) {
  const m = message_(key, buyer, s, start);
  const parts = [];

  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyer.email)) {
    try {
      const opts = { to: buyer.email, name: SENDER_NAME, replyTo: OWNER_EMAIL,
                     subject: m.subject, htmlBody: emailLayout_(m.html) };
      // Testing: you get a copy of every email a buyer receives.
      if (String(s.testing).trim().toUpperCase() === 'ON' && buyer.email.toLowerCase() !== OWNER_EMAIL) opts.bcc = OWNER_EMAIL;
      MailApp.sendEmail(opts);
      parts.push('Email ✓');
    } catch (err) { parts.push('Email ✗ ' + err.message); }
  } else {
    parts.push('no email');
  }

  if (waConfigured_()) {
    const to = normalizePhone_(buyer.phone);
    if (!to) parts.push('no WhatsApp number');
    else {
      const res = waSend_(to, m.waTemplate, m.waParams);
      parts.push(res.ok ? 'WA ✓' : 'WA ✗ ' + res.error);
    }
  } else {
    parts.push('WA off');
  }
  return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd MMM HH:mm') + ' · ' + parts.join(' · ');
}

/** The four messages. Email HTML + the WhatsApp template name and its {{1}}, {{2}}… values. */
function message_(key, b, s, start) {
  const fullName = String(b.name || '').trim();
  const first = fullName.split(/\s+/)[0] || 'there';
  const hi = fullName
    ? '<p>నమస్కారం <b>' + escape_(fullName) + '</b> గారు 🙏<br>Dear <b>' + escape_(fullName) + '</b>,</p>'
    : '<p>నమస్కారం 🙏</p>';
  const who = fullName ? fullName + ', ' : '';
  const day = Number(Utilities.formatDate(start, 'Asia/Kolkata', 'd'));
  const suffix = (day % 100 >= 11 && day % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] || 'th');
  const time = Utilities.formatDate(start, 'Asia/Kolkata', 'h:mm a') + ' IST';
  // e.g. "Sunday, 22nd November 2026 · 10:00 AM IST"
  const when = Utilities.formatDate(start, 'Asia/Kolkata', 'EEEE') + ', ' + day + suffix + ' ' +
               Utilities.formatDate(start, 'Asia/Kolkata', 'MMMM yyyy') + ' · ' + time +
               '';
  const button = (url, label, color) => '<p style="margin:22px 0"><a href="' + escape_(url) +
    '" style="background:' + color + ';color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;display:inline-block">' +
    label + '</a></p>';

  switch (key) {
    case 'welcome': return {
      subject: '🎉 ' + who + 'your registration is confirmed — ' + WORKSHOP_NAME,
      html: hi + '<p><b>Congratulations on taking your first steps!</b> Your registration is confirmed. ' +
            'Get ready for your transformation 🚀</p>' +
            '<p>📅 <b>' + escape_(when) + '</b><br>📱 Your phone is enough — no laptop needed.</p>' +
            '<p>Join our WhatsApp community for live updates:</p>' +
            button(s.community, 'Join the WhatsApp Community', '#25D366') +
            '<p>We will send the live link 1 hour before the workshop.</p>',
      waTemplate: 'sntg_welcome', waParams: [first, when, s.community]
    };
    case 'reminder': return {
      subject: '⏰ ' + who + 'your workshop is tomorrow — ' + WORKSHOP_NAME,
      html: hi + '<p>A quick reminder — your workshop is <b>tomorrow</b>.</p>' +
            '<p>📅 <b>' + escape_(when) + '</b></p>' +
            '<p>Keep your phone charged and your internet on. The live link comes 1 hour before we start.</p>' +
            button(s.community, 'Open the WhatsApp Community', '#25D366'),
      waTemplate: 'sntg_reminder', waParams: [first, when]
    };
    case 'live': return {
      subject: '🔴 ' + who + 'your live link — ' + when,
      html: hi + '<p>📅 <b>' + escape_(when) + '</b></p>' +
            '<p>The workshop starts at <b>' + escape_(time) + '</b>. Join a few minutes early:</p>' +
            button(s.live, 'Join the live workshop', '#004AAD') +
            '<p style="color:#47576B">Link: ' + escape_(s.live) + '</p>',
      waTemplate: 'sntg_live_link', waParams: [first, time, s.live]
    };
    case 'thanks': return {
      subject: '🙏 Thank you for joining, ' + (fullName || 'friend') + ' — ' + WORKSHOP_NAME,
      html: hi + '<p>📅 <b>' + escape_(when) + '</b></p>' +
            '<p>Thank you for attending! We hope you are already using AI in your business.</p>' +
            (s.feedback ? '<p>Please share your feedback and get your bonus files here:</p>' +
                          button(s.feedback, 'Feedback & bonus files', '#004AAD') : '') +
            '<p>Stay in the community for tips and updates:</p>' +
            button(s.community, 'WhatsApp Community', '#25D366'),
      waTemplate: 'sntg_thank_you', waParams: [first, s.feedback || s.community]
    };
  }
}

function emailLayout_(inner) {
  return '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#04101F;max-width:560px">' +
         inner + '<p>— Team SNTG</p>' +
         '<p style="color:#7A8CA3;font-size:12px">Questions? Just reply to this email.</p></div>';
}

/** Emails you once a day if the live stage is due but the live link is empty. */
function alertMissingLiveLink_() {
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  if (props.getProperty('LIVE_LINK_ALERT') === today) return;
  props.setProperty('LIVE_LINK_ALERT', today);
  MailApp.sendEmail(OWNER_EMAIL, '⚠️ Add the live link — workshop starts within the hour',
    'Buyers are waiting for the live link. Paste it in the Settings tab ("' + SETTINGS.live[0] +
    '") and it goes out within 5 minutes: ' + ss_().getUrl());
}

/** Sends all four messages to you (OWNER_EMAIL + your WhatsApp from Settings). Changes nothing in the sheet. */
function sendTestToMe() {
  const s = settings_();
  const start = workshopStart_(s);
  const me = { name: 'Test', email: OWNER_EMAIL, phone: String(s.ownerWa || '') };
  const sTest = Object.assign({}, s, { live: s.live || 'https://meet.google.com/test-link' });
  const out = STAGES.map(st => st.key + ': ' + sendStage_(st.key, me, sTest, start));
  console.log(out.join('\n'));
  return out;
}

/**
 * Finds what a buyer typed on the website (Leads tab), matching by email or by the
 * last 10 digits of the phone number. The most recent matching entry wins.
 */
function findLead_(email, phone) {
  const sh = ss_().getSheetByName(LEADS_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  const e = String(email || '').trim().toLowerCase();
  const ph = String(phone || '').replace(/\D/g, '').slice(-10);
  if (!e && ph.length < 10) return null;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();   // time, name, whatsapp, email
  for (let i = rows.length - 1; i >= 0; i--) {
    const rEmail = String(rows[i][3] || '').trim().toLowerCase();
    const rPhone = String(rows[i][2] || '').replace(/\D/g, '').slice(-10);
    if ((e && rEmail === e) || (ph.length === 10 && rPhone === ph)) {
      return { name: String(rows[i][1] || '').trim(), phone: String(rows[i][2] || ''), email: String(rows[i][3] || '') };
    }
  }
  return null;
}

/**
 * Sends again every message a verified buyer has already received (now with their name),
 * then stamps the new send time. Messages not yet due are left for their normal time.
 * Run from the editor or the SNTG menu.
 */
function resendToAllBuyers() {
  const sh = sheet_(PAYMENTS_SHEET, PAYMENT_HEADERS);
  const last = sh.getLastRow();
  if (last < 2) { console.log('No buyers yet.'); return 0; }
  const rows = sh.getRange(2, 1, last - 1, PAYMENT_HEADERS.length).getValues();
  let cleared = 0;
  rows.forEach((r, i) => {
    const status = String(r[COL.status - 1]).trim().toLowerCase();
    if (status !== 'captured') return;
    STAGES.forEach(st => {
      if (r[st.col - 1] !== '') { sh.getRange(i + 2, st.col).setValue(''); cleared++; }
    });
  });
  SpreadsheetApp.flush();
  runMessages();   // re-sends whatever is due now (the welcome always is)
  console.log('Cleared ' + cleared + ' sent stamps and re-sent due messages.');
  return cleared;
}

/**
 * Sends all four messages to the most recent person in the Leads tab, using the name and
 * email they typed on the website. For testing with your own form entry. Changes nothing.
 */
function sendTestToLatestLead() {
  const sh = ss_().getSheetByName(LEADS_SHEET);
  if (!sh || sh.getLastRow() < 2) throw new Error('No form entries in the Leads tab yet.');
  const r = sh.getRange(sh.getLastRow(), 1, 1, 4).getValues()[0];   // time, name, whatsapp, email
  const lead = { name: String(r[1] || '').trim(), phone: String(r[2] || ''), email: String(r[3] || '').trim() };
  if (!lead.email) throw new Error('The latest form entry has no email.');
  const s = settings_();
  const start = workshopStart_(s);
  const sTest = Object.assign({}, s, { live: s.live || 'https://meet.google.com/test-link' });
  const out = STAGES.map(st => st.key + ': ' + sendStage_(st.key, lead, sTest, start));
  console.log('Sent to ' + lead.name + ' <' + lead.email + '>\n' + out.join('\n'));
  return out;
}

/* ================= WhatsApp (Meta Cloud API) ================= */

function waConfigured_() {
  const p = PropertiesService.getScriptProperties();
  return !!(p.getProperty('WA_TOKEN') && p.getProperty('WA_PHONE_NUMBER_ID'));
}

function waSend_(to, template, params) {
  const p = PropertiesService.getScriptProperties();
  const body = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'template',
    template: {
      name: template,
      language: { code: p.getProperty('WA_TEMPLATE_LANG') || 'en' },
      components: [{ type: 'body', parameters: params.map(t => ({ type: 'text', text: waText_(t) })) }]
    }
  };
  try {
    const res = UrlFetchApp.fetch('https://graph.facebook.com/v21.0/' + p.getProperty('WA_PHONE_NUMBER_ID') + '/messages', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + p.getProperty('WA_TOKEN') },
      payload: JSON.stringify(body)
    });
    if (res.getResponseCode() === 200) return { ok: true };
    let msg = res.getContentText();
    try { msg = JSON.parse(msg).error.message; } catch (e) {}
    return { ok: false, error: String(msg).slice(0, 120) };
  } catch (err) {
    return { ok: false, error: String(err.message).slice(0, 120) };
  }
}

/** WhatsApp template values can't be empty or contain newlines/tabs. */
function waText_(v) {
  const s = String(v == null ? '' : v).replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim();
  return s || '-';
}

/** "+91 98765 43210", "09876543210", "9876543210" → "919876543210". */
function normalizePhone_(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return '91' + d;
  if (d.length === 11 && d[0] === '0') return '91' + d.slice(1);
  if (d.length >= 11 && d.length <= 15) return d;
  return '';
}

/* ================= owner email ================= */

function notifyOwner_(p, name, email, phone, via) {
  const when = Utilities.formatDate(new Date(p.created_at * 1000), 'Asia/Kolkata', 'dd MMM yyyy, hh:mm a');
  const rows = [
    ['Name', name], ['Email', email], ['WhatsApp / Phone', phone],
    ['Amount', '₹' + (p.amount / 100)], ['Payment ID', p.id], ['Method', p.method],
    ['Paid at (IST)', when], ['Recorded via', via]
  ].map(r => '<tr><td style="padding:4px 12px 4px 0;color:#47576B">' + r[0] + '</td><td><b>' +
             escape_(r[1] || '—') + '</b></td></tr>').join('');
  MailApp.sendEmail({
    to: OWNER_EMAIL,
    subject: '✅ New ₹' + (p.amount / 100) + ' workshop payment — ' + (name || email || phone || p.id),
    htmlBody: '<p>Razorpay confirmed a successful payment for the ' + WORKSHOP_NAME +
              '. The buyer\'s welcome email is on its way.</p>' +
              '<table>' + rows + '</table>' +
              '<p><a href="' + ss_().getUrl() + '">Open the sheet</a></p>'
  });
}

/* ================= helpers ================= */

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

/** Gets a tab, creating it (or extending its header row) as needed. */
function sheet_(name, headers) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < headers.length) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  return sh;
}

/** Reads the Settings tab into { date, live, community, feedback, ownerWa, enabled }. */
function settings_() {
  const sh = ensureSettings_();
  const byLabel = {};
  sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 2).getValues().forEach(r => byLabel[r[0]] = r[1]);
  const out = {};
  Object.keys(SETTINGS).forEach(k => {
    const v = byLabel[SETTINGS[k][0]];
    out[k] = isDate_(v) ? v : String(v == null ? '' : v).trim();
    if (k === 'date') {
      // If Sheets turned the text into a date, read the time exactly as shown in the sheet, as IST.
      const txt = isDate_(v) ? Utilities.formatDate(v, ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm') : out[k];
      out[k] = txt;
      if (!txt || txt === '2026-11-14 11:00') out[k] = SETTINGS.date[1];   // old batch → 22 Nov 10:00
    }
  });
  return out;
}

function ensureSettings_() {
  const ss = ss_();
  let sh = ss.getSheetByName(SETTINGS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SETTINGS_SHEET);
    sh.getRange(1, 1, 1, 2).setValues([['Setting', 'Value']]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('B:B').setNumberFormat('@');   // keep dates/links as plain text
    sh.setColumnWidth(1, 380); sh.setColumnWidth(2, 420);
  }
  const have = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => r[0]) : [];
  Object.keys(SETTINGS).forEach(k => {
    if (have.indexOf(SETTINGS[k][0]) === -1) sh.appendRow(SETTINGS[k]);
  });
  return sh;
}

/** Workshop start from Settings; if that cell can't be read, the batch date in this file (never "now"). */
function workshopStart_(s) {
  const d = parseIST_(s.date);
  if (d) return d;
  console.error('Workshop date in Settings is not readable (' + s.date + '); using ' + SETTINGS.date[1] + ' IST.');
  return parseIST_(SETTINGS.date[1]);
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

/** Accepts a Date or "yyyy-mm-dd hh:mm" (read as India time). */
function parseIST_(v) {
  if (isDate_(v)) return v;
  const m = String(v || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})[ T]+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 330 * MIN);
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

/* ================= health check: run this to see what's working ================= */

/**
 * Prints a plain-language status report in the Execution log. Changes nothing, sends nothing.
 * Never prints the Razorpay secret.
 */
function checkSetup() {
  const lines = [];
  const ok = (good, text) => lines.push((good ? '✅ ' : '❌ ') + text);
  const props = PropertiesService.getScriptProperties();

  try { ok(true, 'Sheet opens: ' + ss_().getName() + ' (timezone ' + ss_().getSpreadsheetTimeZone() + ')'); }
  catch (e) { ok(false, 'Cannot open the sheet: ' + e.message); }

  try { const s = settings_(); ok(true, 'Workshop date used in emails: ' + Utilities.formatDate(workshopStart_(s), 'Asia/Kolkata', "EEEE, d MMMM yyyy, h:mm a") + ' IST'); }
  catch (e) { ok(false, 'Settings tab: ' + e.message); }

  const id = props.getProperty('RAZORPAY_KEY_ID') || '';
  const secret = props.getProperty('RAZORPAY_KEY_SECRET') || '';
  ok(!!id, id ? 'RAZORPAY_KEY_ID is set (' + id.slice(0, 13) + '…)' : 'RAZORPAY_KEY_ID is missing in Script properties');
  ok(!!secret, secret ? 'RAZORPAY_KEY_SECRET is set (hidden)' : 'RAZORPAY_KEY_SECRET is missing in Script properties');
  if (id && !/^rzp_(live|test)_/.test(id)) ok(false, 'RAZORPAY_KEY_ID should start with rzp_live_ (check for spaces)');
  if (id.startsWith('rzp_test_')) ok(false, 'This is a TEST key: real (live) payments will not be seen. Use the rzp_live_ key.');

  if (id && secret) {
    try {
      const res = razorpay_('/v1/payments?count=100&from=' + (Math.floor(Date.now() / 1000) - 7 * 24 * 3600));
      const items = res.items || [];
      const good = items.filter(p => p.status === 'captured' && isWorkshopAmount_(p.amount));
      ok(true, 'Razorpay connection works. Last 7 days: ' + items.length + ' payments, ' + good.length + ' successful ₹199');
      good.slice(0, 10).forEach(p => lines.push('     • ' + p.id + '  ' + (p.email || '') + '  ' + (p.contact || '') + '  ' +
        Utilities.formatDate(new Date(p.created_at * 1000), 'Asia/Kolkata', 'dd MMM HH:mm') + ' IST'));
    } catch (e) {
      ok(false, 'Razorpay refused the keys: ' + String(e.message).slice(0, 160) + '  (401 = wrong ID/secret pair)');
    }
  }

  const triggers = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
  ok(triggers.indexOf('tick') !== -1, 'Timer: ' + (triggers.length ? triggers.join(', ') : 'none — run setup once'));
  const last = props.getProperty('LAST_RAZORPAY_CHECK');
  lines.push('ℹ️ Last Razorpay check: ' + (last ? Utilities.formatDate(new Date(Number(last) * 1000), 'Asia/Kolkata', 'dd MMM HH:mm') + ' IST' : 'never'));
  lines.push('ℹ️ Emails left today: ' + MailApp.getRemainingDailyQuota());

  console.log(lines.join('\n'));
  return lines.join('\n');
}

/* ================= one-time setup: run this from the editor ================= */

function setup() {
  if (ss_().getSpreadsheetTimeZone() !== 'Asia/Kolkata') switchSheetToIST_();
  const first = ss_().getSheets()[0];
  if (!ss_().getSheetByName(LEADS_SHEET) && first.getRange('A1').getValue() === LEAD_HEADERS[0]) {
    first.setName(LEADS_SHEET).setFrozenRows(1);
  }
  sheet_(LEADS_SHEET, LEAD_HEADERS);
  sheet_(PAYMENTS_SHEET, PAYMENT_HEADERS);
  ensureSettings_();

  // One 5-minute timer that checks payments and sends due messages (kept if it already exists).
  const triggers = ScriptApp.getProjectTriggers();
  triggers.filter(t => t.getHandlerFunction() === 'checkRecentPayments').forEach(t => ScriptApp.deleteTrigger(t));
  if (!triggers.some(t => t.getHandlerFunction() === 'tick')) {
    ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create();
  }

  const notes = [];
  if (hasKeys_()) { razorpay_('/v1/payments?count=1'); notes.push('Razorpay keys OK'); }
  else notes.push('NO Razorpay keys — payments cannot be confirmed, nothing will be recorded');
  notes.push(waConfigured_() ? 'WhatsApp ON' : 'WhatsApp off (add WA_TOKEN + WA_PHONE_NUMBER_ID)');
  console.log('Setup done: tabs ready, 5-minute timer installed, ' + notes.join(', ') + '.');
  MailApp.sendEmail(OWNER_EMAIL, 'SNTG sheet connected ✅',
    'Your workshop sheet is connected (' + notes.join(', ') + '): ' + ss_().getUrl());
}
