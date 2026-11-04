import { getCallSheetSectionsEditor } from "@/features/call-sheets/elements-queries";
import { SPECIAL_TRANSPORT_KEY, OTHER_SECTION_KEY } from "@/features/call-sheets/lib/sections";
import { ResourcesIndex } from "@/features/resources/components/resources-index";
import { listResourceCategories } from "@/features/resources/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function SettingsResourcesPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const [categories, sections] = await Promise.all([
    listResourceCategories(projectId),
    // Ничего не пишет: системных разделов может не быть в базе — тогда «key:КЛЮЧ».
    getCallSheetSectionsEditor(projectId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-[27px] font-bold leading-tight">Ресурсы</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Категории и элементы ресурсов для планирования съёмок.
        </p>
      </div>
      <Card>
        <ResourcesIndex
          projectId={projectId}
          locale={locale}
          categories={categories}
          canWrite={ctx.can("script:write")}
          sections={sections
            // Спецтранспорт правится в своём блоке, «Прочее» — это «без раздела».
            .filter((s) => s.key !== SPECIAL_TRANSPORT_KEY && s.key !== OTHER_SECTION_KEY)
            .map((s) => ({ ref: s.id || `key:${s.key}`, name: s.name }))}
        />
      </Card>
    </div>
  );
}
