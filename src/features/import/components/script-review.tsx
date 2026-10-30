"use client";

import { Fragment, useMemo, useState } from "react";
import {
  normalizeScript,
  QUESTION_TYPES,
  type NormalizeQuestion,
  type QuestionGroup,
} from "@/features/import/normalize/normalize-script";
import type { TitlePage } from "@/features/import/normalize/title-page";
import { QuestionCard, SceneDiff } from "@/features/import/components/script-review-parts";
import {
  GROUP_TITLES,
  NOTICE_TEXT,
  ruleText,
  visibleOptions,
} from "@/features/import/review/question-text";
import { previewTimings } from "@/features/import/review/timing";
import { formatFileSize, type ScriptReviewData } from "@/features/import/review/types";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { useFormGuard } from "@/shared/ui/unsaved/use-form-guard";

const GROUPS: QuestionGroup[] = ["title", "scenes", "characters", "locations", "blocks"];

const TITLE_FIELDS: { key: keyof Omit<TitlePage, "other" | "contacts">; label: string }[] = [
  { key: "title", label: "Название" },
  { key: "subtitle", label: "Подзаголовок" },
  { key: "author", label: "Автор" },
  { key: "version", label: "Версия" },
  { key: "date", label: "Дата" },
  { key: "city", label: "Город" },
];

type TitleEdits = Partial<Record<(typeof TITLE_FIELDS)[number]["key"], string>>;

/**
 * Экран проверки импорта. Ничего не пишет: ответы и правки титульной живут в браузере,
 * нормализация пересчитывается здесь же на каждый ответ.
 */
