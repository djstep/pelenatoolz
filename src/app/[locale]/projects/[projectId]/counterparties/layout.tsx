import { CounterpartiesShell } from "@/features/counterparties/components/counterparties-shell";

type Props = {
  children: React.ReactNode;
};

// Вкладки — в общей разметке проекта; права страницы раздела проверяют сами.
export default function CounterpartiesLayout({ children }: Props) {
  return <CounterpartiesShell>{children}</CounterpartiesShell>;
}
