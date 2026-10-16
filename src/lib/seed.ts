import type { Account, Category, Message, RoutingRule, Space, Thread } from "./types";

export const ME = { name: "Alex Moreau" };

export const SPACE_COLORS = [
  "oklch(0.6 0.15 255)",
  "oklch(0.65 0.17 300)",
  "oklch(0.65 0.15 150)",
  "oklch(0.7 0.16 55)",
  "oklch(0.62 0.19 25)",
  "oklch(0.7 0.12 200)",
  "oklch(0.55 0.02 260)",
];

export const SEED_SPACES: Space[] = [
  {
    id: "company",
    name: "Company",
    description: "Moreau Conseil: clients and partners",
    color: SPACE_COLORS[0],
    vips: ["claire.dubois@lumen-studio.com"],
    focusHours: { start: 8, end: 19, weekdaysOnly: true },
  },
  {
    id: "projects",
    name: "Projects",
    description: "Tally and Plume",
    color: SPACE_COLORS[1],
    vips: ["sam@tallyhq.app"],
  },
  {
    id: "personal",
    name: "Personal",
    description: "Family and friends",
    color: SPACE_COLORS[2],
    vips: ["lea.moreau@icloud.com"],
  },
  {
    id: "admin",
    name: "Admin & money",
    description: "Bank, taxes, invoices, subscriptions",
    color: SPACE_COLORS[3],
    vips: ["impots.gouv.fr", "qonto.com"],
  },
];

export const SEED_ACCOUNTS: Account[] = [
  {
    id: "acc-company",
    label: "Moreau Conseil",
    email: "alex@moreau-conseil.fr",
    provider: "ovh-mxplan",
    imapHost: "ssl0.ovh.net",
    smtpHost: "ssl0.ovh.net",
    defaultSpace: "company",
    aliases: ["contact@moreau-conseil.fr"],
  },
  {
    id: "acc-tally",
    label: "Tally",
    email: "hello@tallyhq.app",
    provider: "ovh-mxplan",
    imapHost: "ssl0.ovh.net",
    smtpHost: "ssl0.ovh.net",
    defaultSpace: "projects",
    aliases: ["alex@tallyhq.app"],
  },
  {
    id: "acc-plume",
    label: "Plume",
    email: "contact@plume.blog",
    provider: "ovh-mxplan",
    imapHost: "ssl0.ovh.net",
    smtpHost: "ssl0.ovh.net",
    defaultSpace: "projects",
    aliases: [],
  },
  {
    id: "acc-icloud",
    label: "iCloud",
    email: "alexm@icloud.com",
    provider: "icloud",
    imapHost: "imap.mail.me.com",
    smtpHost: "smtp.mail.me.com",
    defaultSpace: "personal",
    aliases: ["alex.moreau@me.com"],
  },
];

export const SEED_RULES: RoutingRule[] = [
  { id: "r-impots", field: "fromDomain", value: "dgfip.impots.gouv.fr", space: "admin" },
  { id: "r-qonto", field: "fromDomain", value: "qonto.com", space: "admin" },
  { id: "r-stripe", field: "fromDomain", value: "stripe.com", space: "admin", category: "receipt" },
  { id: "r-apple", field: "fromDomain", value: "email.apple.com", space: "admin", category: "receipt" },
  { id: "r-ovh", field: "fromDomain", value: "ovh.com", space: "admin", category: "receipt" },
  { id: "r-substack", field: "fromDomain", value: "substack.com", category: "newsletter" },
  { id: "r-github", field: "fromDomain", value: "github.com", category: "notification" },
  { id: "r-linear", field: "fromDomain", value: "linear.app", category: "notification" },
];

type SeedMessage = {
  from: [string, string];
  to: string[];
  hoursAgo: number;
  body: string;
};

type SeedThread = {
  accountId: string;
  subject: string;
  category: Category;
  summary?: string;
  messages: SeedMessage[];
  unread?: boolean;
  starred?: boolean;
  awaitingReply?: boolean;
};

const COMPANY = "alex@moreau-conseil.fr";
const TALLY = "hello@tallyhq.app";
const PLUME = "contact@plume.blog";
const ICLOUD = "alexm@icloud.com";

