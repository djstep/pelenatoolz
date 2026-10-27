import { redirect } from "next/navigation";
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
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("finance:read")) {
    // Справочник недоступен, но договоры можно смотреть — сразу к ним.
    if (ctx.can("contracts:read")) {
      redirect(`/${locale}/projects/${projectId}/counterparties/contracts`);
    }
    return (
      <p className="text-sm text-[var(--danger)]">Нет доступа к финансам</p>
    );
  }

  const [companies, counterparties] = await Promise.all([
    listCompanies(projectId),
    listCounterparties(projectId),
  ]);

  return (
    <CounterpartiesWorkspace
      projectId={projectId}
      locale={locale}
      companies={companies}
      counterparties={counterparties}
      canWrite={ctx.can("finance:write")}
    />
  );
}
