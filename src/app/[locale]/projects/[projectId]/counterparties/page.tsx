import { CounterpartiesWorkspace } from "@/features/counterparties/components/counterparties-workspace";
import {
  listCompanies,
  listCounterparties,
} from "@/features/counterparties/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function CounterpartiesPage({ params }: Props) {
  const { projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("finance:read")) {
    return (
      <p className="text-sm text-[var(--danger)]">Нет доступа к финансам</p>
    );
  }

  const [companies, counterparties] = await Promise.all([
    listCompanies(projectId),
    listCounterparties(projectId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Контрагенты</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Наши юрлица (источники платежей) и сторонние получатели. Часто
          используемые выше в списках выбора.
        </p>
      </div>

      <CounterpartiesWorkspace
        projectId={projectId}
        companies={companies}
        counterparties={counterparties}
        canWrite={ctx.can("finance:write")}
      />
    </div>
  );
}
