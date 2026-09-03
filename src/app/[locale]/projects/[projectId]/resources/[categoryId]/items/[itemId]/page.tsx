import { redirect } from "next/navigation";

type Props = {
  params: Promise<{
    locale: string;
    projectId: string;
    categoryId: string;
    itemId: string;
  }>;
};

export default async function ResourceItemRedirectPage({ params }: Props) {
  const { locale, projectId, categoryId, itemId } = await params;
  redirect(
    `/${locale}/projects/${projectId}/settings/resources/${categoryId}/items/${itemId}`,
  );
}
