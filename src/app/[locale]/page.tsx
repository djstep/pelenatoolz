import { redirect } from "next/navigation";
import { auth } from "@/auth";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function LocaleHomePage({ params }: Props) {
  const { locale } = await params;
  const session = await auth();
  redirect(session?.user ? `/${locale}/projects` : `/${locale}/login`);
}
