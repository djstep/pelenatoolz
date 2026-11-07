export type AuditionDraftState = {
  videoFileId?: string;
  uploadStatus: "idle" | "uploading" | "done" | "error";
  uploadError?: string;
  externalUrl: string;
  date: string;
};

/** Почему пробу нельзя сохранить. Обязательны только дата и файл или ссылка. */
export function auditionDraftProblem(draft: AuditionDraftState): string | null {
  if (draft.uploadStatus === "uploading") return "Дождитесь окончания загрузки файла";
  if (!draft.videoFileId && !draft.externalUrl.trim()) {
    return draft.uploadStatus === "error"
      ? `Файл не загрузился: ${draft.uploadError ?? "ошибка"}. Выберите другой файл или укажите ссылку`
      : "Выберите файл или укажите ссылку";
  }
  if (!draft.date) return "Укажите дату съёмки пробы";
  return null;
}
