/**
 * Release notes, newest first. The app shows them under Settings → Updates, and
 * `npm run release` writes CHANGELOG.md from them. Add the next version's notes at
 * the top while you work, with `date: null`; the release script dates it.
 *
 * Items are one line each. `code` and **bold** are rendered.
 */
export type Release = {
  version: string;
  /** YYYY-MM-DD, or null while the version is not released yet. */
  date: string | null;
  intro?: string;
  sections: { title: string; items: string[] }[];
};

export const RELEASES: Release[] = [
  {
    version: "1.0.0-beta.3",
    date: "2026-10-26",
    intro: "Faces where they belong, and a signature under your mail.",
    sections: [
      {
        title: "Mail",
        items: [
          "A person writing from a company keeps their initials, with the company's icon as a small badge, instead of wearing its logo. Newsletters and notifications still show the logo full size.",
          "A signature per mailbox, in Settings → Mailboxes → Rename & edit. It goes under new mail, replies and forwards, follows the address you send from, and can be left off a message.",
        ],
      },
      {
        title: "Personal",
        items: [
          "Your photo in Settings → General: on your own messages and the lock screen. A link to Gravatar sets the one other people see.",
        ],
      },
    ],
  },
  {
    version: "1.0.0-beta.2",
    date: "2026-10-26",
    intro: "A more personal Clarity: your name, a lock screen with a view, and mail you can find from anywhere.",
    sections: [
      {
        title: "Mail",
        items: [
          "Search all mail from any screen with `⌘K` or the magnifier at the top right. `/` opens it from the Brief.",
          "Sort any list by newest, oldest, unread first, sender or subject. The choice is remembered.",
          "The list shows the gist of each conversation instead of its first words: the AI summary when triage is on, else the opening of the latest mail without greeting, quote or signature. Settings → General → Preview turns it off.",
          "A full-screen layout, as in Spark: the list alone, and each conversation opens over it. Settings → General → Layout.",
          "Sender photos: their Gravatar, or their company's icon. Clarity looks them up, not your browser, and it can be turned off.",
          "When the mail server can't be reached, actions say so plainly instead of “Something went wrong”.",
        ],
      },
      {
        title: "Personal",
        items: [
          "Tell Clarity your name and the Brief greets you with it: “Good morning, Thomas.”",
          "A new lock screen: clock, greeting, and a landscape photo that changes every day. Pick your own photo, or keep it plain.",
        ],
      },
      {
        title: "Updates",
        items: [
          "Settings → Updates shows the version, what changed, and whether a newer one is out.",
          "After an update, Clarity says so once, with a link to what's new.",
        ],
      },
    ],
  },
  {
    version: "1.0.0-beta.1",
    date: "2026-10-22",
    intro: "First beta. Clarity Mail now covers day-to-day mail on the Mac, in the browser and on a self-hosted server.",
    sections: [
      {
        title: "Mail",
        items: [
          "iCloud, Gmail, OVH MX Plan and any IMAP/SMTP account, with server settings found from the address.",
          "A Brief of what needs you today, spaces (Company, Projects, Personal, Admin & money), and a priority score you can read signal by signal.",
          "Archive, delete, spam, snooze, star, read/unread, move to a space, reply, write and forward, all written back to the mail server.",
          "New mail arrives in seconds through IMAP push. Deleted mail stays deleted.",
          "HTML mail keeps its layout in a sandboxed frame. Remote images are blocked until you allow them, so senders can't track when you open their mail.",
        ],
      },
      {
        title: "Keyboard triage",
        items: [
          "Tick conversations with `x` (`⇧J` / `⇧K` extend, `⌘A` or `* a` all, `* u` unread), then archive, delete, snooze, move, star or mark them all in one key.",
          "`⌘Z` undoes the last action, however many conversations it touched.",
          "`1`–`4` switch inbox filters, `g i` / `g s` / `g e`… go to folders, `?` lists every shortcut.",
        ],
      },
      {
        title: "Speed and reliability",
        items: [
          "The mailbox list loads about 8× faster and uses about 7× less memory on large mailboxes. HTML now loads when you open a message.",
          "An idle sync no longer makes every open window reload. Hidden tabs stop polling.",
          "The sync worker survives network drops and timeouts.",
        ],
      },
      {
        title: "Mac app",
        items: [
          "A self-contained app with its own local server, locked with Touch ID at each launch. The mail store is encrypted with a key kept in the Keychain.",
        ],
      },
      {
        title: "Known limits",
        items: [
          "The Mac app is signed ad hoc, not notarized. On first launch, right-click it and choose Open (see Lisez-moi.txt).",
          "The iPhone and Android apps are set up in `mobile/` but have not been built or tested on a device yet.",
          "Multi-select is keyboard and mouse only. There is no long-press selection on touch screens yet.",
        ],
      },
    ],
  },
];

/** Where releases are published. The app checks it for updates; CLARITY_RELEASES_REPO overrides it. */
export const RELEASES_REPO = "tomonchain/clarity-mail";

/** This build's version, from package.json, and the commit it was built from when known. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
export const APP_COMMIT = process.env.NEXT_PUBLIC_APP_COMMIT || null;

type Parsed = { core: number[]; pre: (string | number)[] };

function parse(version: string): Parsed {
  const [core, pre] = version.replace(/^v/, "").split("+")[0].split("-", 2) as [string, string | undefined];
  return {
    core: core.split(".").map((n) => Number(n) || 0),
    pre: pre ? pre.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [],
  };
}

/** Semver order: 1.0.0-beta.1 < 1.0.0-beta.2 < 1.0.0 < 1.0.1. */
export function compareVersions(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.core[i] ?? 0) !== (y.core[i] ?? 0)) return (x.core[i] ?? 0) - (y.core[i] ?? 0);
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p - q;
    if (typeof p === "number") return -1;
    if (typeof q === "number") return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/** Notes for this version and the ones before it; a newer, unreleased entry stays hidden. */
export function shippedReleases(current = APP_VERSION): Release[] {
  return RELEASES.filter((r) => compareVersions(r.version, current) <= 0);
}
