import sanitizeHtml from "sanitize-html";

const STYLE = [
  "color",
  "background",
  "background-color",
  "font",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-align",
  "text-decoration",
  "line-height",
  "letter-spacing",
  "margin",
  "margin-left",
  "margin-right",
  "margin-top",
  "margin-bottom",
  "padding",
  "padding-left",
  "padding-right",
  "padding-top",
  "padding-bottom",
  "border",
  "border-color",
  "border-width",
  "border-style",
  "border-collapse",
  "border-spacing",
  "width",
  "height",
  "max-width",
  "min-width",
  "display",
  "vertical-align",
  "list-style-type",
  "white-space",
];

// No url(), image() or expression(): CSS must not fetch anything (tracking) or run anything.
const safeStyle = [/^(?!.*\b(?:url|image|image-set|expression)\s*\()[\w\s%#.,()\-/'":]+$/i];

/** Where Clarity serves an image embedded in a mail (cid:), from the local mailbox. */
export const INLINE_IMAGE_SRC = /^\/api\/inline\/[\w-]{1,64}\/\d{1,4}$/;

/** Images: remote (http/https, blocked or not by the reader) or embedded ones Clarity stored. */
function imageSource(src: string | undefined) {
  if (!src) return undefined;
  const value = src.trim();
  if (/^https?:\/\//i.test(value) || INLINE_IMAGE_SRC.test(value)) return value;
  return undefined;
}

/** Keep the layout of an HTML mail and drop scripts, forms, and remote-active content. */
export function cleanMailHtml(input: string) {
  return sanitizeHtml(input.replaceAll("\u0000", "").slice(0, 200_000), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "h1",
      "h2",
      "span",
      "center",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "td",
      "th",
      "caption",
    ]),
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      td: ["colspan", "rowspan", "align", "valign", "width"],
      th: ["colspan", "rowspan", "align", "valign", "width"],
      table: ["align", "width", "border"],
      "*": ["style"],
    },
    allowedStyles: {
      "*": Object.fromEntries(STYLE.map((prop) => [prop, safeStyle])),
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https"] },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noreferrer noopener", target: "_blank" }),
      img: (tagName, attribs) => {
        const { src, ...rest } = attribs;
        const kept = imageSource(src);
        return { tagName, attribs: kept ? { ...rest, src: kept } : rest };
      },
    },
  });
}
