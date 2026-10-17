# Putting the app on the internet (one Vultr server)

This folder holds everything needed to run the website and the server on ONE small Vultr cloud server, with a real HTTPS address. Camera and microphone only work on `https://` (or `localhost`), so a real domain and certificate are required.

**Nothing in this folder has been run against a real server yet.** Read "What is NOT tested" at the bottom before you trust it.

**The Vultr rule comes first** (`docs/vultr.md`): a human must say an explicit yes, after seeing the cost, before anything is created. No GPU. The scripts here never call Vultr. A person creates the server by hand in the Vultr dashboard.

Replace `example.com` with the real domain everywhere in this file. `setup.sh` takes the domain as `DOMAIN=...` and fills it in for you. You never edit the Caddyfile by hand.

## 1. What gets created, and why

- **One Vultr server** (Ubuntu 24.04, 2 GB memory). It runs everything.
- **One Vultr firewall group** (free) that lets in only ports 22 (login), 80 and 443 (website).
- **One DNS record at GoDaddy** (an `A` record) so `example.com` points at the server.
- **On the server**, `setup.sh` installs and starts:
  - **Caddy**: the front door. It gets and renews the HTTPS certificate by itself, serves the website files, and passes `/api/...` to the Python server.
  - **The Python server** (`swamphacks-server` service): song upload, analysis, login settings, saving. It only listens on the server itself (`127.0.0.1:8000`), never on the internet directly. It restarts by itself if it crashes or the server reboots.
  - A private user called `swamphacks` that runs the server with no other powers.
- **Not on this server:**
  - **Tiger Data database**: it lives outside, nothing to install. The server connects with `DATABASE_URL`.
  - **TouchDesigner relay** (`bridge/`): it stays on the performer's laptop.
  - **Vultr object storage** (`swamphacks-data`): already exists, the server does not use it today.

## 2. Cost estimate (get a human yes before creating anything)

**I cannot look up live Vultr prices from where I work. These numbers are my best estimate from memory and may be out of date. Before saying yes, open the Vultr "Deploy" page, pick the plan, and read the price it shows on the right. If it is clearly more than the numbers below (for example more than $15 per month for the 2 GB plan), stop and ask the lead.**

**Which plan, and why 2 GB:** Song analysis (the librosa/numba tools that find tempo, key and melody) needs roughly 2 GB of memory for a long song. Building the website also uses a lot of memory. A 1 GB server would run out of memory and crash. So the smallest sensible plan is:

- **Cloud Compute, Regular Performance, 1 vCPU, 2 GB memory, about 55 GB disk.** Estimated **$10 per month, about $0.015 per hour.** (Vultr charges by the hour and stops charging at the monthly price.)
- `setup.sh` also adds a 2 GB swap file (spare memory on disk) so a build or a long song slows down instead of freezing the server.

| How long it runs | Hours | Estimated cost (2 GB plan, ~$0.015/hour) | Share of the $100 credit |
|---|---|---|---|
| 3 days (create before the demo, delete after the Sunday submission) | 72 | about $1.10 | about 1% |
| One week | 168 | about $2.50 | about 3% |
| Forgotten for a whole month | 720 | about $10 (capped at the monthly price) | about 10% |

- Plan on **3 to 4 days**: create it before the demo, delete it right after the Sunday submission. Expected total: **about $1 to $2** of the $100.
- Cost of a bigger plan if the 2 GB one runs out of memory: 4 GB, 2 vCPU is about $20 per month ($0.03 per hour), so 4 days is about $3. Changing the size is a Vultr change and needs a new yes.
- The firewall group, the IPv4 address and the normal bandwidth are included or free as far as I know. **Keep "Auto Backups" OFF** (it adds roughly 20% to the price). Do not add a snapshot, block storage, a load balancer or a reserved IP.
- **Stopping a server does NOT stop the billing.** Only destroying it does (see the teardown checklist).
- The budget watcher in `docs/vultr.md` still emails at $50, $75 and $90 spent.

## 3. What you need before you start

- [ ] A human has said "yes" to the cost above (and it is written in `docs/decisions.md` by the lead)
- [ ] You can log in to Vultr (my.vultr.com) and to GoDaddy
- [ ] You know the domain name (the real one for `example.com`)
- [ ] The newest code, including this `deploy/` folder, is on the branch the server will follow (`main`). If it is not merged yet, add `BRANCH=name-of-branch` before `bash` in step 6
- [ ] Your private key file from the main laptop (`server\.env`) is open in Notepad, so you can copy values by hand in step 7. **Never paste a key into chat**

## 4. Create the server in the Vultr dashboard

Vultr changes its screens sometimes, so the words may be slightly different.

