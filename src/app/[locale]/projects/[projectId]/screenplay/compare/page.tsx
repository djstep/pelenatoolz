import { notFound } from "next/navigation";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { ScreenplayVersionDiff } from "@/features/screenplay/components/screenplay-version-diff";
import {
  getScriptVersion,
  listVersionBlocks,
} from "@/features/screenplay/queries";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{ a?: string; b?: string }>;
};

export default async function ScreenplayComparePage({
  params,
  searchParams,
}: Props) {
  const { locale, projectId } = await params;
  const { a, b } = await searchParams;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  if (!a || !b) notFound();

  const [versionA, versionB] = await Promise.all([
    getScriptVersion(projectId, a),
    getScriptVersion(projectId, b),
  ]);

  if (!versionA || !versionB) notFound();

  const [blocksA, blocksB] = await Promise.all([
    listVersionBlocks(a),
    listVersionBlocks(b),
  ]);

  return (
    <ScreenplayVersionDiff
      locale={locale}
      projectId={projectId}
      versionA={{
        id: versionA.id,
        versionNumber: versionA.versionNumber,
        title: versionA.title,
      }}
      versionB={{
        id: versionB.id,
        versionNumber: versionB.versionNumber,
        title: versionB.title,
      }}
      blocksA={blocksA}
      blocksB={blocksB}
    />
  );
}
