import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { clsx } from "clsx";
import { CodeBlock } from "@/components/code-block";

// Renders an artifact markdown body. Fenced code blocks route through <CodeBlock> for
// syntax highlighting + copy; inline code keeps the lightweight chip style from
// .artifact-doc. Headings carry slug ids so a section TOC can anchor to them.
export function ArtifactMarkdown({
  children,
  className,
}: {
  readonly children: string;
  readonly className?: string;
}) {
  return (
    <div className={clsx("artifact-doc-shell", className)}>
      <div className="artifact-doc">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
          {children.trim()}
        </ReactMarkdown>
      </div>
    </div>
  );
}

const MARKDOWN_COMPONENTS: Components = {
  code({ className, children, ...props }) {
    const text = childrenToString(children);
    const match = /language-(\w[\w-]*)/.exec(className ?? "");
    // Fenced blocks carry a language- class (even ```\n... gets matched as a block via
    // the newline heuristic); inline code does not and stays a chip.
    if (match || text.includes("\n")) {
      return <CodeBlock code={text} lang={match?.[1] ?? "text"} />;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  // CodeBlock renders its own <figure>; don't wrap it in markdown's default <pre>.
  pre({ children }) {
    return <>{children}</>;
  },
  h2: (props) => <h2 id={slugFromChildren(props.children)} {...props} />,
  h3: (props) => <h3 id={slugFromChildren(props.children)} {...props} />,
};

function childrenToString(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(childrenToString).join("");
  if (typeof children === "number") return String(children);
  return "";
}

export function slugFromChildren(children: React.ReactNode): string {
  return childrenToString(children)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
