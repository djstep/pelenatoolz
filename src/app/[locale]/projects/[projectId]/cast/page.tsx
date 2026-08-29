import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function CastRedirectPage({ params }: Props) {
  const { locale, projectId } = await params;
  redirect(`/${locale}/projects/${projectId}/actors`);
}
