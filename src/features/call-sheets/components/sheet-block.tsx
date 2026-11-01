import { cn } from "@/shared/lib/cn";

/**
 * Блок экрана вызывного с заголовком в стиле печатного листа (полоса, подложка, линия снизу).
 * Стили — `.sheet-block` / `.sheet-block-head` в `globals.css`; подзаголовки внутри — `.sheet-subhead`.
 */
export function SheetBlock({
  title,
  actions,
  className,
  children,
}: {
  title: string;
  /** Кнопки справа от заголовка. */
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("sheet-block min-w-0", className)}>
      <div className="sheet-block-head">
        <h3>{title}</h3>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
