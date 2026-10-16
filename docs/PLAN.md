# Clarity Mail: project plan

A personal email aggregator that replaces Spark Mail (90 €/year). It pulls your iCloud and OVH mailboxes into one place, sorts mail into **spaces** (Company, Projects, Personal, Admin & money), and opens on a **Brief**: a short list of what needs you today, with the reason each item is there.

The web app syncs real mailboxes (Phase 1, web). iPhone comes after that. The rest of this document is the plan for daily use on **iPhone and desktop**.

---

## 0. Decisions

All open questions are settled. Nothing below needs more input to start Phase 1.

| Topic | Decision | Consequence |
|-------|----------|-------------|
| Providers | **iCloud** (personal) and **OVH MX Plan** mailboxes (Web Cloud → Emails) for the company and projects | Two presets only: iCloud and `ssl0.ovh.net`. Plain IMAP + SMTP with passwords; no OAuth to build or maintain. |
| Hosting | **Cloud VPS now**, home server later | Ship as Docker Compose with a one-command backup/restore so moving to the home server is a copy, not a rebuild. |
| iOS | **Daily use, part of the MVP** | Install Clarity Mail to the iPhone home screen from Safari. A React Native app is not the plan: a later native shell would wrap this interface if widgets or the default-mail entitlement become necessary. |
| Desktop | **macOS** | Add Clarity Mail to the Dock from Safari. A later Tauri shell adds the menu-bar badge, a global shortcut, and `mailto:`. The interface stays this one; the Mac app is not a second client written in Rust. |
| AI | **DeepSeek API** (cloud). Mistral still works if that key is set instead. | AI triage (category, needs-reply, summary) runs when `DEEPSEEK_API_KEY` is set. The provider stays swappable. |
| Support space | **Not needed** | Dropped. The "reply target" setting stays available per space if you want it later. |
| Spaces | **Start with the suggested set** | Company, Projects, Personal, Admin & money (below). Create, rename, recolour or delete at any time. |
| Web address | **Set at deploy time, no new mailbox** | The app needs a web address for HTTPS and iPhone push, not an email address. At deploy, one DNS record on a domain you already have at OVH (e.g. `clarity.<your-domain>`) points to the VPS. Nothing about your mail setup changes. |
| Devices | **One server copy** | iPhone, Mac, and the browser all read the server. They never sync mailboxes with each other. IMAP/SMTP stays on the server. |

### Suggested starting spaces

Based on your accounts:

| Space | Fed by | Why |
|-------|--------|-----|
| **Company** | Your company OVH mailbox(es) | Clients, partners, accountant. Focus hours on weekdays so it stays quiet in the evening and at weekends. |
| **Projects** | Each project's OVH mailbox | One space for all side projects to start with. Split a project into its own space once it gets busy. |
| **Personal** | iCloud | Family, friends, home. |
| **Admin & money** | Rules and AI, from any account | Bank, taxes, URSSAF, invoices, subscriptions, receipts. They arrive at every address but belong together. |

Newsletters and automated notifications are a **category**, not a space: they go to "Can wait" in every space and never trigger notifications.

---

## 1. Goals

| # | Goal | What "done" looks like |
|---|------|------------------------|
| G1 | **One place for every mailbox** | iCloud and every OVH address in one app, with read state, flags and archive kept in sync with the server in both directions. |
| G2 | **Separate life areas** | Each account, alias or sender belongs to a space. You can view one space at a time. |
| G3 | **The Brief as homescreen** | Opens on a ranked list of the few things that need action, then a summary per space, then mail you're waiting on, then the noise grouped so you can clear it in one tap. |
| G4 | **Priorities you can explain** | Every ranked item says why it is there ("VIP sender", "Asks for a reply", "Deadline Thursday"). |
| G5 | **Reply from the right identity** | Replies go out from the address the mail came to, with the right signature, through the right SMTP server. |
| G6 | **Works on iPhone and desktop from day one** | Installed on the iPhone home screen and on the Mac/PC, with notifications only for what matters. |
| G7 | **You own the data** | Self-hosted, credentials encrypted at rest. The only third party is the AI API, and it receives a trimmed excerpt, never attachments. |

### Non-goals (for now)

- Shared inboxes, assignment, helpdesk features.
- Calendar or contacts management beyond reading invites and VIP lists.
- Replacing iCloud or OVH: they keep storing your mail. Clarity Mail is a client.

