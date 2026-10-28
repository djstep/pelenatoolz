import { CounterpartiesShell } from "@/features/counterparties/components/counterparties-shell";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function CounterpartiesLayout({ children, params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);
  return (
    <CounterpartiesShell
      locale={locale}
      projectId={projectId}
      showDirectory={ctx.can("finance:read")}
      showContracts={ctx.can("contracts:read")}
    >
      {children}
    </CounterpartiesShell>
  );
}
