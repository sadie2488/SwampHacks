// Pure helpers for the email relay: config, one-time codes, who may write to us, and what an email means.
// Nothing here touches the network. Nothing here ever prints the app password.
import { randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

export const TAG = '[MUSIC]';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I so codes survive being read aloud

export function makeCode(length = 6, rnd = randomInt) {
  return Array.from({ length }, () => ALPHABET[rnd(ALPHABET.length)]).join('');
}

/** "Pat <Pat@Example.com>" -> "pat@example.com" */
export function normalizeAddress(value) {
  const s = String(value ?? '');
  const angle = s.match(/<([^>]+)>/);
  return (angle ? angle[1] : s).trim().toLowerCase();
}

/** Reads relay.private.json. Error messages name the missing field but never repeat any secret. */
export function loadConfig(file) {
  if (!existsSync(file)) {
    throw new Error('The email relay is not set up: relay.private.json does not exist. Copy relay.private.example.json to relay.private.json and fill it in yourself (see docs/email-relay.md).');
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error('relay.private.json is not valid JSON. Compare it with relay.private.example.json (commas and quotes).');
  }
  const problems = [];
  const gmail = normalizeAddress(raw.gmail_address);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(gmail)) problems.push('gmail_address');
  const appPassword = String(raw.app_password ?? '').replace(/\s+/g, '');
  if (appPassword.length !== 16) problems.push('app_password (the 16-letter app password from your Google account)');
  const allowed = (Array.isArray(raw.allowed_addresses) ? raw.allowed_addresses : []).map(normalizeAddress).filter(Boolean);
  if (!allowed.length) problems.push('allowed_addresses (at least one email address)');
  if (problems.length) throw new Error(`relay.private.json needs: ${problems.join('; ')}`);
  const sendTo = (Array.isArray(raw.send_to) && raw.send_to.length ? raw.send_to : allowed).map(normalizeAddress);
  return {
    gmailAddress: gmail,
    appPassword,
    allowed,
    sendTo,
    maxPerHour: Number(raw.max_emails_per_hour) > 0 ? Number(raw.max_emails_per_hour) : 10,
    waitMinutes: Number(raw.ask_wait_minutes) > 0 ? Number(raw.ask_wait_minutes) : 3,
  };
}

export const isAllowedSender = (from, allowed) => allowed.includes(normalizeAddress(from));

/**
 * Trusts only Gmail's own verdict (the Authentication-Results header added by mx.google.com, the top one),
 * and only when the DKIM signature that passed belongs to the sender's own domain. A forged header added
 * by a sender sits lower and starts with a different server name, so it is ignored.
 */
export function isAuthentic(authResults, fromAddress) {
  const first = Array.isArray(authResults) ? authResults[0] : authResults;
  const h = String(first ?? '').toLowerCase().trim();
  if (!h.startsWith('mx.google.com')) return false;
  if (!/dkim=pass/.test(h) || !(/dmarc=pass/.test(h) || /spf=pass/.test(h))) return false;
  const domain = normalizeAddress(fromAddress).split('@')[1];
  if (!domain) return false;
  const esc = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`dkim=pass[^;]*header\\.(?:d|i)=@?(?:[\\w-]+\\.)*${esc}(?![\\w.-])`).test(h);
}

/** The part of a reply the person actually typed: drops quoted history and signatures. */
export function stripReply(text) {
  const out = [];
  for (const line of String(text ?? '').replace(/\r/g, '').split('\n')) {
    if (/^\s*>/.test(line)) break;
    if (/^\s*On .{3,200}wrote:\s*$/i.test(line)) break;
    if (/^\s*-{2,}\s*(Original Message|Forwarded message)/i.test(line)) break;
    if (/^\s*From:\s.+@/i.test(line)) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

export function parseSubject(subject) {
  const s = String(subject ?? '').replace(/^\s*((re|fwd?)\s*:\s*)+/i, '').trim();
  const i = s.indexOf(TAG);
  if (i === -1) return null;
  const rest = s.slice(i + TAG.length).trim();
  const [word = '', ...args] = rest.split(/\s+/);
  return { command: word.toLowerCase(), args: args.join(' ') };
}

/**
 * What does one incoming email mean?
 * mail: { from, subject, text, authResults }   open: [{ id, code }] questions still waiting for an answer
 * Returns { kind: 'ignore'|'answer'|'confirm'|'command', ... }.
 */
export function classifyInbound(mail, config, open = []) {
  const from = normalizeAddress(mail.from);
  if (!isAllowedSender(from, config.allowed)) return { kind: 'ignore', reason: 'sender is not on the allowed list' };
  if (!isAuthentic(mail.authResults, from)) return { kind: 'ignore', reason: 'could not verify the sender (Gmail did not confirm it)' };
  const typed = stripReply(mail.text);
  const haystack = `${mail.subject ?? ''}\n${typed}`.toUpperCase();

  const confirm = typed.match(/\bCONFIRM\s+([A-Z0-9]{6})\b/i);
  if (confirm) return { kind: 'confirm', from, code: confirm[1].toUpperCase() };

  const hit = open.find((q) => haystack.includes(q.code));
  if (hit) {
    const answer = typed.replace(new RegExp(hit.code, 'gi'), '').replace(/\s+$/g, '').trim();
    if (!answer) return { kind: 'ignore', reason: 'the reply had no answer in it' };
    return { kind: 'answer', from, questionId: hit.id, answer };
  }

  const cmd = parseSubject(mail.subject);
  if (!cmd) return { kind: 'ignore', reason: `no ${TAG} tag and no question code` };
  const known = ['checkin', 'handback', 'explain', 'ask'];
  if (known.includes(cmd.command)) return { kind: 'command', from, command: cmd.command, args: [cmd.args, typed].filter(Boolean).join('\n') };
  return { kind: 'command', from, command: 'message', args: [`${cmd.command} ${cmd.args}`.trim(), typed].filter(Boolean).join('\n') };
}
