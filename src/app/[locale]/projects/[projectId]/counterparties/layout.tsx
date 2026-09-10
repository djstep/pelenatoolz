import { CounterpartiesShell } from "@/features/counterparties/components/counterparties-shell";

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function CounterpartiesLayout({ children, params }: Props) {
  const { locale, projectId } = await params;
  return (
    <CounterpartiesShell locale={locale} projectId={projectId}>
      {children}
    </CounterpartiesShell>
  );
}