1. **Create the firewall group first.** Left menu: **Products**, then **Network**, then **Firewall**, then **Add Firewall Group**. Name it `swamphacks`. Add three rules, all protocol **TCP**, source **0.0.0.0/0** (and the IPv6 "anywhere" if offered): port **22**, port **80**, port **443**. Nothing else. (Tip: if everyone logs in from one known address, limit port 22 to that address.)
2. **Deploy the server.** Click **Deploy +** (top right), then **Deploy New Server**.
   - **Type:** Cloud Compute (shared CPU). **Never** pick anything called GPU.
   - **CPU & storage:** Regular Performance (Intel or AMD, whichever is cheapest).
   - **Location:** Miami (or Atlanta). Any US city works.
   - **Image:** Ubuntu **24.04 LTS** x64.
   - **Plan:** the one with **2 GB** memory (about $10 per month). Read the price.
   - **Additional features:** turn **Auto Backups OFF**. Leave the others off. IPv6 on or off does not matter.
   - **SSH key:** add one if your team uses keys. Otherwise skip it and use the root password Vultr shows.
   - **Firewall group:** pick `swamphacks`.
   - **Hostname and label:** `swamphacks-app`.
   - Check the price summary on the right, then click **Deploy Now**.
3. Wait 2 to 5 minutes until the server status says **Running**. Open the server's page and write down its **IP address** and (if you did not use an SSH key) its **password**.

## 5. Point the domain at the server (GoDaddy)

1. GoDaddy: **My Products**, find the domain, click **DNS** (or **Manage DNS**).
2. If there is an existing **A** record named `@` (often a "Parked" one), **edit** it. Otherwise **Add New Record**:
   - Type **A**, Name **@**, Value **the server's IP address**, TTL the smallest allowed (600 seconds or 1/2 hour).
3. **Delete any AAAA record** for `@` unless it is this server's IPv6 address. A wrong AAAA record makes the certificate fail.
4. Optional: for `www`, add a **CNAME** record, Name `www`, Value `@`, and remove the `#` marks at the bottom of `deploy/Caddyfile` first.
5. Check from your own computer (it can take a few minutes up to an hour):
   - Windows PowerShell: `nslookup example.com`. The address in the answer must be the server's IP address.

## 6. Log in and run the setup

1. On your own computer, open **PowerShell** and type (use the real IP address):
   ```
   ssh root@SERVER_IP
   ```
   Answer `yes` to the question, then type the password (nothing shows while you type, that is normal). No SSH on your computer? Use the Vultr page for the server, **View Console** (top right), and log in as `root`.
2. On the server, get the code and run the setup. Change `example.com` to the real domain:
   ```
   apt-get update && apt-get install -y git
   git clone https://github.com/sadie2488/SwampHacks.git /opt/swamphacks/app
   DOMAIN=example.com bash /opt/swamphacks/app/deploy/setup.sh
   ```
   - The repository must be reachable without a password (public). If not, ask the lead.
   - To follow another branch: `BRANCH=name-of-branch DOMAIN=example.com bash ...`
   - It takes **5 to 10 minutes**. It prints short lines like `==> Building the website`. If it stops, the line starting `STOP:` says why. Fix that, then run the same command again. It is safe to run again.
3. At the end you should see `OK: the server is running.` and (after a minute) `OK: https://example.com answers.` If the second line is a warning, wait a minute and open the site anyway, or see "If something goes wrong".

## 7. Add the keys (by hand, never in chat)

The server runs without keys in demo mode (no saving, no coaching text), so the site already loads. To turn the real features on:

1. On the server: `nano /etc/swamphacks/server.env`
2. Type one `NAME=value` per line, no spaces around `=`, no quotes. Copy each value from `server\.env` on the main laptop (in the Windows terminal, right-click pastes).
3. Save: press **Ctrl+O**, **Enter**, then **Ctrl+X**.
4. Restart the server so it reads the file: `systemctl restart swamphacks-server`
5. Check the file is private: `ls -l /etc/swamphacks/server.env` must start with `-rw-------` and say `swamphacks swamphacks`. (Do not run `cat` on this file where others can see your screen.)

Which names to put in the file (these are the only names the server reads):

