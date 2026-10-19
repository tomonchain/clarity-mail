"use client";

import { ImageOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { looksLikeMarkdown } from "@/lib/mail-format";
import { imagesAllowed, trustSender, useImagePrefs } from "@/lib/privacy";

const FRAME_CSS = `
:root { color-scheme: light; }
html, body { margin: 0; padding: 0; background: #fff; }
html { overflow-y: hidden; }
body {
  font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  color: #1d1d1f;
  overflow-wrap: break-word;
  overflow-x: auto;
}
img { max-width: 100%; height: auto; }
img[data-blocked] { background: #eef0f3; }
table { max-width: 100%; }
a { color: #2f6fed; }
blockquote { margin: 0 0 0 .4em; padding-left: .8em; border-left: 2px solid #d5d7dc; color: #555; }
pre { white-space: pre-wrap; }
`;

const REMOTE_URL = /url\s*\([^)]*\)/gi;
// Pictures embedded in the mail itself, served by Clarity from the local mailbox: no tracking.
const INLINE_SRC = /^\/api\/inline\/[\w-]{1,64}\/\d{1,4}$/;

/**
 * Turn sanitized mail HTML into a standalone document for a sandboxed frame.
 * DOMParser documents are inert, so nothing here loads or runs while it is
 * rewritten. Remote images and CSS backgrounds are cut unless allowed.
 */
function frameDocument(html: string, allowRemote: boolean) {
  if (typeof DOMParser === "undefined") return { doc: "", blocked: 0 };
  const parsed = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, "text/html");
  let blocked = 0;
  for (const img of Array.from(parsed.querySelectorAll("img"))) {
    const src = img.getAttribute("src") ?? "";
    if (INLINE_SRC.test(src)) continue;
    if (/^https?:/i.test(src)) {
      if (!allowRemote) {
        img.removeAttribute("src");
        img.removeAttribute("srcset");
        img.setAttribute("data-blocked", "");
        blocked += 1;
      }
    } else if (!/^data:image\/(png|gif|jpe?g|webp);/i.test(src)) {
      img.removeAttribute("src");
    }
  }
  for (const el of Array.from(parsed.querySelectorAll("[style]"))) {
    const style = el.getAttribute("style") ?? "";
    if (!allowRemote && REMOTE_URL.test(style)) {
      el.setAttribute("style", style.replace(REMOTE_URL, "none"));
      blocked += 1;
    }
    REMOTE_URL.lastIndex = 0;
  }
  // Belt and braces: even markup the sanitizer missed cannot run or fetch anything.
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `img-src 'self' data:${allowRemote ? " https: http:" : ""}`,
    "font-src data:",
    "form-action 'none'",
  ].join("; ");
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><base target="_blank"><style>${FRAME_CSS}</style></head><body>${parsed.body.innerHTML}</body></html>`;
  return { doc, blocked };
}

function HtmlFrame({ html, sender }: { html: string; sender?: string }) {
  const prefs = useImagePrefs();
  const [loadOnce, setLoadOnce] = useState(false);
  const allow = loadOnce || imagesAllowed(prefs, sender);
  const { doc, blocked } = useMemo(() => frameDocument(html, allow), [html, allow]);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;
    const measure = () => {
      const root = frame.contentDocument?.documentElement;
      if (root) setHeight(Math.max(24, Math.ceil(root.scrollHeight)));
    };
    const onLoad = () => {
      measure();
      const body = frame.contentDocument?.body;
      if (!body) return;
      observer?.disconnect();
      observer = new ResizeObserver(measure);
      observer.observe(body);
      for (const img of Array.from(body.querySelectorAll("img"))) img.addEventListener("load", measure);
    };
    frame.addEventListener("load", onLoad);
    if (frame.contentDocument?.readyState === "complete") onLoad();
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [doc]);

  return (
    <div className="space-y-3">
      {blocked > 0 && !allow && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-secondary/70 px-3 py-2 text-xs text-muted-foreground">
          <ImageOff className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">Remote images are blocked, so the sender can&apos;t see when you open this.</span>
          <span className="flex shrink-0 gap-1">
            <Button size="xs" variant="ghost" onClick={() => setLoadOnce(true)}>
              Load images
            </Button>
            {sender && (
              <Button size="xs" variant="ghost" onClick={() => trustSender(sender)}>
                Always from this sender
              </Button>
            )}
          </span>
        </div>
      )}
      <div className="overflow-hidden dark:rounded-lg dark:bg-white dark:p-4">
        <iframe
          ref={frameRef}
          title="Message"
          // No allow-scripts: nothing in a mail can run. Same-origin only lets Clarity measure its height.
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={doc}
          style={{ height }}
          className="block w-full border-0 bg-white"
        />
      </div>
    </div>
  );
}

export function MailBody({ body, html, sender }: { body: string; html?: string; sender?: string }) {
  const prefs = useImagePrefs();
  if (html?.trim()) return <HtmlFrame html={html} sender={sender} />;

  if (looksLikeMarkdown(body)) {
    const allow = imagesAllowed(prefs, sender);
    return (
      <div className="text-[15px] leading-7 break-words [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:font-mono [&_code]:text-[13px] [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-xl [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            ),
            img: ({ src, alt }) =>
              allow && typeof src === "string" && /^https?:/i.test(src) ? (
                // eslint-disable-next-line @next/next/no-img-element -- remote mail content, not an app asset
                <img src={src} alt={alt ?? ""} referrerPolicy="no-referrer" className="max-w-full" />
              ) : (
                <span className="text-muted-foreground">[{alt || "image"}]</span>
              ),
          }}
        >
          {body}
        </ReactMarkdown>
      </div>
    );
  }

  return <p className="text-[15px] leading-7 whitespace-pre-wrap">{body}</p>;
}
