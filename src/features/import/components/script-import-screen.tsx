"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { previewScriptImportAction } from "@/features/import/actions";
import { ScriptReview } from "@/features/import/components/script-review";
import {
  formatMegabytes,
  SCRIPT_IMPORT_MAX_BYTES,
  type ScriptPreviewState,
} from "@/features/import/review/types";
import { Button } from "@/shared/ui/button";
import { FileDropzone } from "@/shared/ui/file-dropzone";
import { useActionToast } from "@/shared/ui/toast/use-action-toast";

const initial: ScriptPreviewState = {};
const DOCX_ACCEPT =
  ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Проверка в браузере — только для удобства: сервер проверяет размер и содержимое сам. */
function fileProblem(file: File) {
  if (!file.name.toLowerCase().endsWith(".docx")) {
    return "Нужен файл Word .docx. Другие форматы пока не поддерживаются.";
  }
  if (file.size > SCRIPT_IMPORT_MAX_BYTES) {
    return `Файл ${formatMegabytes(file.size)}, а можно не больше ${formatMegabytes(SCRIPT_IMPORT_MAX_BYTES)}. Уберите из него картинки или разделите сценарий.`;
  }
  return null;
}

export function ScriptImportScreen({ projectId, locale }: { projectId: string; locale: string }) {
  const [state, action, pending] = useActionState(
    previewScriptImportAction.bind(null, projectId),
    initial,
  );
  useActionToast(state);
  // Файл держим в состоянии: отправка формы через action сбрасывает поле файла,
  // а он нужен для повторного предпросмотра (и для «Импортировать»).
  const [file, setFile] = useState<File | null>(null);
  const problem = file ? fileProblem(file) : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || problem) return;
    const formData = new FormData();
    formData.append("file", file);
    startTransition(() => action(formData));
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="glass-card space-y-4 p-6">
        <FileDropzone
          name="file"
          accept={DOCX_ACCEPT}
          disabled={pending}
          hint="Перетащите сценарий .docx сюда или нажмите, чтобы выбрать (до 3,5 МБ)"
          formatHint="Только Word .docx"
          onFileChange={setFile}
        />
        {problem ? <p className="text-sm text-[var(--danger)]">{problem}</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending || !file || Boolean(problem)}>
            {pending ? "Разбор файла…" : "Предпросмотр"}
          </Button>
          <span className="text-xs text-[var(--muted-fg)]">
            Предпросмотр ничего не сохраняет.
          </span>
        </div>
      </form>

      {state.data && file ? (
        <ScriptReview
          key={state.data.fileHash}
          projectId={projectId}
          locale={locale}
          file={file}
          data={state.data}
        />
      ) : null}
    </div>
  );
}
