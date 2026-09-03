"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { ProjectStatus, ProjectType, TimingMode } from "@prisma/client";
import {
  createProjectAction,
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

const initial: ActionState = {};

export function CreateProjectForm() {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const [state, action, pending] = useActionState(createProjectAction, initial);
  const [projectType, setProjectType] = useState<ProjectType>(ProjectType.FEATURE);
  const [timingMode, setTimingMode] = useState<TimingMode>(TimingMode.MINUTES);
  const [shootOnFilm, setShootOnFilm] = useState(false);
  const [episodeRuntime, setEpisodeRuntime] = useState("");
  const [plannedDailyOutput, setPlannedDailyOutput] = useState("");

  return (
    <form action={action} className="glass-card max-w-3xl space-y-6 p-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label htmlFor="name">{t("name")} *</Label>
          <Input id="name" name="name" required minLength={2} />
        </div>
        <div>
          <Label htmlFor="fullName">Полное название</Label>
          <Input id="fullName" name="fullName" />
        </div>
        <div>
          <Label htmlFor="status">{t("status")}</Label>
          <Select id="status" name="status" defaultValue={ProjectStatus.DRAFT}>
            {Object.values(ProjectStatus).map((status) => (
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
          />
        </div>
      </div>

      <div>
        <Label className="mb-2 block">Тип проекта *</Label>
        <div className="flex flex-wrap gap-2">
          {Object.values(ProjectType).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setProjectType(type)}
              className={cn(
                "rounded-lg border px-4 py-2 text-sm transition",
                projectType === type
                  ? "border-[var(--accent)] bg-[var(--accent)]/20 font-medium text-[var(--foreground)]"
                  : "border-[var(--border)] bg-white/5 hover:bg-white/10",
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
            <Label htmlFor="episodeCount">Количество серий *</Label>
            <Input
              id="episodeCount"
              name="episodeCount"
              type="number"
              min={1}
              required
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
            />
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="startDate">Дата начала</Label>
          <Input id="startDate" name="startDate" type="date" />
        </div>
        <div>
          <Label htmlFor="endDate">Дата завершения</Label>
          <Input id="endDate" name="endDate" type="date" />
        </div>
        <div>
          <Label htmlFor="shootingDaysCount">Количество съёмочных дней</Label>
          <Input
            id="shootingDaysCount"
            name="shootingDaysCount"
            type="number"
            min={1}
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
            placeholder="1"
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
            placeholder="1"
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
          />
        </div>
      </div>

      <div>
        <Label className="mb-2 block">Учёт хронометража</Label>
        <SegmentControl
          name="timingMode"
          value={timingMode}
          onChange={setTimingMode}
          options={Object.values(TimingMode).map((mode) => ({
            value: mode,
            label: `В ${timingModeLabels[mode]}`,
          }))}
        />
        {timingMode === TimingMode.PAGES ? (
          <div className="mt-3">
            <Label htmlFor="pageToMinuteRatio">
              Коэффициент: 1 страница = … мин
            </Label>
            <Input
              id="pageToMinuteRatio"
              name="pageToMinuteRatio"
              type="number"
              step="0.01"
              min={0.1}
              placeholder="1"
              className="max-w-[8rem]"
            />
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <Checkbox
          name="shootOnFilm"
          checked={shootOnFilm}
          onChange={(e) => setShootOnFilm(e.target.checked)}
          label="Съёмка на плёнку"
        />
        {shootOnFilm ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="filmType">Тип плёнки</Label>
              <Input id="filmType" name="filmType" placeholder="35 мм." />
            </div>
            <div>
              <Label htmlFor="filmCoefficient">Коэффициент плёнки</Label>
              <Input
                id="filmCoefficient"
                name="filmCoefficient"
                type="number"
                step="0.1"
                placeholder="5"
              />
            </div>
          </div>
        ) : null}
      </div>

      <ProjectLocationFields
        currencyLabelText={t("currency")}
        timezoneLabelText={t("timezone")}
      />

      {state.error ? (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("loading") : t("create")}
      </Button>
    </form>
  );
}
