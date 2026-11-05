export function CounterpartiesShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-[27px] font-bold leading-tight">Контрагенты</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Юрлица, контрагенты, договоры и акты
        </p>
      </div>

      {children}
    </div>
  );
}
