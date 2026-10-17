# 📧 Email relay (plain language)

## What it does
- When the main laptop's Claude asks a question and **nobody answers within 3 minutes**, the question is emailed to the team
- **Reply to the email** and your reply becomes the answer (first answer wins — keyboard or email)
- Every command also works by email

## Commands by email
| Email subject | What happens |
|---|---|
| `[MUSIC] checkin` | You get your task menu; reply with the number you want → your brief arrives |
| `[MUSIC] handback` | You get the update-file questions; reply with your answers |
| `[MUSIC] explain 5.3` | You get the explanation |
| `[MUSIC] ask <question>` | Question for the main laptop |
| `[MUSIC] <anything else>` | Delivered to Claude as a normal message |

## Safety
- Only the three team addresses are accepted (kept in a private file on the main laptop — **not** in this repo)
- Replies must pass Gmail's sender checks **and** include the one-time code from the original email
- A small script (not Claude) reads only matching emails; Claude never sees the rest of the inbox
- Overrides by email need a second reply: `CONFIRM <code>`
- Email can't unlock forbidden actions (sharing keys, deleting work)
- Limited number of emails per hour, so a stuck loop can't flood inboxes
- The Gmail app password lives only on the main laptop and should be revoked after the hackathon

## Setup (Sadie, once, about 5 minutes)
The relay sends from Sadie's Gmail using an **app password** (a separate 16-letter password just for this). It lives only in a private file that is never committed and that Claude can't read.
1. Google Account → Security → make sure **2-Step Verification** is on → search for **App passwords** → create one named "swamphacks relay" → copy the 16 letters
2. In the project folder (PowerShell): `Copy-Item relay.private.example.json relay.private.json`
3. Open `relay.private.json` in **Notepad** and fill it in yourself: `gmail_address`, `app_password`, and `allowed_addresses` (the team's addresses; Lalitha's is not included). Save. Never paste the password into chat, email, or any other file
4. Check it works: `node scripts/ask-human.mjs send-test` (the allowed addresses get a test email)
5. The main laptop's Claude starts the always-on part: `node scripts/relay/daemon.mjs` (in the background)
6. **After the hackathon**: delete the app password in your Google account (step 1's page) so it stops working

## How the main laptop uses it
- `node scripts/ask-human.mjs ask "question"` while also asking in the chat. A keyboard answer is recorded with `answer <id> "text"`. If nobody answers in 3 minutes the daemon emails the question with a code; the first reply wins, later replies are told "already answered"
- When Claude is waiting for a person (a notification, or a final message that asks a question) and nobody types for 3 minutes, a heads-up is emailed
- Email commands (`[MUSIC] checkin` ...) are filed; Claude reads them with `node scripts/ask-human.mjs inbox --take`
- Overrides by email: `confirm-request "what"` emails a code; only a reply of exactly `CONFIRM <code>` from an allowed, verified address counts
- At most 10 emails an hour. Only unread mail whose subject has `[MUSIC]` is ever downloaded
