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
