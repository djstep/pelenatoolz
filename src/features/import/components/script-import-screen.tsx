"use client";

import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import { previewScriptImportAction } from "@/features/import/actions";
import { ScriptReview } from "@/features/import/components/script-review";
import { isDocxSlimError, slimDocx } from "@/features/import/normalize/docx-slim";
import {
  formatFileSize,
  SCRIPT_IMPORT_MAX_BYTES,
  SCRIPT_SOURCE_MAX_BYTES,
  SIZE_REFUSALS,
  type ScriptPreviewState,
} from "@/features/import/review/types";
import { Button } from "@/shared/ui/button";
import { FileDropzone } from "@/shared/ui/file-dropzone";
import { useActionToast } from "@/shared/ui/toast/use-action-toast";

const initial: ScriptPreviewState = {};
const DOCX_ACCEPT =
  ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const SLIM_ERRORS = {
  not_zip: "Это не файл Word (.docx). Сохраните сценарий в Word как .docx и загрузите снова.",
  not_docx: "Это не документ Word (.docx). Сохраните сценарий в Word как .docx и загрузите снова.",
  unsupported: "Файл .docx сжат или защищён неподдерживаемым способом. Пересохраните его в Word.",
} as const;

/** Файл к отправке: облегчённый docx или почему его нельзя отправить. */
type Prepared = { source: File; slim: File | null; problem: string | null };

/**
 * Проверки в браузере — для удобства: сервер сам проверяет размер и содержимое.
 * На сервер уходит облегчённый docx (текст, стили, нумерация, связи пакета), без картинок.
 */
async function prepare(source: File): Promise<Prepared> {
  const fail = (problem: string): Prepared => ({ source, slim: null, problem });
  if (!source.name.toLowerCase().endsWith(".docx")) {
    return fail("Нужен файл Word .docx. Другие форматы не поддерживаются.");
  }
  if (source.size > SCRIPT_SOURCE_MAX_BYTES) return fail(SIZE_REFUSALS.source);
  let bytes: ReturnType<typeof slimDocx>;
  try {
    bytes = slimDocx(new Uint8Array(await source.arrayBuffer()));
  } catch (error) {
    if (isDocxSlimError(error)) return fail(SLIM_ERRORS[error.code]);
    return fail("Не удалось прочитать файл .docx. Пересохраните его в Word и загрузите снова.");
  }
  if (bytes.length > SCRIPT_IMPORT_MAX_BYTES) return fail(SIZE_REFUSALS.script);
  const slim = new File([bytes], source.name, { type: source.type });
  return { source, slim, problem: null };
}

export function ScriptImportScreen({ projectId, locale }: { projectId: string; locale: string }) {
  const [state, action, pending] = useActionState(
    // Прошлое состояние на сервер не отправляем: useActionState передал бы его аргументом —
    // это весь прошлый предпросмотр ещё раз в запросе (лимит запроса — 4 МБ).
    (_prev: ScriptPreviewState, formData: FormData) =>
      previewScriptImportAction(projectId, initial, formData),
    initial,
  );
  useActionToast(state);
  // Облегчённый файл держим в состоянии: собирается один раз, и предпросмотр и «Импортировать»
  // отправляют одни и те же байты — хэш совпадёт.
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [preparing, setPreparing] = useState(false);
  const latest = useRef<File | null>(null);

  function pick(file: File | null) {
    latest.current = file;
    setPrepared(null);
    if (!file) return;
    setPreparing(true);
    void prepare(file).then((next) => {
      // Пока собирали, выбрали другой файл — этот не нужен.
      if (latest.current !== file) return;
      setPrepared(next);
      setPreparing(false);
    });
  }

  const slim = prepared?.slim ?? null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!slim) return;
    const formData = new FormData();
    formData.append("file", slim);
    startTransition(() => action(formData));
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="glass-card space-y-4 p-6">
        <FileDropzone
          name="file"
          accept={DOCX_ACCEPT}
          disabled={pending}
          hint="Перетащите сценарий .docx сюда или нажмите, чтобы выбрать (до 50 МБ)"
          formatHint="Только Word .docx"
          onFileChange={pick}
        />
        {prepared?.problem ? (
          <p className="text-sm text-[var(--danger)]">{prepared.problem}</p>
        ) : null}
        {prepared && slim ? (
          <p className="text-xs text-[var(--muted-fg)]">
            Файл {formatFileSize(prepared.source.size)} → на сервер уйдёт {formatFileSize(slim.size)}{" "}
            (только текст, стили и нумерация, без картинок)
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending || preparing || !slim}>
            {pending ? "Разбор файла…" : preparing ? "Подготовка файла…" : "Предпросмотр"}
          </Button>
          <span className="text-xs text-[var(--muted-fg)]">
            Предпросмотр ничего не сохраняет.
          </span>
        </div>
      </form>

      {state.data && slim ? (
        <ScriptReview
          key={state.data.fileHash}
          projectId={projectId}
          locale={locale}
          file={slim}
          data={state.data}
        />
      ) : null}
    </div>
  );
}
