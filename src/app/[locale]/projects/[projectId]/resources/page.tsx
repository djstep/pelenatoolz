import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function ResourcesRedirectPage({ params }: Props) {
  const { locale, projectId } = await params;
  redirect(`/${locale}/projects/${projectId}/settings/resources`);
}
