"use client";

import { useActionState, useState } from "react";
import {
  ProjectStatus,
  ProjectType,
  TimingMode,
  type Project,
} from "@prisma/client";
import {
  updateProjectAction,
  type ActionState,
} from "@/features/projects/actions";
import {
  formatMinutesHhMm,
  projectStatusLabels,
  projectTypeLabels,
  timingModeLabels,
} from "@/shared/i18n/domain-labels";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { ProjectLocationFields } from "@/features/projects/components/project-location-fields";
import { HhMmInput } from "@/shared/ui/hh-mm-input";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { SegmentControl } from "@/shared/ui/segment-control";
import { Select } from "@/shared/ui/select";
import { cn } from "@/shared/lib/cn";
import { useActionToast } from "@/shared/ui/toast";

const initial: ActionState = {};

function formatDateInput(value: Date | null | undefined) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export function ProjectSettingsForm({ project }: { project: Project }) {
  const bound = updateProjectAction.bind(null, project.id);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);
  const [projectType, setProjectType] = useState(project.type);
  const [timingMode, setTimingMode] = useState(project.timingMode);
  const [shootOnFilm, setShootOnFilm] = useState(project.shootOnFilm);
  const [episodeRuntime, setEpisodeRuntime] = useState(
    () => formatMinutesHhMm(project.episodeRuntimeMin) || "",
  );
  const [plannedDailyOutput, setPlannedDailyOutput] = useState(() => {
    if (project.plannedDailyOutputMin == null) return "";
    return formatMinutesHhMm(Math.round(Number(project.plannedDailyOutputMin)));
  });

  const isArchived = project.status === ProjectStatus.ARCHIVED;

  return (
    <form action={action} className="space-y-6">
      {isArchived ? (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
          Проект в архиве. Для редактирования сначала восстановите его.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label htmlFor="name">Название *</Label>
          <Input
            id="name"
            name="name"
            required
            minLength={2}
            defaultValue={project.name}
            disabled={isArchived}
          />
        </div>
        <div>
          <Label htmlFor="fullName">Полное название</Label>
          <Input
            id="fullName"
            name="fullName"
            defaultValue={project.fullName ?? ""}
            disabled={isArchived}
          />
        </div>
        <div>
          <Label htmlFor="status">Статус</Label>
          <Select
            id="status"
            name="status"
            defaultValue={project.status}
            disabled={isArchived}
          >
            {Object.values(ProjectStatus)
              .filter((s) => s !== ProjectStatus.ARCHIVED)
              .map((status) => (
                <option key={status} value={status}>
                  {projectStatusLabels[status]}
                </option>
              ))}
          </Select>
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="description">Описание</Label>
          <textarea
            id="description"
            name="description"
            rows={3}
            className="glass-input w-full resize-y px-3 py-2 text-sm"
            defaultValue={project.description ?? ""}
            disabled={isArchived}
          />
        </div>
      </div>

      <div>
        <Label className="mb-2 block">Тип проекта</Label>
        <div className="flex flex-wrap gap-2">
          {Object.values(ProjectType).map((type) => (
            <button
              key={type}
              type="button"
              disabled={isArchived}
              onClick={() => setProjectType(type)}
              className={cn(
                "rounded-lg border px-4 py-2 text-sm transition",
                projectType === type
                  ? "border-[var(--accent)] bg-[var(--accent)]/20 font-medium text-[var(--foreground)]"
                  : "border-[var(--border)] bg-white/5 hover:bg-white/10",
                isArchived && "opacity-50 cursor-not-allowed",
              )}
            >
              {projectTypeLabels[type]}
            </button>
          ))}
        </div>
        <input type="hidden" name="type" value={projectType} />
      </div>

      {projectType === ProjectType.SERIES ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="episodeCount">Количество серий</Label>
            <Input
              id="episodeCount"
              name="episodeCount"
              type="number"
              min={1}
              defaultValue={project.episodeCount ?? undefined}
              disabled={isArchived}
            />
          </div>
          <div>
            <Label htmlFor="episodeRuntimeMin">Хронометраж серии</Label>
            <input type="hidden" name="episodeRuntimeMin" value={episodeRuntime} />
            <HhMmInput
              id="episodeRuntimeMin"
              mode="duration"
              value={episodeRuntime}
              onChange={setEpisodeRuntime}
              placeholder="00:40"
              disabled={isArchived}
            />
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="startDate">Дата начала</Label>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={formatDateInput(project.startDate)}
            disabled={isArchived}
          />
        </div>
        <div>
          <Label htmlFor="endDate">Дата завершения</Label>
          <Input
            id="endDate"
            name="endDate"
            type="date"
            defaultValue={formatDateInput(project.endDate)}
            disabled={isArchived}
          />
        </div>
        <div>
          <Label htmlFor="shootingDaysCount">Количество съёмочных дней</Label>
          <Input
            id="shootingDaysCount"
            name="shootingDaysCount"
            type="number"
            min={1}
            defaultValue={project.shootingDaysCount ?? undefined}
            disabled={isArchived}
          />
        </div>
        <div>
          <Label htmlFor="cameraUnits">Кол-во съёмочных групп</Label>
          <Input
            id="cameraUnits"
            name="cameraUnits"
            type="number"
            min={1}
            max={10}
            defaultValue={project.cameraUnits ?? undefined}
            disabled={isArchived}
          />
        </div>
        <div>
          <Label htmlFor="cameraCount">Кол-во камер</Label>
          <Input
            id="cameraCount"
            name="cameraCount"
            type="number"
            min={1}
            max={10}
            defaultValue={project.cameraCount ?? undefined}
            disabled={isArchived}
          />
        </div>
        <div>
          <Label htmlFor="plannedDailyOutputMin">Плановая выработка</Label>
          <input type="hidden" name="plannedDailyOutputMin" value={plannedDailyOutput} />
          <HhMmInput
            id="plannedDailyOutputMin"
            mode="duration"
            value={plannedDailyOutput}
            onChange={setPlannedDailyOutput}
            placeholder="08:00"
            disabled={isArchived}
          />
        </div>
      </div>

      <div>
        <Label className="mb-2 block">Учёт хронометража</Label>
        <SegmentControl
          name="timingMode"
          value={timingMode}
          onChange={setTimingMode}
          disabled={isArchived}
          options={Object.values(TimingMode).map((mode) => ({
            value: mode,
            label: `В ${timingModeLabels[mode]}`,
          }))}
        />
        {timingMode === TimingMode.PAGES ? (
          <div className="mt-3">
            <Label htmlFor="pageToMinuteRatio">1 страница = … мин</Label>
            <Input
              id="pageToMinuteRatio"
              name="pageToMinuteRatio"
              type="number"
              step="0.01"
              min={0.1}
              defaultValue={Number(project.pageToMinuteRatio)}
              className="max-w-[8rem]"
              disabled={isArchived}
            />
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <Checkbox
          name="shootOnFilm"
          checked={shootOnFilm}
          disabled={isArchived}
          onChange={(e) => setShootOnFilm(e.target.checked)}
          label="Съёмка на плёнку"
        />
        {shootOnFilm ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="filmType">Тип плёнки</Label>
              <Input
                id="filmType"
                name="filmType"
                defaultValue={project.filmType ?? ""}
                disabled={isArchived}
              />
            </div>
            <div>
              <Label htmlFor="filmCoefficient">Коэффициент плёнки</Label>
              <Input
                id="filmCoefficient"
                name="filmCoefficient"
                type="number"
                step="0.1"
                defaultValue={
                  project.filmCoefficient != null
                    ? Number(project.filmCoefficient)
                    : undefined
                }
                disabled={isArchived}
              />
            </div>
          </div>
        ) : null}
      </div>

      <ProjectLocationFields
        initialCity={project.city ?? ""}
        initialCurrency={project.currency}
        initialTimezone={project.timezone}
        disabled={isArchived}
      />

      {!isArchived ? (
        <Button type="submit" disabled={pending}>
          {pending ? "Сохранение…" : "Сохранить изменения"}
        </Button>
      ) : null}
    </form>
  );
}
