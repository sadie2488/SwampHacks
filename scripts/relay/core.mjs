// The email relay's brain. Everything that touches the network goes through two small interfaces,
// so the tests use fakes and the real Gmail wrapper (transport.mjs) stays thin:
//   transport.send({ to: [addresses], subject, text })        -> sends one email
//   mailbox.fetchNew()                                         -> [{ uid, from, subject, text, authResults }] unread [MUSIC] mail only
//   mailbox.markSeen(uid)
// State lives in `store` (scratch/relay). The daemon calls tick() every few seconds.
import { TAG, classifyInbound, makeCode } from './lib.mjs';

const HOUR = 3_600_000;

export function createRelay({ config, store, transport, mailbox, now = () => Date.now(), log = () => {}, code = makeCode }) {
  const questions = () => store.read('questions', {});
  const saveQuestions = (q) => store.write('questions', q);

  // ---------- outgoing mail, with a hard limit per hour so a stuck loop can't flood inboxes ----------
  async function sendMail({ subject, text, to = config.sendTo }) {
    const t = now();
    const recent = store.read('rate', []).filter((x) => t - x < HOUR);
    if (recent.length >= config.maxPerHour) {
      log(`holding an email: ${recent.length} already sent in the last hour (limit ${config.maxPerHour})`);
      return { sent: false, reason: 'rate-limit' };
    }
    await transport.send({ to, subject, text });
    store.write('rate', [...recent, t]);
    return { sent: true };
  }

  // ---------- questions: keyboard first, email after the wait, first answer wins ----------
  function ask(question, { kind = 'question' } = {}) {
    const qs = questions();
    let id;
    do id = `Q${code(4)}`;
    while (qs[id]);
    const c = code(6);
    qs[id] = { id, code: c, question, kind, createdAt: now(), state: 'waiting' };
    saveQuestions(qs);
    return { id, code: c };
  }

  /** Record an answer. Only the first one counts; later ones learn who answered first. */
  function recordAnswer(id, answer, by, via) {
    const qs = questions();
    const q = qs[id];
    if (!q || q.kind !== 'question') return { ok: false, reason: 'unknown question' };
    if (q.state === 'answered') return { ok: false, reason: 'already answered', existing: { answer: q.answer, by: q.answeredBy, via: q.answeredVia } };
    Object.assign(q, { state: 'answered', answer, answeredBy: by, answeredVia: via, answeredAt: now() });
    saveQuestions(qs);
    return { ok: true };
  }

  const status = (id) => questions()[id] ?? null;

  async function processTimers() {
    const qs = questions();
    const humanAt = store.read('human', { t: 0 }).t ?? 0;
    let changed = false;
    for (const q of Object.values(qs)) {
      // alerts (like a budget warning) go out on the next check; questions and heads-ups wait for a person first
      const wait = q.kind === 'alert' ? 0 : config.waitMinutes * 60_000;
      if (q.state !== 'waiting' || now() - q.createdAt < wait) continue;
      if (q.kind === 'notify' && humanAt > q.createdAt) {
        q.state = 'dismissed'; // a person was at the keyboard after the notification, no email needed
        changed = true;
        continue;
      }
      const isQuestion = q.kind === 'question';
      const isAlert = q.kind === 'alert';
      const r = await sendMail({
        subject: isQuestion ? `${TAG} Question ${q.id} [code ${q.code}]` : isAlert ? `${TAG} ALERT ${q.id}` : `${TAG} Heads-up ${q.id}`,
        text: isAlert
          ? `${q.question}\n\nThis is an automatic alert from the main laptop. No reply is needed.\n`
          : isQuestion
          ? `The main laptop's Claude asked:\n\n${q.question}\n\nNobody answered at the keyboard within ${config.waitMinutes} minutes.\nReply to this email with your answer. The code ${q.code} in the subject links your reply to this question. First answer wins.\n`
          : `The main laptop's Claude is waiting for a person:\n\n${q.question}\n\nNo reply is needed unless you want to tell it something (start your subject with ${TAG}).\n`,
      });
      if (!r.sent) break; // rate limited: try again next tick, nothing is lost
      q.state = isQuestion ? 'emailed' : isAlert ? 'alerted' : 'notified';
      q.emailedAt = now();
      changed = true;
      log(`emailed ${isQuestion ? 'question' : 'heads-up'} ${q.id}`);
    }
    if (changed) saveQuestions(qs);
  }

  // ---------- confirmations (overrides by email need "CONFIRM <code>") ----------
  async function requestConfirmation(what) {
    const c = code(6);
    const all = store.read('confirmations', {});
    all[c] = { code: c, what, state: 'pending', createdAt: now() };
    store.write('confirmations', all);
    const r = await sendMail({ subject: `${TAG} Confirm ${c}`, text: `Please confirm:\n\n${what}\n\nTo approve, reply with exactly:  CONFIRM ${c}\nIgnore this email to say no.\n` });
    return { code: c, emailed: r.sent };
  }
  const confirmStatus = (c) => store.read('confirmations', {})[String(c).toUpperCase()] ?? null;

  // ---------- incoming mail ----------
  async function pollInbox() {
    const mails = await mailbox.fetchNew();
    let n = 0;
    for (const mail of mails) {
      try {
        const known = Object.values(questions()).filter((q) => q.kind === 'question').map((q) => ({ id: q.id, code: q.code }));
        const c = classifyInbound(mail, config, known);
        if (c.kind === 'ignore') {
          log(`ignored an email: ${c.reason}`);
        } else if (c.kind === 'answer') {
          const r = recordAnswer(c.questionId, c.answer, c.from, 'email');
          if (r.ok) log(`answer to ${c.questionId} arrived by email from ${c.from}`);
          else if (r.reason === 'already answered') {
            const qs = questions();
            const q = qs[c.questionId];
            q.late = [...new Set([...(q.late ?? []), c.from])];
            if ((q.late ?? []).length && !q.lateNotified?.includes(c.from)) {
              await sendMail({ to: [c.from], subject: `${TAG} Re: Question ${q.id}: already answered`, text: `Thanks, but this question was already answered by ${r.existing.by} (${r.existing.via}). Your reply was not used.\n` });
              q.lateNotified = [...(q.lateNotified ?? []), c.from];
            }
            saveQuestions(qs);
          }
        } else if (c.kind === 'confirm') {
          const all = store.read('confirmations', {});
          if (all[c.code]?.state === 'pending') {
            Object.assign(all[c.code], { state: 'confirmed', confirmedBy: c.from, confirmedAt: now() });
            store.write('confirmations', all);
            log(`confirmation ${c.code} approved by ${c.from}`);
          }
        } else if (c.kind === 'command') {
          const id = `${now()}-${n++}`;
          store.write(`inbox/${id}`, { id, from: c.from, command: c.command, args: c.args, receivedAt: now() });
          log(`email command "${c.command}" from ${c.from}`);
        }
      } catch (e) {
        log(`could not process one email: ${e.message}`);
      } finally {
        await mailbox.markSeen(mail.uid).catch(() => {});
      }
    }
    return mails.length;
  }

  // ---------- commands that arrived by email, for the lead to act on ----------
  const inbox = () => store.list('inbox').map((k) => store.read(k));
  function takeInbox() {
    const keys = store.list('inbox');
    const items = keys.map((k) => store.read(k));
    for (const k of keys) store.remove(k);
    return items;
  }

  return {
    ask,
    notify: (message) => ask(message, { kind: 'notify' }),
    /** An urgent automatic email (e.g. a budget warning): sent on the next check, no waiting for a person. */
    alert: (message) => ask(message, { kind: 'alert' }),
    recordAnswer,
    status,
    requestConfirmation,
    confirmStatus,
    humanActive: () => store.write('human', { t: now() }),
    inbox,
    takeInbox,
    processTimers,
    pollInbox,
    sendMail,
    async tick() {
      await processTimers();
      const got = await pollInbox();
      store.write('daemon', { t: now(), pid: process.pid });
      return got;
    },
  };
}