| Name | Put it on the server? | What it is for |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Coaching text |
| `DATABASE_URL` | Yes | Tiger Data connection string (the one with the password in it) |
| `AUTH0_DOMAIN` | Yes | Login (public value) |
| `AUTH0_CLIENT_ID` | Yes | Login (public value) |
| `AUTH_ENABLED` | Only if you use it locally | `true` makes the server check login tokens. Copy what your local file has |
| `AUTH0_AUDIENCE` | Only if you use it locally | Only for an Auth0 API. Usually leave out |
| `GEMINI_MODEL` | Optional | Which Gemini model. A default is built in |
| `MUSIC_DATA_DIR` | **No, do not set it** | The service already sets it to `/var/lib/swamphacks/data` (the one folder the server may write in) |
| `VULTR_S3_ENDPOINT`, `VULTR_S3_BUCKET`, `VULTR_S3_ACCESS_KEY`, `VULTR_S3_SECRET_KEY` | No (leave out) | Object storage. The server code does not use them yet, so keep these secrets off the server |
| `VULTR_API_KEY` | **Never on this server** | Only for the budget watcher on the main laptop. The server deliberately never loads it |

Example of what the file looks like (names only, fill in the values yourself):
```
GEMINI_API_KEY=
DATABASE_URL=
AUTH0_DOMAIN=
AUTH0_CLIENT_ID=
```

**Database allow-list:** if the Tiger Data service limits which addresses may connect, add the Vultr server's IP address there, or the server cannot reach the database.

## 8. Change the Auth0 settings (a human does this in the Auth0 website)

The website tells Auth0 to send people back to the site's own address, so Auth0 must know the new address. If this is skipped, login shows an error like "Callback URL mismatch".

1. Log in at manage.auth0.com. Left menu: **Applications**, then **Applications**, then open the application whose **Client ID** matches `AUTH0_CLIENT_ID`.
2. Open the **Settings** tab. Check **Application Type** is **Single Page Application**.
3. Scroll to **Application URIs**. In each box, **keep what is already there** (the `http://localhost:5173` entries keep local work running) and **add** the new address after a comma:
   - **Allowed Callback URLs:** `https://example.com`
   - **Allowed Logout URLs:** `https://example.com`
   - **Allowed Web Origins:** `https://example.com`
   - **Allowed Origins (CORS):** `https://example.com`
4. Rules: start with `https://`, no `/` at the end, no path. If you also use `www`, add `https://www.example.com` the same way.
5. Scroll to the bottom and click **Save Changes**.

## 9. Check that it works

1. Open `https://example.com/api/health` in Chrome. It must show `{"status":"ok"}` and a padlock.
2. Open `https://example.com`. The site loads. Try the demo song. Open `https://example.com/?fake=1` to try everything without a camera.
3. **Camera and microphone:** go to the Play screen, turn the camera on, and click **Allow** when Chrome asks. The first time takes a few seconds because the hand-tracking files download from the internet.
4. **Upload a song** (an MP3 under 50 MB). It should show tempo, key and sheet music.
5. **Database (only if `DATABASE_URL` is set):** open `https://example.com/api/songs`. A list means it works. A message saying saving is unavailable (error 503) means the server cannot reach Tiger Data (wrong string or the allow-list from step 7).
6. **Login:** click the login button, sign in, and come back to the site.
7. Press **F12**, open **Console**. Lines starting with `[Report Only]` are covered under "Content Security Policy" below. Send the lead the text of such lines (they contain no keys).

Useful server commands:
- `systemctl status swamphacks-server` (is the Python server running?)
- `journalctl -u swamphacks-server -n 50 --no-pager` (its last log lines)
- `journalctl -u caddy -n 40 --no-pager` (Caddy and certificate messages)

## 10. Update to a newer version

The server follows the branch chosen at setup (`main`). After the lead merges new work:
```
ssh root@SERVER_IP
bash /opt/swamphacks/app/deploy/update.sh
```
It downloads the code, rebuilds the website (a few minutes, during which the site may flicker), updates the Python parts, refreshes the Caddy and service settings if they changed, restarts, and finishes with `OK: the server answers...` or the last log lines. It never touches the key file.

## 11. Stop and roll back

- **Go back to an older version:**
  1. List versions: `runuser -u swamphacks -- git -C /opt/swamphacks/app log --oneline -10`
  2. Pick a good one and run: `bash /opt/swamphacks/app/deploy/update.sh 1a2b3c4` (the short code from the list)
  3. Later, `bash /opt/swamphacks/app/deploy/update.sh` with nothing after it goes back to the newest `main`.
- **Pause the Python server (the site files still show, saving and analysis stop):** `systemctl stop swamphacks-server`. Start again with `systemctl start swamphacks-server`.
- **Take the whole site down:** `systemctl stop caddy swamphacks-server`.
- **Bad key edit:** fix `/etc/swamphacks/server.env` with `nano`, then `systemctl restart swamphacks-server`.
- **Demo fallback:** the site on a laptop (`localhost:5173`) keeps working even if the cloud server is down.
- **Remember: stopping does not stop the billing.** Only destroying the server does.

## 12. If something goes wrong

