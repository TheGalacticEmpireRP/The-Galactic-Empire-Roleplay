// Deploy from the dedicated TGE Gmail account. Keep the shared secret in
// Project Settings > Script properties, never in this source file.
function authorizeSender() {
  var properties = PropertiesService.getScriptProperties();
  var expected = String(properties.getProperty('TGE_SENDER_EMAIL') || '').trim().toLowerCase();
  var actual = Session.getEffectiveUser().getEmail().trim().toLowerCase();
  if (!expected || actual !== expected) throw new Error('Use the Gmail account configured as TGE_SENDER_EMAIL.');
  if (!/^[a-f0-9]{64}$/.test(properties.getProperty('TGE_EMAIL_SECRET') || '')) throw new Error('Set TGE_EMAIL_SECRET to a new random 64-character hexadecimal value.');
  return {sender: actual, remainingRecipients: MailApp.getRemainingDailyQuota()};
}

function doGet() {
  return jsonReply_({service: 'tge-gmail-sender', version: 1});
}

function doPost(event) {
  var lock = null;
  try {
    var body = event && event.postData && event.postData.contents;
    if (typeof body !== 'string' || body.length > 40000) return jsonReply_({ok: false, error: 'invalid_request'});
    var envelope = JSON.parse(body);
    if (typeof envelope.payload !== 'string' || envelope.payload.length > 32000 || !/^[a-f0-9]{64}$/.test(envelope.signature || '')) return jsonReply_({ok: false, error: 'invalid_request'});
    var properties = PropertiesService.getScriptProperties();
    var secret = properties.getProperty('TGE_EMAIL_SECRET') || '';
    if (!/^[a-f0-9]{64}$/.test(secret)) return jsonReply_({ok: false, error: 'not_configured'});
    var signature = hex_(Utilities.computeHmacSha256Signature(envelope.payload, secret, Utilities.Charset.UTF_8));
    if (!equal_(signature, envelope.signature)) return jsonReply_({ok: false, error: 'unauthorized'});
    var message = JSON.parse(envelope.payload);
    if (message.version !== 1 || !Number.isFinite(message.sentAt) || Math.abs(Date.now() - message.sentAt) > 300000) return jsonReply_({ok: false, error: 'expired_request'});
    if (typeof message.idempotencyKey !== 'string' || !/^tge-(verify|reply)\/[a-zA-Z0-9_/-]{10,240}$/.test(message.idempotencyKey)) return jsonReply_({ok: false, error: 'invalid_id'});
    if (typeof message.to !== 'string' || message.to.length > 254 || !/^[^\s@<>,;:\r\n]+@[^\s@<>,;:\r\n]+\.[^\s@<>,;:\r\n]+$/.test(message.to)) return jsonReply_({ok: false, error: 'invalid_recipient'});
    if (typeof message.subject !== 'string' || message.subject.length > 200 || /[\r\n]/.test(message.subject) || !/^(Confirm TGE ticket email alerts|Support staff replied) — TGE-\d{4}-[A-F0-9]{8}$/.test(message.subject)) return jsonReply_({ok: false, error: 'invalid_subject'});
    if (typeof message.text !== 'string' || message.text.length > 12000 || typeof message.html !== 'string' || message.html.length > 16000) return jsonReply_({ok: false, error: 'invalid_content'});
    var expected = String(properties.getProperty('TGE_SENDER_EMAIL') || '').trim().toLowerCase();
    if (!expected || message.sender !== expected || Session.getEffectiveUser().getEmail().trim().toLowerCase() !== expected) return jsonReply_({ok: false, error: 'wrong_sender_account'});
    lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) return jsonReply_({ok: false, error: 'busy'});
    var id = 'gmail-' + hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, message.idempotencyKey, Utilities.Charset.UTF_8));
    var storageKey = 'mail_' + id;
    var stored = properties.getProperty(storageKey);
    if (stored) {
      var previous = JSON.parse(stored);
      return jsonReply_(previous.status === 'sent' ? {ok: true, id: id} : {ok: false, error: 'delivery_unknown'});
    }
    // Quota rejection occurs before reserving the id, so it can be retried.
    if (MailApp.getRemainingDailyQuota() < 1) return jsonReply_({ok: false, error: 'daily_limit'});
    cleanReceipts_(properties);
    properties.setProperty(storageKey, JSON.stringify({status: 'sending', at: Date.now()}));
    try {
      MailApp.sendEmail({to: message.to, subject: message.subject, body: message.text, htmlBody: message.html, name: 'TGE Support'});
      properties.setProperty(storageKey, JSON.stringify({status: 'sent', at: Date.now()}));
      return jsonReply_({ok: true, id: id});
    } catch (sendError) {
      // Google does not provide an idempotent send API here. Preserve an
      // uncertain receipt instead of risking a duplicate after an interruption.
      return jsonReply_({ok: false, error: 'delivery_unknown'});
    }
  } catch (error) {
    return jsonReply_({ok: false, error: 'invalid_request'});
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function cleanReceipts_(properties) {
  var all = properties.getProperties();
  Object.keys(all).forEach(function(key) {
    if (key.indexOf('mail_') !== 0) return;
    try { if (JSON.parse(all[key]).at < Date.now() - 25 * 3600000) properties.deleteProperty(key); } catch (error) { /* Keep uncertain records. */ }
  });
}
function hex_(bytes) { return bytes.map(function(n) { return ('0' + (n & 255).toString(16)).slice(-2); }).join(''); }
function equal_(a, b) { if (a.length !== b.length) return false; var diff = 0; for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
function jsonReply_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
