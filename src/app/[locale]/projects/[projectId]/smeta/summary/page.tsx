import Link from "next/link";
import { notFound } from "next/navigation";
import { SummaryBookView } from "@/features/smeta/components/summary-book-view";
import { getBudgetSummaryDriveButton } from "@/features/smeta/drive-queries";
import { canReadAllSmeta } from "@/features/smeta/lib/smeta-access";
import type { BudgetClient } from "@/features/smeta/queries";
import { getSummaryBook } from "@/features/smeta/summary-queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";

// Vercel (Fluid compute, потолок 300 с): сборка сводной, выгрузка на диск (до 50 с) и пересчёт доступов
// к папке после ответа (`after()`, до 40 с) идут в одной функции — до 120 с.
export const maxDuration = 120;

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SummaryBookPage({ params, searchParams }: Props) {
  const { locale, projectId } = await params;
  const sp = await searchParams;
  const ctx = await requireProjectContext(projectId);

  // Продюсер и «Сметы — просмотр всех». Главам цехов — как будто страницы нет.
  if (!canReadAllSmeta(ctx)) notFound();

  const drafts = sp.drafts === "1";
  const [book, driveButton] = await Promise.all([
    getSummaryBook(projectId, ctx, { drafts }),
    getBudgetSummaryDriveButton(ctx),
  ]);
  // Книга с id «summary-…» только для показа: сервер сохраняет только книгу черновика цеха.
  const sheetBook: BudgetClient = {
    id: `${book.workbook.id}-${drafts ? "drafts" : "versions"}`,
    departmentId: "summary",
    name: book.workbook.name,
    revision: 0,
    updatedAt: new Date().toISOString(),
    mainSheetKey: null,
    workbook: book.workbook,
    sheetsMeta: book.sheetsMeta,
  };
  const listHref = `/${locale}/projects/${projectId}/smeta`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Link href={listHref} className="text-sm text-[var(--muted-fg)] hover:underline">
        ← Сметы
      </Link>
      <h2 className="font-display text-[27px] font-bold leading-tight">Сводная книга</h2>
      <SummaryBookView
        projectId={projectId}
        book={sheetBook}
        drafts={drafts}
        baseHref={`${listHref}/summary`}
        listHref={listHref}
        driveButton={driveButton}
      />
    </div>
  );
}
