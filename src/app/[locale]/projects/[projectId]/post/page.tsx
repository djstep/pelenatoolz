import { PostWorkspace } from "@/features/post/components/post-workspace";
import { listPostTasks } from "@/features/post/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ projectId: string }>;
};

export default async function PostPage({ params }: Props) {
  const { projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("post:read")) {
    return (
      <p className="text-sm text-[var(--danger)]">Нет доступа к постпродакшну</p>
    );
  }

  const tasks = await listPostTasks(projectId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Постпродакшн</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Пайплайн: инжест → монтаж → VFX → цвет → звук → графика → сдача
        </p>
      </div>

      <PostWorkspace
        projectId={projectId}
        tasks={tasks}
        canWrite={ctx.can("post:write")}
      />
    </div>
  );
}
