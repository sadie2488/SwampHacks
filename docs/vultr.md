# 💳 Vultr: budget rules and cleanup

Vultr gives us a **$100 credit, and a real payment card is linked to the account**. We must not go over it. These rules were set by Sadie and apply to every Claude and every person on the project.

## The rules
- **Never create, resize, or delete any Vultr resource** (servers, storage, snapshots, IPs, anything) **without a human's explicit yes plus a cost estimate** (what it costs per hour and per month, and how long it will run)
- **GPU instances are banned** unless a human explicitly approves
- Using the storage bucket we already have (`swamphacks-data`) for datasets, models and test clips is fine. Creating *another* one is not
- Reading is always fine: balance, lists of what exists
- Keys never go in chat or in files. The Vultr API key lives only in `server/.env` and is restricted to the main laptop's IP

How it is enforced: a hook blocks commands that create, change or delete Vultr resources unless a person says "override" (`bash-guard` rule `vultr-spend`), and a watcher checks the balance.

## The budget watcher (main laptop)
`node scripts/vultr-budget.mjs --watch` checks the balance every 30 minutes (`--once` checks one time, `--list` shows what is running, read-only).

| Spent | What happens |
|---|---|
| **$50** | Email to the team (terminal alert if the email relay isn't running): "halfway" |
| **$75** | Email: **stop all new Vultr usage now.** Nothing new gets created |
| **$90** | Email: list everything running and what can be shut down. A human shuts it down |

"Spent" = $100 + the account balance (a negative balance means credit left) + pending charges. Check this once against the Vultr dashboard (assumption 18 in `docs/assumptions.md`). The watcher only needs `VULTR_API_KEY` in `server/.env`; Claude never reads or prints it.

## After we submit (Sunday): delete everything
Storage bills monthly until it is deleted. In the Vultr dashboard (or ask the main laptop to list what exists with `node scripts/vultr-budget.mjs --list`), delete, in this order:
1. ☐ Compute instances (servers)
2. ☐ Block storage volumes
3. ☐ Object Storage: empty the bucket `swamphacks-data`, then delete the bucket and the Object Storage subscription `swamphacks`
4. ☐ Snapshots and backups
5. ☐ Reserved IPs, load balancers, DNS domains, firewall groups, Kubernetes clusters (if any exist)
6. ☐ Delete the API key (Account → API) and the object storage access keys
7. ☐ Run `node scripts/vultr-budget.mjs --list` again: it should show nothing
8. ☐ Check the balance a day later to make sure charges stopped
Also delete the Gmail app password for the email relay.
