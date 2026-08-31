import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ locale: string; projectId: string; dayId: string }>;
};

export default async function ActorsEmploymentRedirectPage({ params }: Props) {
  const { locale, projectId, dayId } = await params;
  redirect(`/${locale}/projects/${projectId}/characters/employment/${dayId}`);
}
