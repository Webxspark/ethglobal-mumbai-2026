"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { cn } from "@/lib/utils";

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), "target", "rel"],
  },
};

type Props = {
  body: string;
  className?: string;
};

export function MessageMarkdown({ body, className }: Props) {
  return (
    <div className={cn("pw-markdown", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={{
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-muted-foreground/40 underline-offset-2"
          >
            {children}
          </a>
        ),
        code: ({ className: codeClass, children, ...rest }) => {
          const inline = !codeClass;
          if (inline) {
            return (
              <code
                className="rounded bg-black/[0.06] px-1 py-0.5 font-mono text-[0.92em]"
                {...rest}
              >
                {children}
              </code>
            );
          }
          return (
            <code
              className={cn(
                "block overflow-x-auto rounded-md bg-black/[0.06] p-2 font-mono text-[12px]",
                codeClass,
              )}
              {...rest}
            >
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="my-1.5 overflow-x-auto">{children}</pre>
        ),
        p: ({ children }) => <p className="my-0.5 first:mt-0 last:mb-0">{children}</p>,
        ul: ({ children }) => (
          <ul className="my-1 list-disc pl-4 marker:text-muted-foreground">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="my-1 list-decimal pl-4 marker:text-muted-foreground">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="my-0.5">{children}</li>,
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
