import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ locale: string; projectId: string; categoryId: string }>;
};

export default async function ResourceCategoryRedirectPage({ params }: Props) {
  const { locale, projectId, categoryId } = await params;
  redirect(`/${locale}/projects/${projectId}/settings/resources/${categoryId}`);
}
