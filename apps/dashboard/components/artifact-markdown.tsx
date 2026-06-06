import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { clsx } from "clsx";

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
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{children.trim()}</ReactMarkdown>
      </div>
    </div>
  );
}
