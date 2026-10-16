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

const safeStyle = [/^[\w\s%#.,()\-/'":]+$/];

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
    },
  });
}
