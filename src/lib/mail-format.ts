export function looksLikeHtml(value: string) {
  return /<(html|body|div|table|p|br|span|a|img|h[1-6]|ul|ol|blockquote)\b/i.test(value);
}

/** Plain mail stays plain. Markdown needs more than one signal so a single dash is not a list. */
export function looksLikeMarkdown(value: string) {
  if (!value.trim() || looksLikeHtml(value)) return false;
  let score = 0;
  if (/^#{1,6}\s+\S/m.test(value)) score += 1;
  if (/```[\s\S]*```/.test(value)) score += 2;
  if (/\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(value)) score += 1;
  if (/^\s*[-*]\s+\S/m.test(value) && /\n\s*[-*]\s+\S/.test(value)) score += 1;
  if (/^\s*>\s+\S/m.test(value)) score += 1;
  return score >= 2;
}
