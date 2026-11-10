"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { importItemsAction, readItemsImportFileAction, type ImportItemsResult, type ImportSheet } from "@/features/smeta/items-actions";
import {
  columnLetter,
  guessHeaderRow,
  guessMapping,
  IMPORT_FIELDS,
  splitRows,
  type ImportFieldId,
  type ImportMapping,
} from "@/features/smeta/lib/items-import";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { toast } from "@/shared/ui/toast";

export type ImportTargetArticle = { id: string; name: string; subarticles: { id: string; name: string }[] };

const NONE = "";

/**
 * «Импорт из Excel»: файл → лист, строка заголовков и колонки (узнаются по заголовкам, можно
 * поправить) → куда класть новые строки → предпросмотр → «Проверить» и «Загрузить». Строки
 * с кодом из нашей выгрузки обновляются, без кода — добавляются. Хоть одна ошибка — ничего
 * не загружается, ошибки — по номерам строк листа.
 */
export function BudgetItemsImport({
  projectId,
  departmentId,
  articles,
  beforeImport,
  onRevision,
}: {
  projectId: string;
  departmentId: string;
  articles: ImportTargetArticle[];
  beforeImport: () => Promise<boolean>;
  onRevision: (revision: number) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<ImportSheet[] | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [target, setTarget] = useState("");
  const [newSubName, setNewSubName] = useState("");
  const [result, setResult] = useState<ImportItemsResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const sheet = sheets?.[sheetIndex] ?? null;
  const header = sheet?.rows[headerRow] ?? [];
  const width = sheet ? Math.max(0, ...sheet.rows.map((r) => r.length)) : 0;
  const split = useMemo(
    () => (sheet ? splitRows(sheet.rows, headerRow, mapping) : { rows: [], skipped: [] }),
    [sheet, headerRow, mapping],
  );
  const rows = split.rows;
  const hasCode = mapping.code !== undefined;

  function reset() {
    setSheets(null);
    setFileName("");
    setResult(null);
    setFileError(null);
    setTarget("");
    setNewSubName("");
  }

  function chooseSheet(index: number, list: ImportSheet[]) {
    setSheetIndex(index);
    const h = guessHeaderRow(list[index].rows);
    setHeaderRow(h);
    setMapping(guessMapping(list[index].rows[h] ?? []));
    setResult(null);
  }

  function upload(file: File) {
    setFileError(null);
    setResult(null);
    start(async () => {
      const form = new FormData();
      form.set("file", file);
      const res = await readItemsImportFileAction(projectId, departmentId, form);
      if ("error" in res) {
        setFileError(res.error);
        return;
      }
      setFileName(file.name);
      setSheets(res.sheets);
      chooseSheet(0, res.sheets);
    });
  }

  function run(dryRun: boolean) {
    start(async () => {
      if (!dryRun && !(await beforeImport())) {
        toast.error("Сначала должны сохраниться правки строк — импорт не начат");
        return;
      }
      const targetValue = target.startsWith("sub:")
        ? { subarticleId: target.slice(4) }
        : target.startsWith("new:")
          ? { articleId: target.slice(4), newSubarticleName: newSubName }
          : null;
      const res = await importItemsAction(projectId, departmentId, {
        fileName,
        fields: IMPORT_FIELDS.map((f) => f.id).filter((id) => mapping[id] !== undefined),
        rows,
        target: targetValue,
        dryRun,
      });
      setResult(res);
      if (!dryRun && !res.error && !res.errors) {
        if (res.revision) onRevision(res.revision);
        toast.success(res.success ?? "Загружено");
        setOpen(false);
        reset();
        router.refresh();
      }
    });
  }

  const targetOptions = articles.flatMap((a) => [
    ...a.subarticles.map((s) => ({ value: `sub:${s.id}`, label: `${a.name} / ${s.name}` })),
    { value: `new:${a.id}`, label: `${a.name} / новая подстатья…` },
  ]);
  const preview = rows.slice(0, 12);
  const previewFields: ImportFieldId[] = IMPORT_FIELDS.map((f) => f.id).filter((id) => mapping[id] !== undefined);

  return (
    <>
      <Button type="button" variant="secondary" className="h-8" onClick={() => setOpen(true)}>
        Импорт из Excel
      </Button>
      {open ? (
        <Modal
          open
          wide
          title="Импорт из Excel в смету"
          onClose={() => {
            setOpen(false);
            reset();
          }}
          footer={
            sheets ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="secondary" disabled={pending || rows.length === 0} onClick={() => run(true)}>
                  {pending ? "…" : "Проверить"}
                </Button>
                <Button type="button" disabled={pending || rows.length === 0} onClick={() => run(false)}>
                  {pending ? "…" : `Загрузить (${rows.length})`}
                </Button>
                <Button type="button" variant="ghost" onClick={reset}>
                  Другой файл
                </Button>
              </div>
            ) : null
          }
        >
          {!sheets ? (
            <div className="space-y-3 text-sm">
              <p className="text-[var(--muted-fg)]">
                Файл .xlsx до 3,5 МБ. Если в листе есть колонка «Код» из нашей выгрузки, строки с кодом
                обновятся, а не добавятся заново. Строки статей, подстатей и «Итого» пропускаются.
              </p>
              <Label htmlFor="items-import-file">Файл Excel</Label>
              <input
                id="items-import-file"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={pending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload(file);
                }}
              />
              {pending ? <p className="text-[var(--muted-fg)]">Читаю файл…</p> : null}
              {fileError ? (
                <p className="text-[var(--danger)]" role="alert">
                  {fileError}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                <div>
                  <Label htmlFor="items-import-sheet-trigger">Лист</Label>
                  <Select
                    id="items-import-sheet"
                    value={String(sheetIndex)}
                    onChange={(e) => chooseSheet(Number(e.target.value), sheets)}
                  >
                    {sheets.map((s, i) => (
                      <option key={i} value={String(i)}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="items-import-header">Строка заголовков</Label>
                  <Input
                    id="items-import-header"
                    type="number"
                    min={1}
                    value={headerRow + 1}
                    onChange={(e) => {
                      const n = Math.max(1, Math.min(sheet?.rows.length ?? 1, Number(e.target.value) || 1));
                      setHeaderRow(n - 1);
                      setResult(null);
                    }}
                  />
                </div>
              </div>

              <div>
                <p className="mb-2 font-medium">Колонки листа</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {IMPORT_FIELDS.map((f) => (
                    <div key={f.id}>
                      <Label htmlFor={`items-import-map-${f.id}-trigger`}>{f.label}</Label>
                      <Select
                        id={`items-import-map-${f.id}`}
                        value={mapping[f.id] === undefined ? NONE : String(mapping[f.id])}
                        onChange={(e) => {
                          const value = e.target.value;
                          setMapping((prev) => {
                            const next = { ...prev };
                            if (value === NONE) delete next[f.id];
                            else next[f.id] = Number(value);
                            return next;
                          });
                          setResult(null);
                        }}
                      >
                        <option value={NONE}>— не загружать</option>
                        {Array.from({ length: width }, (_, i) => (
                          <option key={i} value={String(i)}>
                            {`${columnLetter(i)}${header[i] ? `: ${header[i]}` : ""}`}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-[var(--muted-fg)]">
                  {hasCode
                    ? "Строки с кодом из этой сметы обновятся (меняются только загружаемые колонки), без кода — добавятся."
                    : "Колонки «Код» нет — все строки добавятся как новые."}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="items-import-target-trigger">Куда добавить новые строки</Label>
                  <Select id="items-import-target" value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">— выберите подстатью</option>
                    {targetOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
                {target.startsWith("new:") ? (
                  <div>
                    <Label htmlFor="items-import-new-sub">Название новой подстатьи</Label>
                    <Input id="items-import-new-sub" value={newSubName} maxLength={200} onChange={(e) => setNewSubName(e.target.value)} />
                  </div>
                ) : null}
              </div>

              <div>
                <p className="mb-2 font-medium">Предпросмотр: строк к загрузке — {rows.length}</p>
                {split.skipped.length > 0 ? (
                  <p className="mb-2 text-xs text-[var(--muted-fg)]" data-import-skipped>
                    Пропущено строк — {split.skipped.length} (статьи, подстатьи и «Итого» по коду и названию):{" "}
                    {split.skipped.slice(0, 30).join(", ")}
                    {split.skipped.length > 30 ? "…" : ""}
                  </p>
                ) : null}
                {preview.length === 0 ? (
                  <p className="text-[var(--muted-fg)]">Нет строк: проверьте строку заголовков и колонки.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                    <table className="w-full min-w-[640px] text-xs" aria-label="Предпросмотр импорта">
                      <thead className="bg-[var(--glass-table-head)] text-left">
                        <tr>
                          <th className="px-2 py-1.5">Строка</th>
                          {previewFields.map((id) => (
                            <th key={id} className="px-2 py-1.5">
                              {IMPORT_FIELDS.find((f) => f.id === id)!.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.map((r) => (
                          <tr key={r.row} className="border-t border-[var(--border)]/60">
                            <td className="px-2 py-1 tabular-nums">{r.row}</td>
                            {previewFields.map((id) => (
                              <td key={id} className="px-2 py-1">
                                {r.values[id] ?? ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {result ? (
                <div data-import-result>
                  {result.error ? (
                    <p className="text-[var(--danger)]" role="alert">
                      {result.error}
                    </p>
                  ) : result.errors ? (
                    <div className="rounded-md bg-[var(--row-danger)] px-3 py-2" role="alert">
                      <p className="font-medium">Ничего не загружено — исправьте строки:</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5">
                        {result.errors.map((e, i) => (
                          <li key={i}>{e.row > 0 ? `строка ${e.row}: ${e.message}` : e.message}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="rounded-md bg-[var(--row-success)] px-3 py-2">
                      {result.success}: будет добавлено — {result.created ?? 0}, обновлено — {result.updated ?? 0}, без
                      изменений — {result.unchanged ?? 0}.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </Modal>
      ) : null}
    </>
  );
}