const THREADS: SeedThread[] = [
  {
    accountId: "acc-company",
    subject: "Q1 mission proposal: can you confirm the daily rate?",
    category: "needs-reply",
    summary: "Claire wants your daily rate and start date confirmed by Thursday EOD to get budget sign-off.",
    unread: true,
    messages: [
      {
        from: ["Claire Dubois", "claire.dubois@lumen-studio.com"],
        to: [COMPANY],
        hoursAgo: 3,
        body: "Hi Alex,\n\nThanks for the proposal. Our CFO is reviewing Q1 budgets on Friday. Could you confirm your daily rate and the earliest start date by Thursday EOD? If we can lock it before the review, we can start on January 6.\n\nBest,\nClaire",
      },
    ],
  },
  {
    accountId: "acc-company",
    subject: "Re: Staging deploy for the Lumen dashboard",
    category: "needs-reply",
    summary: "Karim needs a go/no-go on deploying the retry fix to staging before the 14:00 call.",
    unread: true,
    messages: [
      {
        from: ["Alex Moreau", COMPANY],
        to: ["karim@benali.dev"],
        hoursAgo: 30,
        body: "The retry fix is merged on our side. Can you prepare the staging deploy?",
      },
      {
        from: ["Karim Benali", "karim@benali.dev"],
        to: [COMPANY],
        hoursAgo: 5,
        body: "Ready to go. Do we deploy the retry fix alone, or bundle it with the export changes? I need an answer before the 14:00 call so I can tell their team.",
      },
    ],
  },
  {
    accountId: "acc-company",
    subject: "Annual accounts: 3 documents missing",
    category: "needs-reply",
    summary: "Your accountant still needs the Q3 bank statements, the car lease contract and one supplier invoice.",
    messages: [
      {
        from: ["Cabinet Martin & Associés", "sophie@cabinet-martin.fr"],
        to: [COMPANY],
        hoursAgo: 52,
        body: "Bonjour Alex,\n\nTo close the 2026 accounts we still need: Q3 bank statements, the car lease contract, and the OVH invoice from September. Could you upload them to the shared folder before Friday?\n\nSophie",
      },
    ],
  },
  {
    accountId: "acc-company",
    subject: "[lumen/dashboard] PR #482: Export invoices as CSV",
    category: "notification",
    unread: true,
    messages: [
      {
        from: ["GitHub", "notifications@github.com"],
        to: [COMPANY],
        hoursAgo: 1,
        body: "@karim-b requested your review on this pull request.\n\n+412 −96 across 14 files.",
      },
    ],
  },
  {
    accountId: "acc-company",
    subject: "LUM-129 moved to In Review",
    category: "notification",
    unread: true,
    messages: [
      {
        from: ["Linear", "notifications@linear.app"],
        to: [COMPANY],
        hoursAgo: 2,
        body: "Karim moved LUM-129 “Retry budget for payment webhooks” to In Review.",
      },
    ],
  },
  {
    accountId: "acc-company",
    subject: "Re: Invoice 2026-041",
    category: "fyi",
    awaitingReply: true,
    messages: [
      {
        from: ["Alex Moreau", COMPANY],
        to: ["compta@orbital-labs.io"],
        hoursAgo: 96,
        body: "Hello, invoice 2026-041 (4 800 € HT) was due on October 1st. Could you let me know when the payment is scheduled?",
      },
    ],
  },
  {
    accountId: "acc-tally",
    subject: "Re: Pricing page copy + launch date",
    category: "needs-reply",
    summary: "Sam likes the pricing and wants a yes/no on a Product Hunt launch on Tuesday the 21st, by Friday.",
    unread: true,
    starred: true,
    messages: [
      {
        from: ["Alex Moreau", TALLY],
        to: ["sam@tallyhq.app"],
        hoursAgo: 28,
        body: "Pushed a first pass of the pricing page. Thinking 9 €/mo solo, 19 €/mo team.",
      },
      {
        from: ["Sam Okafor", "sam@tallyhq.app"],
        to: [TALLY],
        hoursAgo: 4,
        body: "Love it. Can we lock the Product Hunt launch for Tuesday the 21st? I need a yes/no by Friday to line up hunters.",
      },
    ],
  },
  {
    accountId: "acc-tally",
    subject: "Invoices export to CSV is broken",
    category: "needs-reply",
    summary: "A paying customer gets an empty CSV export since yesterday; their accountant needs it this month.",
    unread: true,
    messages: [
      {
        from: ["Marc Petit", "marc@atelier-petit.fr"],
        to: [TALLY],
        hoursAgo: 31,
        body: "Hello, since yesterday exporting my invoices to CSV gives an empty file. My accountant needs it before the end of the month. Can you help?",
      },
    ],
  },
  {
    accountId: "acc-tally",
    subject: "How do I add my VAT number?",
    category: "needs-reply",
    summary: "A user can't find where to set their intra-community VAT number.",
    unread: true,
    messages: [
      {
        from: ["Ines Garcia", "ines.garcia@studio-ig.com"],
        to: [TALLY],
        hoursAgo: 7,
        body: "Hi! I can't find where to put my intra-community VAT number so it shows on invoices. Thanks.",
      },
    ],
  },
  {
    accountId: "acc-tally",
    subject: "Integration partnership with an accounting platform",
    category: "needs-reply",
    summary: "Partnerships lead at an accounting platform asks for a 20-minute call about syncing Tally invoices.",
    messages: [
      {
        from: ["Nora Schmidt", "nora@ledgerly.eu"],
        to: [TALLY],
        hoursAgo: 75,
        body: "Hi, I run partnerships at Ledgerly. Our users keep asking for Tally invoices to sync automatically. Open to a 20-minute call next week?",
      },
    ],
  },
  {
    accountId: "acc-tally",
    subject: "Re: Charged twice this month",
    category: "fyi",
    awaitingReply: true,
    messages: [
      {
        from: ["Paul Robert", "paul@robert-conseil.fr"],
        to: [TALLY],
        hoursAgo: 80,
        body: "I was charged twice this month, could you refund one of them?",
      },
      {
        from: ["Alex Moreau", TALLY],
        to: ["paul@robert-conseil.fr"],
        hoursAgo: 76,
        body: "Sorry about that Paul! I've refunded the duplicate charge. Can you confirm it shows on your statement in a few days?",
      },
    ],
  },
  {
    accountId: "acc-tally",
    subject: "Feature idea: recurring invoices",
    category: "fyi",
    messages: [
      {
        from: ["Thomas Roux", "thomas@roux.design"],
        to: [TALLY],
        hoursAgo: 50,
        body: "Love the app. Recurring monthly invoices would save me a lot of time. Just a suggestion, no reply needed!",
      },
    ],
  },
  {
    accountId: "acc-tally",
    subject: "Indie Hackers digest: 5 launches this week",
    category: "newsletter",
    unread: true,
    messages: [
      {
        from: ["Indie Hackers", "digest@indiehackers.substack.com"],
        to: [TALLY],
        hoursAgo: 22,
        body: "Five makers share revenue numbers and what worked on launch day.",
      },
    ],
  },
  {
    accountId: "acc-plume",
    subject: "Guest post proposal for Plume",
    category: "needs-reply",
    summary: "A writer pitches a guest post on async teams and asks if you'd publish it this month.",
    messages: [
      {
        from: ["Jeanne Laurent", "jeanne.laurent@proton.me"],
        to: [PLUME],
        hoursAgo: 44,
        body: "Hello! I enjoyed your piece on writing in public. I have a draft on async teams (1 500 words) that would fit Plume. Would you consider publishing it this month?",
      },
    ],
  },
  {
    accountId: "acc-icloud",
    subject: "Dinner Saturday?",
    category: "needs-reply",
    summary: "Léa invites you to dinner Saturday 19:30 with your parents and needs an answer by tomorrow.",
    unread: true,
    messages: [
      {
        from: ["Léa Moreau", "lea.moreau@icloud.com"],
        to: [ICLOUD],
        hoursAgo: 6,
        body: "Hey! Parents are in town this weekend. Dinner at ours Saturday around 19:30? Tell me by tomorrow so I can book the market order 🙂",
      },
    ],
  },
  {
    accountId: "acc-icloud",
    subject: "Apartment: boiler maintenance visit",
    category: "needs-reply",
    summary: "The letting agency asks whether Tuesday or Wednesday morning works for the boiler service.",
    messages: [
      {
        from: ["Agence Bellecour", "gestion@agence-bellecour.fr"],
        to: [ICLOUD],
        hoursAgo: 70,
        body: "Bonjour, le technicien peut passer mardi ou mercredi matin pour l'entretien annuel de la chaudière. Merci de nous indiquer vos disponibilités.",
      },
    ],
  },
  {
    accountId: "acc-icloud",
    subject: "Photos from the wedding 📸",
    category: "fyi",
    unread: true,
    starred: true,
    messages: [
      {
        from: ["Hugo Lefèvre", "hugo.lefevre@icloud.com"],
        to: [ICLOUD],
        hoursAgo: 33,
        body: "Finally sorted through them! Shared album link inside. Some great ones of you and Léa.",
      },
    ],
  },
  {
    accountId: "acc-icloud",
    subject: "Lenny's Newsletter: How the best PMs prioritize",
    category: "newsletter",
    unread: true,
    messages: [
      {
        from: ["Lenny Rachitsky", "lenny@substack.com"],
        to: [ICLOUD],
        hoursAgo: 9,
        body: "This week: a framework for saying no, with examples from Figma, Linear and Notion.",
      },
    ],
  },
  {
    accountId: "acc-icloud",
    subject: "La sélection de la semaine",
    category: "newsletter",
    unread: true,
    messages: [
      {
        from: ["Le Monde", "newsletters@lemonde.fr"],
        to: [ICLOUD],
        hoursAgo: 14,
        body: "Les essentiels de la semaine, sélectionnés par la rédaction.",
      },
    ],
  },
  {
    accountId: "acc-icloud",
    subject: "Votre avis d'impôt est disponible",
    category: "fyi",
    summary: "Your 2026 tax notice is available; payment is due November 15.",
    unread: true,
    messages: [
      {
        from: ["impots.gouv.fr", "ne-pas-repondre@dgfip.impots.gouv.fr"],
        to: [ICLOUD],
        hoursAgo: 20,
        body: "Votre avis d'impôt est disponible dans votre espace particulier. Date limite de paiement : 15 novembre.",
      },
    ],
  },
  {
    accountId: "acc-company",
    subject: "Action required: confirm your ID documents",
    category: "needs-reply",
    summary: "Qonto needs updated ID documents before October 15 or outgoing transfers will be paused.",
    unread: true,
    messages: [
      {
        from: ["Qonto", "compliance@qonto.com"],
        to: [COMPANY],
        hoursAgo: 26,
        body: "As part of our yearly checks, please upload a valid ID for Moreau Conseil's legal representative before October 15. Without it, outgoing transfers will be paused.",
      },
    ],
  },
  {
    accountId: "acc-icloud",
    subject: "Your receipt from Apple",
    category: "receipt",
    messages: [
      {
        from: ["Apple", "no_reply@email.apple.com"],
        to: [ICLOUD],
        hoursAgo: 40,
        body: "iCloud+ 200 GB: 2,99 €. Billed to Visa •••• 4417.",
      },
    ],
  },
  {
    accountId: "acc-tally",
    subject: "Payout of 412,80 € on its way",
    category: "receipt",
    messages: [
      {
        from: ["Stripe", "notifications@stripe.com"],
        to: [TALLY],
        hoursAgo: 18,
        body: "A payout of 412,80 € is expected to arrive in your bank account on Oct 13.",
      },
    ],
  },
  {
    accountId: "acc-company",
    subject: "Your OVHcloud invoice is available",
    category: "receipt",
    messages: [
      {
        from: ["OVHcloud", "invoice@ovh.com"],
        to: [COMPANY],
        hoursAgo: 60,
        body: "Invoice FR58201234 for 23,88 € TTC (MX Plan × 3, domain renewals) is available in your customer area.",
      },
    ],
  },
];

function snippet(body: string) {
  return body.replace(/\s+/g, " ").slice(0, 140);
}

export function buildSeedThreads(now: number): Thread[] {
  return THREADS.map((t, i) => {
    const messages: Message[] = t.messages.map((m, j) => ({
      id: `m-${i}-${j}`,
      from: { name: m.from[0], email: m.from[1] },
      to: m.to,
      sentAt: now - m.hoursAgo * 3_600_000,
      body: m.body,
    }));
    const last = messages[messages.length - 1];
    return {
      id: `t-${i}`,
      accountId: t.accountId,
      subject: t.subject,
      snippet: snippet(last.body),
      summary: t.summary,
      messages,
      category: t.category,
      unread: t.unread ?? false,
      starred: t.starred ?? false,
      status: "inbox",
      awaitingReply: t.awaitingReply,
    };
  });
}
