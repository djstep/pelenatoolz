import { requirePersonalDataConsent } from "@/features/auth/consent-gate";

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function ProjectsLayout({ children, params }: Props) {
  const { locale } = await params;
  await requirePersonalDataConsent(locale);
  return children;
}
