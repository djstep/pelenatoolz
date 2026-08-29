import { classifyScriptLines } from "@/features/script/lib/screenplay-lines";
import { cn } from "@/shared/lib/cn";

export function FormattedScriptContent({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const lines = classifyScriptLines(content);

  return (
    <div className={cn("script-content", className)}>
      {lines.map((line, index) => {
        if (line.type === "blank") {
          return <div key={index} className="script-line--blank" aria-hidden />;
        }
        return (
          <p
            key={index}
            className={cn("script-line", `script-line--${line.type}`)}
          >
            {line.text}
          </p>
        );
      })}
    </div>
  );
}
