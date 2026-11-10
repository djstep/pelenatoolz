import Link from "next/link";
import { notFound } from "next/navigation";
import { listDepartmentsForSmeta } from "@/features/departments/queries";
import { listRecalcCandidates } from "@/features/smeta/approval-queries";
import { BudgetRecalcPanel } from "@/features/smeta/components/budget-recalc-panel";
import { ItemsSummaryView } from "@/features/smeta/components/items-summary-view";
import { getBudgetSummaryDriveButton } from "@/features/smeta/drive-queries";
import { getItemsSummary } from "@/features/smeta/items-summary-queries";
import { canApproveSmeta, canReadAllSmeta } from "@/features/smeta/lib/smeta-access";
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
  const view = sp.view === "articles" ? "articles" : "departments";
  const canApprove = canApproveSmeta(ctx);
  const [summary, driveButton, candidates] = await Promise.all([
    getItemsSummary(projectId, { drafts }),
    getBudgetSummaryDriveButton(ctx),
    canApprove
      ? listDepartmentsForSmeta(projectId, null).then((ds) => listRecalcCandidates(projectId, ds.map((d) => d.id)))
      : Promise.resolve([]),
  ]);
  const listHref = `/${locale}/projects/${projectId}/smeta`;
  const base = `${listHref}/summary`;
  const query = (d: boolean, v: string) => {
    const params = new URLSearchParams();
    if (d) params.set("drafts", "1");
    if (v === "articles") params.set("view", "articles");
    const s = params.toString();
    return s ? `${base}?${s}` : base;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Link href={listHref} className="text-sm text-[var(--muted-fg)] hover:underline">
        ← Сметы
      </Link>
      <h2 className="font-display text-[27px] leading-tight font-bold">Сводная</h2>
      <ItemsSummaryView
        projectId={projectId}
        summary={summary}
        view={view}
        hrefs={{
          versions: query(false, view),
          drafts: query(true, view),
          departments: query(drafts, "departments"),
          articles: query(drafts, "articles"),
        }}
        driveButton={driveButton}
        recalcPanel={
          <BudgetRecalcPanel
            projectId={projectId}
            candidates={candidates}
            smetaHref={listHref}
          />
        }
      />
    </div>
  );
}
