/**
 * SNTG ₹199 workshop — Google Sheet + payment checks + buyer messaging.
 *
 * Paste this into the Apps Script editor (Sheet → Extensions → Apps Script, or
 * script.google.com). Steps: SETUP-PAYMENTS.md
 *
 * Tabs it manages in the "SNTG Workshop Registrations" sheet:
 *  - Leads     every landing-page form submit (name, WhatsApp, email, business)
 *  - Payments  every ₹199 payment + when each message was sent to that buyer
 *  - Settings  workshop date, live link, community link, feedback link, ON/OFF switch
 *
 * Messages to each paid buyer (email always; WhatsApp once Meta Cloud API is set up):
 *  1. Welcome     as soon as the payment is verified
 *  2. Reminder    the evening before (16 h before start)
 *  3. Live link   1 hour before start  (needs "Live link" filled in Settings)
 *  4. Thank-you   30 min after the 3-hour workshop ends
 * A timer runs every 5 minutes and sends whatever is due. Each send is stamped in the
 * buyer's row; clear that cell to send that message again.
 *
 * Script properties (Project Settings → Script properties) — secrets never go in this file:
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET      verify payments with Razorpay (recommended)
 *   WA_TOKEN, WA_PHONE_NUMBER_ID              Meta WhatsApp Cloud API (turns WhatsApp on)
 *   WA_TEMPLATE_LANG                          optional, template language code (default "en")
 */

// The "SNTG Workshop Registrations" sheet in subns24@gmail.com's Google Drive.
const SHEET_ID = '1CpZI9srdFq_H44pJv5SK3QQb0XymaVMFGnKNnRvvlUg';

const OWNER_EMAIL   = 'subns24@gmail.com';
const AMOUNT_PAISE  = 19900;   // ₹199 — only payments of exactly this amount are recorded
const WORKSHOP_NAME = 'SNTG Live AI Workshop (Telugu)';
const SENDER_NAME   = 'SNTG AI Workshop';
const WORKSHOP_HOURS = 3;

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
  date:      ['Workshop date & time (IST, yyyy-mm-dd hh:mm)', '2026-11-14 11:00'],
  live:      ['Live link (Zoom / Meet)', ''],
  community: ['WhatsApp community link', 'https://chat.whatsapp.com/KUMcVB1BMy64Pvjbu79zj0'],
  feedback:  ['Feedback / bonus link', ''],
  ownerWa:   ['Your WhatsApp number (for test messages)', ''],
  enabled:   ['Send messages to buyers (ON / OFF)', 'ON']
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
    else if (data.type === 'paid') recordPayment_(String(data.payment_id || ''), null, 'success page', data);
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
      .addToUi();
  } catch (err) { /* not opened from the sheet */ }
}

/** Runs every 5 minutes (installed by setup()). */
function tick() {
  try { checkRecentPayments(); } catch (err) { console.error(err); }
  runMessages();
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
  const from = Math.floor(Date.now() / 1000) - 2 * 60 * 60;
  const res = razorpay_('/v1/payments?count=100&from=' + from);
  (res.items || []).forEach(p => recordPayment_(p.id, p, 'auto-check', null));
}

/**
 * Records one payment if Razorpay confirms it is captured and for ₹199.
 * Without API keys, success-page payments are saved as UNVERIFIED and get no buyer
 * messages until you type VERIFIED in their Status cell.
 */
