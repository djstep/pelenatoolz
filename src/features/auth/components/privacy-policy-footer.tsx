import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** Подвал страниц входа и регистрации: ссылка на политику. Новая вкладка не сбрасывает заполненную форму. */
export async function PrivacyPolicyFooter({ locale }: { locale: string }) {
  const t = await getTranslations("auth");

  return (
    <footer className="mt-6 text-center text-xs text-[var(--muted-fg)]">
      <Link
        href={`/${locale}/privacy`}
        target="_blank"
        className="underline-offset-2 hover:underline"
        data-testid="privacy-footer-link"
      >
        {t("privacyPolicyLink")}
      </Link>
    </footer>
  );
}