---

## 2. Core concepts

```
Account ──(default space)──► Space ◄──(rules, then AI suggestion)── Thread
   │                                                                  │
   └── Identities (from-addresses, signatures, SMTP)                  └── Category, summary, priority + reasons
```

- **Account**: one IMAP/SMTP mailbox. On OVH each address is usually its own mailbox with its own password.
- **Identity**: an address you can send from: the mailbox address, OVH aliases, iCloud aliases (`@me.com`, custom domain, Hide My Email).
- **Space**: a life area with colour, VIPs, focus hours and an optional reply target.
- **Routing**: (1) manual move, then (2) your rules in order, then (3) the AI's space suggestion when it is confident, then (4) the account's default space. Rules always beat the AI.
- **Category**: `needs-reply`, `fyi`, `calendar`, `receipt`, `notification`, `newsletter`. Headers catch the obvious ones (`List-Unsubscribe`, `Auto-Submitted`, `noreply@`). The AI decides the rest.
- **Priority**: a 0–100 score built from named signals (§6).
- **Thread state**: `inbox`, `done` (archived on the server), `snoozed` (comes back at a set time).

---

## 3. Architecture

```
┌─────────────────────────────────── VPS (later: home server) ────────────────────────────────────┐
│                                                                                                   │
│  Caddy (HTTPS) ─► Next.js app (UI + API) ──── SQLite (WAL) + FTS5 ──── Sync worker (Node)         │
│                        │                         ▲                      ├─ IMAP IDLE (iCloud, OVH) │
│                        │ Web Push               │                      ├─ SMTP send + outbox      │
│                        ▼                         │                      └─ AI triage queue ──► AI API
│        iPhone (home-screen app) · Mac/PC (installed app, later Tauri)                             │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Layer | Choice | Why |
|-------|--------|-----|
| UI | Next.js (App Router) + TypeScript + Tailwind + shadcn/ui | Already used in the prototype. One codebase for iPhone, desktop and browser. |
| Storage | SQLite + Drizzle ORM, FTS5 for search | One user, one file, trivial to back up and move to the home server. |
| Sync | Separate Node worker: [`imapflow`](https://imapflow.com/) for IMAP, `nodemailer` for SMTP, `mailparser` for MIME | Keeps big syncs away from the UI process. `imapflow` handles IDLE and CONDSTORE. |
| AI | Vercel AI SDK with a swappable provider (Mistral, OpenAI or Anthropic), structured output (zod schema) | Switching provider is a config change. Structured output keeps classification reliable. |
| HTML mail | Sandboxed `iframe` (no scripts) + DOMPurify, remote images blocked by default | Safety, and it blocks tracking pixels. |
| Credentials | libsodium `secretbox`, key in an env var | A leaked database file alone exposes nothing. |
| App login | Passkey (Face ID / Touch ID) + password fallback, long-lived session | Opening the iPhone app shouldn't mean logging in every time. |
| Push | Web Push (VAPID): works on iOS 16.4+ for home-screen apps, and on desktop | One mechanism for every device. |
| Deploy | Docker Compose (caddy + app + worker + volume), nightly encrypted backup | Same file on the VPS and the future home server. |

**Hosting cost:** an entry-level VPS (OVH, Hetzner and similar) costs a few euros a month. With the AI API on top (§6), the total is roughly what Spark costs. You get control and features rather than savings, and the VPS cost goes away once the home server exists. HTTPS and iPhone push need a web address: one DNS record on a domain you already own (for example `sorted.<your-domain>`), added at deploy time. No new mailbox is involved.

---

## 4. iPhone and desktop

### iPhone (MVP): installed web app (PWA)

What you get once Clarity Mail is added to the home screen from Safari (iOS 16.4 or later):

- Full-screen app with its own icon, no Safari bars.
- **Push notifications** for high-priority mail (VIPs, deadlines), inside each space's focus hours, plus an optional morning Brief notification.
- **App icon badge** with the count of priority items.
- Face ID login via passkey, offline cache of recent threads, swipe gestures (right: done, left: snooze).
- Fast opening: the server syncs all the time, so the app only fetches what changed.

Known limits of a web app on iOS:

- It **cannot become the default mail app**. `mailto:` links in other apps still open Apple Mail.
- No share-sheet extension ("share to Clarity Mail"), no Siri, no widgets.
- Notifications need a one-time permission from inside the installed app.

### iPhone (later, if those limits bother you): native wrapper

Wrap the same UI with Capacitor or Tauri 2 (both can target iOS). This adds widgets, a share extension and better background behaviour. Costs: the Apple Developer Program (99 USD/year) to install it on your phone for more than 7 days, and becoming the default mail app also needs a specific entitlement approved by Apple. Worth revisiting after a few weeks with the PWA.

### macOS

- **Now:** `npm run desktop:build` produces an unsigned Clarity Mail.app (Apple Silicon and Intel). It is the same app, running on the Mac, with its own mailbox in `~/Library/Application Support/Clarity Mail`. It does not share the website's database. The first launch needs a right-click → Open because the app is not notarised.
- **Still available:** in Safari, File → Add to Dock (macOS Sonoma or later), which opens the server you already deployed.
- **Later:** a menu-bar badge, a global shortcut, launch at login, and registering as the default app for `mailto:` links. Signing and notarisation only matter for distributing the app to other people, which needs the Apple Developer Program.

---

## 5. Connecting your providers

| Provider | IMAP | SMTP | Credentials |
|----------|------|------|-------------|
| **iCloud** | `imap.mail.me.com:993` (SSL) | `smtp.mail.me.com:587` (STARTTLS) | Your iCloud address plus an **app-specific password** (appleid.apple.com → Sign-In and Security → App-Specific Passwords). Requires two-factor authentication on the Apple ID. |
| **OVH MX Plan** (Web Cloud → Emails) | `ssl0.ovh.net:993` (SSL) | `ssl0.ovh.net:465` (SSL) | Full email address plus the mailbox password (reset it from the OVH control panel if needed). |

On MX Plan each address is its own mailbox with its own password, so each company or project address is one account in Clarity Mail. The "Add account" form has both presets plus a "test connection" button. A generic IMAP option stays available in case you add another provider later.

**Sync strategy per account:**

1. Backfill the last 90 days, newest first, so the Brief is useful within minutes. Older mail is fetched in the background.
2. Live updates: IMAP IDLE on INBOX (iCloud and OVH both support it), and a 2–5 minute poll of Sent and Archive.
3. Write-back: read/unread, flag, archive (move to the Archive special-use folder), delete (move to Trash). Snooze archives on the server and moves the thread back to INBOX when it ends, so Apple Mail and webmail agree.
4. Sending: SMTP through the identity's own server, then append a copy to that account's Sent folder (iCloud and OVH don't always do it on their own).
5. Threading by `Message-ID` / `In-Reply-To` / `References`.
6. "Waiting on others": threads where the last message is yours, older than N days, with no reply.

---

## 6. Triage: AI, rules and the priority engine

### AI triage (MVP)

Each new thread goes through a background queue once:

1. Send the model: sender, recipients, subject, and the first ~2 KB of plain text of the latest message (quoted history and signatures removed). Never attachments.
2. Get structured output back: `category`, `needsReply` (yes/no), `deadline` (date or null), a one-line `summary`, a `suggestedSpace` with a confidence score, and a short `why`.
3. Cache the result in the database. It is only recomputed when a new message arrives in the thread.

Later additions: the Brief's opening paragraph, reply drafts in your tone per identity, and "explain this thread" on long conversations.

**Provider: Mistral.** Use a small, fast Mistral model for triage (EU company, servers in Europe, handles French and English mail well). The API key goes in the server's environment. Review Mistral's API data-retention settings when creating the key. OpenAI or Anthropic remain a config switch away. AI can be turned off per space (for example on for Projects and Admin, off for Personal).

**Cost:** at a few hundred emails a day, one short request per thread with a small model costs roughly 1–3 € a month. A monthly spending cap and a usage line in Settings keep it visible.

### Priority score

Named signals add up. The prototype implements this in `src/lib/priority.ts`. The AI supplies `needsReply` and `deadline`; the rest comes from headers, settings and thread state.

| Signal | Points |
|--------|--------|
| VIP sender (per space) | +35 |
| Past the space's reply target | +30 |
| Needs a reply | +25 |
| Mentions a deadline | +15 |
| Waiting more than 2 days for your reply | +10 |
| Starred | +10 |
| Sent directly to you | +5 |
| Receipt | −15 |
| Outside the space's focus hours | −20 |
| Automated notification | −25 |
| Newsletter | −40 |

**Brief layout:** a one-line summary, then **Top priorities** (up to 5, score ≥ 40, with AI summary and Done / Snooze / Open), then one card per space, then **Waiting on others**, then **Can wait** (one-tap clear).

---

## 7. Roadmap

Ordered so that you can use Clarity Mail daily on your iPhone as early as possible. Each phase ends with something usable.

### Phase 0: UI prototype ✅ (this repo)

- Brief, spaces (editable), unified inbox, reading pane, explainable priority, rules, sample AI summaries, sample iCloud and OVH accounts, installable on the home screen.
- **Use it on your phone and desktop and note what feels wrong.** That is the cheapest moment to change the design.

### Phase 1: Server, sync, deploy

Web slice, in this repo:

- SQLite (accounts, sessions, mailboxes, messages, threads, spaces, rules). Mailbox passwords encrypted with AES-256-GCM. One password login for the app.
- IMAP sync for iCloud, OVH MX Plan, and any other IMAP host. Last 90 days. Threads joined on Message-ID. A worker polls every 30 seconds.
- Done, snooze, star, read, and reply are written to the mail server immediately. Triage uses header and phrase rules, and DeepSeek (or Mistral) when that API key is set.
- Docker Compose for the VPS. The dev server can use a local test mailbox so nothing here needs your real passwords yet.

Still later in this phase: IDLE, full-text search, passkeys, Caddy, a nightly backup, and the iPhone home-screen app.

- **Exit criteria:** all your mailboxes show up on your iPhone home-screen app within a minute of mail arriving.

### Phase 2: Actions, sending, iPhone essentials

- Write-back (read, flag, archive, delete, snooze) through an outbox with retries.
- Compose, reply, forward through the right SMTP identity, with signatures; copy to Sent.
- Sanitised HTML rendering, remote image blocking, attachments.
- iPhone: swipe gestures, offline cache, Web Push (basic: VIPs only), badge count.
- **Exit criteria:** a full day of email handled from the iPhone and desktop without opening Apple Mail or OVH webmail.

### Phase 3: AI triage and the real Brief → **MVP complete**

- AI triage queue (§6), summaries on the Brief and in threads, AI space suggestions with "accept as rule".
- Priority engine on real data, VIPs, focus hours, waiting-on-others, one-tap clear, one-click unsubscribe (`List-Unsubscribe`).
- Push for priority ≥ threshold inside focus hours; optional morning Brief notification.
- **Exit criteria:** the Brief's top 5 match what you would have picked yourself on most days. **Cancel Spark.**

### Phase 4: Desktop app

- Tauri macOS app: menu-bar badge, global shortcut, native notifications, default mail app, launch at login.

### Phase 5: Home server and extras

- Move to the home server: restore the backup there, point DNS at it (or use a tunnel such as Cloudflare Tunnel or Tailscale Funnel if you don't want to open ports).
- AI reply drafts, Brief paragraph, thread explanations.
- Optional native iPhone wrapper if the PWA limits (§4) get in the way.

---

## 8. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| iOS web-app limits (no default mail app, push needs home-screen install) | Accept them for the MVP; the native wrapper is planned as an option (§4). |
| iCloud IMAP quirks (throttling with many connections, Sent copies) | One connection per account, IDLE on INBOX only, polling for the rest, explicit append to Sent. |
| AI misclassifies something important | Rules always win, VIPs always score high, each classification shows its `why`, and "Move to…" corrections can become rules. |
| Data loss from a sync bug | Phase 1 is read-only; Phase 2 actions go through an audited outbox, delete always means "move to Trash", and a dry-run mode exists. |
| Credentials and mail on a VPS | Encryption at rest, passkey login, HTTPS only, app-specific/revocable passwords, encrypted backups, OS auto-updates. |
| Moving VPS → home server | Same Docker Compose file; backup/restore tested in Phase 1, not on migration day. |

---

## 9. What Phase 1 needs from you, when it gets there

No more questions. These are setup steps at deploy time, not decisions:

- A VPS (any small Linux VPS) and one DNS record pointing a subdomain at it.
- An iCloud app-specific password, and the password of each OVH MX Plan mailbox.
- A DeepSeek API key (Mistral also works). Put it in `.env` as `DEEPSEEK_API_KEY`. It is not required for sync itself.
