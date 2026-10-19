import { detectSettings, matchMx, parseAutoconfig } from "../src/server/detect";
import { parseAddresses } from "../src/server/mutate";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

// Offline: MX matching.
assert(matchMx(["aspmx.l.google.com"])?.provider === "gmail", "Google MX -> gmail");
assert(matchMx(["mx01.mail.icloud.com"])?.provider === "icloud", "iCloud MX -> icloud");
assert(matchMx(["mx1.mail.ovh.net"])?.provider === "ovh-mxplan", "OVH MX -> ovh");
assert(matchMx(["mx.zoho.eu"])?.imapHost === "imap.zoho.eu", "Zoho EU MX -> imap.zoho.eu");
assert(matchMx(["example-com.mail.protection.outlook.com"])?.smtpHost === "smtp.office365.com", "M365");
assert(matchMx(["mail.example.org"]) === null, "unknown MX -> null");

// Offline: Thunderbird autoconfig parsing.
const xml = `<?xml version="1.0"?>
<clientConfig version="1.1"><emailProvider id="example.org">
  <displayName>Example Mail</displayName><displayShortName>Example</displayShortName>
  <incomingServer type="pop3"><hostname>pop.example.org</hostname><port>995</port><socketType>SSL</socketType></incomingServer>
  <incomingServer type="imap"><hostname>imap.%EMAILDOMAIN%</hostname><port>143</port><socketType>STARTTLS</socketType></incomingServer>
  <incomingServer type="imap"><hostname>imaps.%EMAILDOMAIN%</hostname><port>993</port><socketType>SSL</socketType></incomingServer>
  <outgoingServer type="smtp"><hostname>smtp.example.org</hostname><port>587</port><socketType>STARTTLS</socketType></outgoingServer>
</emailProvider></clientConfig>`;
const parsed = parseAutoconfig(xml, "me@example.org");
assert(parsed?.imap.host === "imaps.example.org" && parsed.imap.port === 993 && parsed.imap.secure, "prefers SSL IMAP");
assert(parsed?.smtp.host === "smtp.example.org" && parsed.smtp.port === 587 && !parsed.smtp.secure, "STARTTLS SMTP");
assert(parsed?.label === "Example", "label");
assert(parseAutoconfig("<html>not found</html>", "a@b.c") === null, "garbage -> null");

// Offline: recipient parsing.
const list = parseAddresses("a@x.fr, Bob <b@y.com>; c@z.io\n");
assert(list.join(" ") === "a@x.fr b@y.com c@z.io", `addresses: ${list.join(" ")}`);
let threw = false;
try {
  parseAddresses("not-an-address");
} catch {
  threw = true;
}
assert(threw, "invalid address rejected");

async function live() {
  if (process.env.OFFLINE === "1") return;
  const cases: [string, (d: Awaited<ReturnType<typeof detectSettings>>) => boolean][] = [
    ["someone@gmail.com", (d) => d.provider === "gmail" && d.source === "domain"],
    ["someone@icloud.com", (d) => d.provider === "icloud"],
    ["someone@google.com", (d) => d.provider === "gmail" && d.source === "mx"],
    ["someone@ovh.com", (d) => d.imapHost.length > 0],
    ["someone@fastmail.com", (d) => d.imapHost.includes("fastmail")],
  ];
  for (const [email, ok] of cases) {
    const d = await detectSettings(email);
    console.log(email.padEnd(24), d.source.padEnd(10), d.label.padEnd(24), `${d.imapHost}:${d.imapPort}`, `${d.smtpHost}:${d.smtpPort}`);
    assert(ok(d), `unexpected detection for ${email}`);
  }
}

live()
  .then(() => console.log("detect test passed"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
