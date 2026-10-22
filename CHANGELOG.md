# Changelog

## 1.0.0-beta.1 — 2026-10-22

First beta. Clarity Mail now covers day-to-day mail on the Mac, in the browser and on a self-hosted server.

### Mail

- iCloud, Gmail, OVH MX Plan and any IMAP/SMTP account, with server settings found from the address.
- A Brief of what needs you today, spaces (Company, Projects, Personal, Admin & money), and a priority score you can read signal by signal.
- Archive, delete, spam, snooze, star, read/unread, move to a space, reply, write and forward, all written back to the mail server.
- New mail arrives in seconds through IMAP push. Deleted mail stays deleted.
- HTML mail keeps its layout in a sandboxed frame. Remote images are blocked until you allow them, so senders can't track when you open their mail.

### Keyboard triage

- Tick conversations with `x` (`⇧J` / `⇧K` extend, `⌘A` or `* a` all, `* u` unread), then archive, delete, snooze, move, star or mark them all in one key.
- `⌘Z` undoes the last action, however many conversations it touched.
- `1`–`4` switch inbox filters, `g i` / `g s` / `g e`… go to folders, `?` lists every shortcut.

### Speed and reliability

- The mailbox list loads about 8× faster and uses about 7× less memory on large mailboxes. HTML now loads when you open a message.
- An idle sync no longer makes every open window reload. Hidden tabs stop polling.
- The sync worker survives network drops and timeouts.

### Mac app

- A self-contained app with its own local server, locked with Touch ID at each launch. The mail store is encrypted with a key kept in the Keychain.

### Known limits

- The Mac app is signed ad hoc, not notarized. On first launch, right-click it and choose Open (see Lisez-moi.txt).
- The iPhone and Android apps are set up in `mobile/` but have not been built or tested on a device yet.
- Multi-select is keyboard and mouse only. There is no long-press selection on touch screens yet.
