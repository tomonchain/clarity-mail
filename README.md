# Clarity Mail

A personal email aggregator meant to replace Spark Mail. It merges iCloud and OVH mailboxes into one app, sorts mail into **spaces** (Company, Projects, Personal, Admin & money), and opens on a **Brief**: the few things that need you today, each with the reason it is ranked there.

One server holds the mail. The phone and a browser on the Mac read that same copy; they do not sync with each other. The web app syncs real mail over IMAP and writes actions back over IMAP and SMTP. Install it from the browser (Add to Dock on macOS, Add to Home Screen on iPhone). The Mac app below is a separate local copy you can open without that server. See [`docs/PLAN.md`](docs/PLAN.md).

## What you can do

- **Brief**: the top priorities across every space, a card per space, mail you are waiting on, and a pile of newsletters and notifications you can clear in one click (with undo).
- **Explainable priority**: every thread gets a 0–100 score from named signals (VIP sender, asks for a reply, deadline wording, reply target, starred, newsletter, outside focus hours). The reading pane lists each signal and its points.
- **Spaces and unified inbox**: per-space and all-inbox views with Priority, Recent, To answer, Noise, Snoozed, and Done, plus search.
- **Actions on the server**: done, snooze, star, read or unread, move to another space, reply from the account the mail was sent to, write a new message, and forward.
- **Reading**: the mailbox list and the open message scroll on their own. HTML mail keeps its layout (scripts stripped). Markdown mail is rendered when the body looks like Markdown.
- **Keyboard**: in the inbox, `j` / `k` move, `Enter` opens, `Esc` closes, `e` done, `s` star, `u` unread, `r` reply, `z` snooze until tomorrow morning, `/` search, `?` the shortcut list. In the composer, `⌘ Enter` sends.
- **Accounts you add yourself**: iCloud and Gmail (app-specific password), OVH MX Plan (`ssl0.ovh.net`), or any other address. Type the email and Clarity Mail finds its servers: known domains first, then the domain's MX record (Google Workspace, iCloud+ custom domains, OVH, Microsoft 365, Zoho, Fastmail, Yahoo, Gandi, Infomaniak), then Thunderbird's public server list, then an `imap.` / `smtp.` guess. Hosts and ports stay editable. Spaces and routing rules stay editable.
- **Triage**: newsletters, receipts, notifications, and questions are classified from headers and wording. Set `DEEPSEEK_API_KEY` (or `MISTRAL_API_KEY`) and new threads also get a one-sentence summary.

## Run it locally

Requirements: Node.js 22 and npm.

```bash
npm install
cp .env.example .env
npm run dev:all
```

Open http://localhost:4317. The first visit asks you to set a password for Clarity Mail. That password is only for this app. Mailbox passwords are stored encrypted in `data/` and are never sent back to the browser.

Add a mailbox from **Settings**. Presets:

| Provider | IMAP | SMTP |
|----------|------|------|
| iCloud | `imap.mail.me.com:993` | `smtp.mail.me.com:587` (STARTTLS). Use an app-specific password. |
| Gmail / Google Workspace | `imap.gmail.com:993` | `smtp.gmail.com:465`. Use an app password (myaccount.google.com/apppasswords, needs 2-step verification). |
| OVH MX Plan | `ssl0.ovh.net:993` | `ssl0.ovh.net:465`. Use the mailbox password. |
| Other | detected from the address | Port 993 / 465 means TLS; any other port uses STARTTLS. |

`npm run test:detect` checks server detection (offline cases, plus live lookups unless `OFFLINE=1`).

`npm run dev` starts only the website. `npm run worker` is the sync process; `npm run dev:all` runs both.

### Local test mailbox

A GreenMail server on this machine can stand in for iCloud and OVH. With it listening on IMAP `127.0.0.1:3143` and SMTP `127.0.0.1:3025`, and a user `sorted-test@test.local` / `secret`:

```bash
SORTED_DEV_LOGIN_HINT=1 npm run bootstrap
SORTED_DEV_LOGIN_HINT=1 npm run dev:all
```

The sign-in page then shows the dev password (`sorted-dev` unless `SORTED_DEV_PASSWORD` is set). The Brief says the account is a local test mailbox. Leave `SORTED_DEV_LOGIN_HINT` unset on any real server.

`npm run test:mail` runs the sync, archive, and reply checks against that same GreenMail server, in a throwaway data directory.

## Mac app

On this Mac, `npm run desktop:install` builds the app for this Mac's chip, signs it ad hoc, and replaces `/Applications/Clarity Mail.app` (your mail and accounts are kept; they live in `~/Library/Application Support/Clarity Mail`). `npm run desktop:build` does the same without installing. Set `CLARITY_ALL_ARCHES=1` to build both the Apple Silicon and the Intel app.

On Linux, `npm run desktop:build` writes two unsigned apps:

- `desktop/dist/Clarity-Mail-Apple-Silicon.zip` for M1, M2, M3, and M4
- `desktop/dist/Clarity-Mail-Intel.zip` for an Intel Mac

Each zip contains `Clarity Mail.app` and a short `Lisez-moi.txt`. The build downloads the official Electron, Node.js, and SQLite macOS binaries, so it can run on Linux as well as on a Mac. It does not need an Apple Developer account.

On the Mac, unzip the archive, then right-click `Clarity Mail.app` and choose Open the first time. If macOS says the app is damaged, run:

```bash
xattr -dr com.apple.quarantine "/path/to/Clarity Mail.app"
```

The first window asks for a password for Clarity Mail. Add iCloud, Gmail, OVH or any other address from Settings. Mail for this app is stored only on that Mac, in `~/Library/Application Support/Clarity Mail`. Closing the window leaves sync running; quit from the Clarity Mail menu.

This copy is not the website. Accounts and the password are chosen again here.

For the one-sentence AI summary, create `~/Library/Application Support/Clarity Mail/clarity.env`:

```bash
DEEPSEEK_API_KEY=your-key
```

Reopen the app after saving the file. `MISTRAL_API_KEY` is the fallback. Without either, triage stays on header and phrase rules.

## Run it on a VPS

```bash
cp .env.example .env
# Put a 64-character hex string in SORTED_SECRET. Generate one with: openssl rand -hex 32
docker compose up -d --build
```

The container listens on port 4317 and keeps the database in the `sorted-data` volume. Put it behind HTTPS and set `SORTED_SECURE_COOKIE=1` (Compose already does). Point one DNS record at the VPS when you have a hostname. No new mailbox is required for that.

## Code map

| Path | What it is |
|------|------------|
| `src/lib/priority.ts` | Priority scores and the reasons shown in the reading pane |
| `src/lib/routing.ts` | Which space and category a thread belongs to |
| `src/lib/providers.ts` | iCloud, OVH MX Plan, and generic IMAP presets |
| `src/server/` | Database, encryption, IMAP sync, SMTP reply, triage |
| `src/worker/index.ts` | Polls every mailbox and wakes snoozed threads |
| `src/app/api/` | Session, state, and mutations |
| `src/components/brief.tsx` | Brief homescreen |
| `desktop/` | macOS app shell and the script that packs Clarity Mail.app |
| `docs/PLAN.md` | Decisions and what is still later (iPhone, menu-bar extras) |

Stack: Next.js 16 (App Router), TypeScript, Tailwind CSS 4, shadcn/ui, SQLite, imapflow, nodemailer.