| What you see | What to try |
|---|---|
| The site does not load or the padlock is missing | `journalctl -u caddy -n 40 --no-pager`. Usually the domain does not point at the server yet (step 5), an AAAA record is wrong, or port 80/443 is not open in the Vultr firewall group |
| "502 Bad Gateway" | The Python server is down: `journalctl -u swamphacks-server -n 50 --no-pager` |
| Song upload dies, or the log says `Killed` | Out of memory on a long song. Try a shorter song. A bigger plan costs more and needs a new yes |
| Login says "Callback URL mismatch" | Step 8 (Auth0 settings) |
| The camera button says it needs a secure page | The address must start with `https://` |
| `m4a` or `aac` songs fail | `ffmpeg` is installed by `setup.sh`; if it was skipped, run `apt-get install -y ffmpeg` |

## 13. Content Security Policy (why it is "report only")

`deploy/Caddyfile` sends a Content Security Policy as **`Content-Security-Policy-Report-Only`**. That means the browser **only warns** in the console about anything the policy would block, and **blocks nothing**. I did this because I could not run the live site: the camera worker needs `unsafe-eval` and WebAssembly, the audio engine loads from in-page `blob:` scripts, and the camera downloads files from `cdn.jsdelivr.net` and `storage.googleapis.com`. I built the policy from reading the code, but nobody has watched it work.

To make it enforced: do a full walk through the site (demo song, camera, microphone, login, upload) with the Console open. If no `[Report Only]` lines appear, tell the lead. The lead changes the header name in `deploy/Caddyfile` to `Content-Security-Policy` and runs `update.sh`. If lines do appear, the lead adds the named address to the right part of the policy first. The policy also has to allow your Auth0 address (`*.auth0.com` covers normal tenants, not a custom Auth0 domain).

## 14. Teardown checklist (after the Sunday submission)

The full, authoritative list is in **`docs/vultr.md`** ("After we submit: delete everything"). Do that list. For this deployment, also make sure:

- [ ] Vultr: **destroy the server** (its page, the three-dots menu, **Destroy Server**, confirm). A human does this. Stopping is not enough
- [ ] Vultr: delete the **firewall group** `swamphacks`
- [ ] Vultr: no snapshots, backups, extra IPs or volumes exist for it
- [ ] GoDaddy: **delete the A record** for `@` (and `www`) so the domain does not point at an address that Vultr hands to someone else
- [ ] Auth0: remove `https://example.com` from the four URL boxes in step 8
- [ ] Tiger Data: remove the server's IP from the allow-list if you added it
- [ ] Run `node scripts/vultr-budget.mjs --list` on the main laptop: it must show nothing
- [ ] Check the Vultr balance again a day later

## 15. What is NOT tested (no server exists yet)

Checked on the lead's Windows laptop only: the shell scripts parse (`bash -n`), the website builds, the Python server starts and answers `/api/health`, and `node deploy/check-local.mjs` passes. **Everything below is untested:**

- Running `setup.sh` and `update.sh` on a real Ubuntu 24.04 server (they have never executed)
- The Caddy settings file was never checked by Caddy itself (Caddy is not installed here). `setup.sh` runs `caddy validate` on the server and stops with a message if it fails
- The systemd service file was never loaded by systemd
- Getting the HTTPS certificate, GoDaddy DNS, and the exact click names in the Vultr and GoDaddy screens
- Whether 2 GB of memory is enough for a long (6 minute) song, and the Vultr prices in the cost section
- The Auth0 login on the real domain
- Camera, microphone and hand tracking over HTTPS, and the Content Security Policy in a browser
- The TouchDesigner relay from the live site (the page connects to `ws://localhost:9980` on the performer's own laptop; Chrome may ask for a "local network" permission)
- Reaching Tiger Data from the Vultr server, and `ffmpeg` for m4a/aac songs
- The NodeSource, Caddy and uv download addresses used by `setup.sh` (Node 22, the same version the project's automatic checks use; it is only used to build the website, never to run the site)

## Files in this folder

| File | What it is |
|---|---|
| `README.md` | This guide |
| `setup.sh` | First-time setup, run on the new server as root. Safe to run again |
| `update.sh` | Put a newer (or older) version of the code on the running server |
| `swamphacks-server.service` | systemd file that keeps the Python server running |
| `Caddyfile` | Caddy settings: HTTPS, website files, `/api` forwarding, security headers |
| `check-local.mjs` | A check you can run on any computer with Node: `node deploy/check-local.mjs` |

Where the domain is set: the `DOMAIN=` word in front of `bash .../setup.sh` (step 6). `setup.sh` swaps it into the Caddyfile and remembers it in `/etc/swamphacks/deploy.conf` for `update.sh`.
