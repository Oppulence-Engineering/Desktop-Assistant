import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function stripFrontmatter(raw: string) {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}

/**
 * Render Fumadocs collection files through remark instead of the compiled MDX
 * component. The collection still owns frontmatter and slugs; this keeps the
 * article body on the existing marketing React tree without a second client
 * runtime for MDX.
 */
export function MarkdownBody({ raw }: { raw: string }) {
  return (
    <ReactMarkdown
      components={{
        a: ({ href = "", children }) =>
          href.startsWith("/") ? (
            <Link href={href}>{children}</Link>
          ) : (
            <a href={href} rel="noreferrer" target="_blank">
              {children}
            </a>
          ),
      }}
      remarkPlugins={[remarkGfm]}
    >
      {stripFrontmatter(raw)}
    </ReactMarkdown>
  );
}
