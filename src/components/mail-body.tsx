"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { looksLikeMarkdown } from "@/lib/mail-format";

export function MailBody({ body, html }: { body: string; html?: string }) {
  if (html?.trim()) {
    return (
      <div
        className="mail-html overflow-x-auto text-[15px] leading-relaxed break-words [&_a]:underline [&_img]:h-auto [&_img]:max-w-full [&_table]:w-full [&_table]:max-w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  if (looksLikeMarkdown(body)) {
    return (
      <div className="text-[15px] leading-7 break-words [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:font-mono [&_code]:text-[13px] [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-xl [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
      </div>
    );
  }

  return <p className="text-[15px] leading-7 whitespace-pre-wrap">{body}</p>;
}
