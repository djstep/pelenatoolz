import { CallSheetTemplateEditor } from "@/features/call-sheets/components/call-sheet-template-editor";
import { canEditCallSheets } from "@/features/call-sheets/lib/template-rules";
import {
  getCallSheetTemplate,
  listTemplateMemberOptions,
} from "@/features/call-sheets/queries";
import { listDepartmentsForSmeta } from "@/features/departments/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function CallSheetTemplatePage({ params }: Props) {
  const { projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!canEditCallSheets(ctx)) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const [template, members, departments] = await Promise.all([
    getCallSheetTemplate(projectId),
    listTemplateMemberOptions(projectId),
    listDepartmentsForSmeta(projectId, null),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Шаблон вызывного</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Руководители, вызов цехов, база и транспорт — общие для всех вызывных проекта.
          Порядок строк меняется перетаскиванием за ⠿.
        </p>
      </div>
      <Card>
        <CallSheetTemplateEditor
          projectId={projectId}
          template={template}
          members={members}
          departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        />
      </Card>
    </div>
  );
}