function recordPayment_(paymentId, payment, via, hint) {
  if (!/^pay_[A-Za-z0-9]{6,30}$/.test(paymentId)) return;

  let recorded = false;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_(PAYMENTS_SHEET, PAYMENT_HEADERS);
    if (alreadyRecorded_(sh, paymentId)) return;

    let p = payment;
    if (!p && !hasKeys_()) {
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
  const start = parseIST_(s.date);
  if (!start) { console.error('Workshop date in Settings is not readable: ' + s.date); return; }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = sheet_(PAYMENTS_SHEET, PAYMENT_HEADERS);
    const last = sh.getLastRow();
    if (last < 2) return;
    const rows = sh.getRange(2, 1, last - 1, PAYMENT_HEADERS.length).getValues();
    const now = Date.now();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const status = String(r[COL.status - 1]).trim().toLowerCase();
      if (status !== 'captured' && status !== 'verified') continue;
      const buyer = { name: String(r[COL.name - 1] || ''), email: String(r[COL.email - 1] || ''),
                      phone: String(r[COL.phone - 1] || '') };

      for (const st of STAGES) {
        if (r[st.col - 1] !== '' || !st.due(now, start.getTime())) continue;
        if (st.key === 'live' && !s.live) { alertMissingLiveLink_(); continue; }
        if (MailApp.getRemainingDailyQuota() < 1) { console.error('Daily email quota used up; will retry.'); return; }
        const result = sendStage_(st.key, buyer, s, start);
        sh.getRange(i + 2, st.col).setValue(result);
        r[st.col - 1] = result;
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
      MailApp.sendEmail({ to: buyer.email, name: SENDER_NAME, replyTo: OWNER_EMAIL,
                          subject: m.subject, htmlBody: emailLayout_(m.html) });
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
  const first = (b.name || '').split(' ')[0] || 'there';
  const hi = '<p>నమస్కారం ' + escape_(b.name || '') + ' 🙏</p>';
  const when = Utilities.formatDate(start, 'Asia/Kolkata', "EEEE, d MMMM yyyy 'at' h:mm a") + ' IST';
  const time = Utilities.formatDate(start, 'Asia/Kolkata', 'h:mm a') + ' IST';
  const button = (url, label, color) => '<p style="margin:22px 0"><a href="' + escape_(url) +
    '" style="background:' + color + ';color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;display:inline-block">' +
    label + '</a></p>';

  switch (key) {
    case 'welcome': return {
      subject: '🎉 Your registration is confirmed — ' + WORKSHOP_NAME,
      html: hi + '<p><b>Congratulations on taking your first steps!</b> Your registration is confirmed. ' +
            'Get ready for your transformation 🚀</p>' +
            '<p>📅 <b>' + escape_(when) + '</b><br>📱 Your phone is enough — no laptop needed.</p>' +
            '<p>Join our WhatsApp community for live updates:</p>' +
            button(s.community, 'Join the WhatsApp Community', '#25D366') +
            '<p>We will send the live link 1 hour before the workshop.</p>',
      waTemplate: 'sntg_welcome', waParams: [first, when, s.community]
    };
    case 'reminder': return {
      subject: '⏰ Tomorrow: ' + WORKSHOP_NAME,
      html: hi + '<p>A quick reminder — your workshop is <b>tomorrow</b>.</p>' +
            '<p>📅 <b>' + escape_(when) + '</b></p>' +
            '<p>Keep your phone charged and your internet on. The live link comes 1 hour before we start.</p>' +
            button(s.community, 'Open the WhatsApp Community', '#25D366'),
      waTemplate: 'sntg_reminder', waParams: [first, when]
    };
    case 'live': return {
      subject: '🔴 Starting at ' + time + ' — your live link',
      html: hi + '<p>The workshop starts at <b>' + escape_(time) + '</b>. Join a few minutes early:</p>' +
            button(s.live, 'Join the live workshop', '#004AAD') +
            '<p style="color:#47576B">Link: ' + escape_(s.live) + '</p>',
      waTemplate: 'sntg_live_link', waParams: [first, time, s.live]
    };
    case 'thanks': return {
      subject: '🙏 Thank you for joining — ' + WORKSHOP_NAME,
      html: hi + '<p>Thank you for attending! We hope you are already using AI in your business.</p>' +
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
  const start = parseIST_(s.date) || new Date(Date.now() + 24 * HOUR);
  const me = { name: 'Test', email: OWNER_EMAIL, phone: String(s.ownerWa || '') };
  const sTest = Object.assign({}, s, { live: s.live || 'https://meet.google.com/test-link' });
  const out = STAGES.map(st => st.key + ': ' + sendStage_(st.key, me, sTest, start));
  console.log(out.join('\n'));
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
  const unverified = p.status === 'UNVERIFIED';
  MailApp.sendEmail({
    to: OWNER_EMAIL,
    subject: (unverified ? '⚠️ ₹199 payment to verify — ' : '✅ New ₹199 workshop payment — ') +
             (name || email || phone || p.id),
    htmlBody: (unverified
                ? '<p><b>Check this payment ID in the Razorpay dashboard.</b> If it is real, type <b>VERIFIED</b> ' +
                  'in its Status cell (column H) and the buyer\'s welcome message goes out within 5 minutes.</p>'
                : '<p>A new seat was paid for the ' + WORKSHOP_NAME + '. The buyer\'s welcome message is on its way.</p>') +
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
    out[k] = (v instanceof Date) ? v : String(v == null ? '' : v).trim();
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

/** Accepts a Date or "yyyy-mm-dd hh:mm" (read as India time). */
function parseIST_(v) {
  if (v instanceof Date) return v;
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

/* ================= one-time setup: run this from the editor ================= */

function setup() {
  const first = ss_().getSheets()[0];
  if (!ss_().getSheetByName(LEADS_SHEET) && first.getRange('A1').getValue() === LEAD_HEADERS[0]) {
    first.setName(LEADS_SHEET).setFrozenRows(1);
  }
  sheet_(LEADS_SHEET, LEAD_HEADERS);
  sheet_(PAYMENTS_SHEET, PAYMENT_HEADERS);
  ensureSettings_();

  // One 5-minute timer that checks payments and sends due messages.
  ScriptApp.getProjectTriggers()
    .filter(t => ['checkRecentPayments', 'tick'].indexOf(t.getHandlerFunction()) !== -1)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create();

  const notes = [];
  if (hasKeys_()) { razorpay_('/v1/payments?count=1'); notes.push('Razorpay keys OK'); }
  else notes.push('no Razorpay keys (payments saved as UNVERIFIED)');
  notes.push(waConfigured_() ? 'WhatsApp ON' : 'WhatsApp off (add WA_TOKEN + WA_PHONE_NUMBER_ID)');
  console.log('Setup done: tabs ready, 5-minute timer installed, ' + notes.join(', ') + '.');
  MailApp.sendEmail(OWNER_EMAIL, 'SNTG sheet connected ✅',
    'Your workshop sheet is connected (' + notes.join(', ') + '): ' + ss_().getUrl());
}