export function ScriptReview({ data }: { data: ScriptReviewData }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [titleEdits, setTitleEdits] = useState<TitleEdits>({});
  const [openScene, setOpenScene] = useState<number | null>(null);
  const [timeForAll, setTimeForAll] = useState("");
  const { ref: formRef } = useFormGuard<HTMLFormElement>(true, data.fileHash);

  const result = useMemo(
    () =>
      normalizeScript(data.typing, answers, {
        dictionary: data.dictionary,
        existing: data.existing,
      }),
    [data, answers],
  );
  const timings = useMemo(
    () => previewTimings(result, data.timing.mode, data.timing.pageToMinuteRatio),
    [result, data.timing],
  );
  const fileKeys = useMemo(
    () =>
      new Set([
        ...result.characters.flatMap((c) => c.sourceKeys),
        ...result.locations.flatMap((l) => l.sourceKeys),
      ]),
    [result],
  );

  const answer = (code: string, value: string) =>
    setAnswers((prev) => ({ ...prev, [code]: value }));
  const answerAll = (questions: NormalizeQuestion[], value: (q: NormalizeQuestion) => string) =>
    setAnswers((prev) => {
      const next = { ...prev };
      for (const q of questions) next[q.code] = value(q);
      return next;
    });

  const byGroup = (group: QuestionGroup) => result.questions.filter((q) => q.group === group);
  const requiredLeft = result.questions.filter((q) => q.required && !answers[q.code]).length;
  const newCharacters = result.characters.filter((c) => !c.existingId).length;
  const newLocations = result.locations.filter((l) => !l.existing).length;

  const questionList = (questions: NormalizeQuestion[]) =>
    questions.map((q) => (
      <QuestionCard
        key={q.code}
        q={q}
        answered={answers[q.code]}
        existing={data.existing}
        fileKeys={fileKeys}
        onAnswer={(value) => answer(q.code, value)}
      />
    ));

  /** «Принять все» — только у однозначных правок; «режим не указан» — одно значение на всех. */
  const acceptAllControls = (questions: NormalizeQuestion[]) => {
    const simple = questions.filter((q) => q.acceptAll && q.type !== QUESTION_TYPES.timeMissing);
    const noTime = questions.filter((q) => q.type === QUESTION_TYPES.timeMissing);
    if (simple.length === 0 && noTime.length === 0) return null;
    return (
      <div className="flex flex-wrap items-center gap-3">
        {simple.length > 0 ? (
          <Button
            type="button"
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            onClick={() => answerAll(simple, (q) => q.suggested)}
          >
            Принять все предложенные ({simple.length})
          </Button>
        ) : null}
        {noTime.length > 0 ? (
          <span className="flex items-center gap-2 text-xs">
            Режим для всех сцен без режима:
            <select
              value={timeForAll}
              onChange={(e) => setTimeForAll(e.target.value)}
              className="glass-input h-8 rounded-lg px-2 text-xs"
            >
              <option value="">—</option>
              {visibleOptions(noTime[0]!).map((option) => (
                <option key={option} value={option}>
                  {option === "none" ? "Без режима" : option}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="secondary"
              className="px-3 py-1.5 text-xs"
              disabled={!timeForAll}
              onClick={() => answerAll(noTime, () => timeForAll)}
            >
              Поставить ({noTime.length})
            </Button>
          </span>
        ) : null}
      </div>
    );
  };

  const titlePage = result.titlePage;

  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="space-y-6">
      <section className="glass-card space-y-3 p-6">
        <h3 className="font-display text-lg font-semibold">Сводка</h3>
        <p className="text-sm text-[var(--muted-fg)]">
          {data.fileName} · {formatFileSize(data.fileSize)}
        </p>
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge>Сцен: {result.scenes.length}</Badge>
          <Badge>
            Персонажей: {result.characters.length} (новых {newCharacters})
          </Badge>
          <Badge>
            Объектов: {result.locations.length} (новых {newLocations})
          </Badge>
          <Badge>Хронометраж: {timings.total.label}</Badge>
          <Badge>Вопросов: {result.questions.length}</Badge>
          {requiredLeft > 0 ? (
            <Badge className="text-[var(--danger)]">Без ответа обязательных: {requiredLeft}</Badge>
          ) : null}
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-[var(--muted-fg)]">
            Применено правил словаря: {result.appliedRules.length}
          </summary>
          {result.appliedRules.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs">
              {result.appliedRules.map((rule) => (
                <li key={rule.code}>{ruleText(rule, data.existing)}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-[var(--muted-fg)]">Словарь проекта пока пуст.</p>
          )}
        </details>
        {result.staleRules.length > 0 ? (
          <p className="text-xs text-[var(--tone-warning)]">
            Устаревших правил словаря: {result.staleRules.length} — запись, к которой они
            привязаны, удалена. Такие вопросы заданы снова.
          </p>
        ) : null}
      </section>

      {GROUPS.map((group) => {
        const questions = byGroup(group);
        return (
          <section key={group} className="glass-card space-y-4 p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-lg font-semibold">{GROUP_TITLES[group]}</h3>
              <span className="text-xs text-[var(--muted-fg)]">
                {questions.length > 0 ? `Вопросов: ${questions.length}` : "Вопросов нет"}
              </span>
            </div>
            {acceptAllControls(questions)}

            {group === "title" ? (
              titlePage ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {TITLE_FIELDS.map(({ key, label }) => (
                    <div key={key}>
                      <Label htmlFor={`title-${key}`}>{label}</Label>
                      <Input
                        id={`title-${key}`}
                        value={titleEdits[key] ?? titlePage[key] ?? ""}
                        onChange={(e) =>
                          setTitleEdits((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                  {titlePage.other.length + titlePage.contacts.length > 0 ? (
                    <div className="sm:col-span-2 lg:col-span-3">
                      <p className="text-xs text-[var(--muted-fg)]">Прочие строки</p>
                      <p className="text-sm">
                        {[...titlePage.other, ...titlePage.contacts].join(" · ")}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-[var(--muted-fg)]">Титульной страницы в файле нет.</p>
              )
            ) : null}

            {questionList(questions)}

            {group === "scenes" ? (
              <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                <table className="w-full min-w-[44rem] text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                      <th className="px-3 py-2">№</th>
                      <th className="px-3 py-2">Шапка</th>
                      <th className="px-3 py-2">Персонажи</th>
                      <th className="px-3 py-2">Хрон.</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {result.scenes.map((scene, i) => (
                      <Fragment key={scene.index}>
                        <tr className="border-b border-[var(--border)]/50 align-top">
                          <td className="px-3 py-2 font-medium">{scene.number ?? "—"}</td>
                          <td className="px-3 py-2">{scene.heading}</td>
                          <td className="px-3 py-2">{scene.characters.join(", ")}</td>
                          <td className="px-3 py-2">{timings.scenes[i]?.label}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              className="whitespace-nowrap text-[var(--accent)] hover:underline"
                              onClick={() =>
                                setOpenScene(openScene === scene.index ? null : scene.index)
                              }
                            >
                              {openScene === scene.index ? "Скрыть" : "Было → стало"}
                            </button>
                          </td>
                        </tr>
                        {openScene === scene.index ? (
                          <tr>
                            <td colSpan={5} className="p-3">
                              <SceneDiff
                                blocks={result.blocks.filter((b) => b.sceneIndex === scene.index)}
                              />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {group === "characters" ? (
              <div className="flex flex-wrap gap-2">
                {result.characters.map((c) => (
                  <Badge key={c.key} className={c.existingId ? "" : "text-[var(--tone-success-strong)]"}>
                    {c.name}
                    {c.existingId ? " · из проекта" : " · новый"}
                    {c.speaks ? "" : " · не говорит"}
                    {c.sourceKeys.length > 1 ? ` · склеено: ${c.sourceKeys.join(", ")}` : ""}
                  </Badge>
                ))}
              </div>
            ) : null}

            {group === "locations" ? (
              <ul className="space-y-1 text-sm">
                {result.locations.map((l) => (
                  <li key={l.key}>
                    <span className="font-medium">{l.object}</span>
                    <span className="text-xs text-[var(--muted-fg)]">
                      {l.existing ? " · из проекта" : " · новый"}
                      {l.subs.length > 0 ? ` · ${l.subs.join(", ")}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {group === "blocks" && result.notices.length > 0 ? (
              <ul className="space-y-1 text-sm text-[var(--muted-fg)]">
                {result.notices.map((n) => (
                  <li key={n.code}>
                    {NOTICE_TEXT[n.code]}: {n.paragraphIndexes.length}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}

      <div className="glass-card flex flex-wrap items-center gap-3 p-6">
        <Button type="button" disabled>
          Импортировать
        </Button>
        <span className="text-xs text-[var(--muted-fg)]">
          Запись в базу ещё не подключена (шаг 6 волны). Ответы и правки пока только на этом экране.
        </span>
      </div>
    </form>
  );
}
