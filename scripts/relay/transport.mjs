// The only file that talks to Gmail. Thin on purpose: all decisions are made in core.mjs.
// Sends with SMTP and reads with IMAP, both using the app password from relay.private.json (never printed).
// It only downloads unread mail whose subject contains [MUSIC], so the rest of the inbox is never touched.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { TAG } from './lib.mjs';

export function makeGmail(config) {
  const auth = { user: config.gmailAddress, pass: config.appPassword };
  const smtp = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth });

  const transport = {
    async send({ to, subject, text }) {
      const info = await smtp.sendMail({ from: config.gmailAddress, to: to.join(', '), subject, text });
      return { messageId: info.messageId };
    },
  };

  async function withInbox(fn) {
    const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth, logger: false });
    await client.connect();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        return await fn(client);
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => {});
    }
  }

  const mailbox = {
    fetchNew: () =>
      withInbox(async (client) => {
        const out = [];
        const uids = (await client.search({ seen: false, subject: TAG }, { uid: true })) || [];
        for (const uid of uids) {
          const msg = await client.fetchOne(uid, { source: true }, { uid: true });
          const parsed = await simpleParser(msg.source);
          out.push({
            uid,
            from: parsed.from?.value?.[0]?.address ?? '',
            subject: parsed.subject ?? '',
            text: parsed.text ?? '',
            authResults: parsed.headers.get('authentication-results'),
          });
        }
        return out;
      }),
    markSeen: (uid) => withInbox((client) => client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })),
  };
  return { transport, mailbox };
}

/** Turns a Gmail error into a sentence a tired person can act on. */
export function explainMailError(e) {
  const m = String(e?.message ?? e);
  if (/Invalid credentials|AUTHENTICATIONFAILED|535|Username and Password not accepted/i.test(m + (e?.response ?? ''))) {
    return 'Gmail refused the login. Check the app password in relay.private.json (it must be the 16-letter app password, not the normal Gmail password) and that 2-Step Verification is on.';
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(m)) return 'Could not reach Gmail. Check the internet connection; this will retry on its own.';
  return `Gmail problem: ${m}`;
}
