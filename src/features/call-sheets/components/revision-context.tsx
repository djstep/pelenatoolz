"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { REVISION_FIELD } from "@/features/call-sheets/lib/revision";

/**
 * Номер правки вызывного в браузере: с ним уходит каждое сохранение вызывного и данных дня
 * (поле формы `revision` или аргумент действия). После сохранения действие отвечает новым
 * номером — `track` берёт его; новые данные страницы (после `revalidatePath`) — тоже.
 */
type RevisionState = {
  /** null — вызывного ещё нет. */
  revision: number | null;
  setRevision: (revision: number | null) => void;
};

const RevisionContext = createContext<RevisionState | null>(null);

export function CallSheetRevisionProvider({
  revision,
  children,
}: {
  revision: number | null;
  children: React.ReactNode;
}) {
  // Номер со страницы: пришли новые данные — берём их номер (без эффекта, во время рендера).
  const [state, setState] = useState({ fromPage: revision, current: revision });
  if (state.fromPage !== revision) setState({ fromPage: revision, current: revision });

  const setRevision = useCallback(
    (next: number | null) => setState((prev) => ({ ...prev, current: next })),
    [],
  );
  const current = state.current;
  const value = useMemo(() => ({ revision: current, setRevision }), [current, setRevision]);
  return <RevisionContext.Provider value={value}>{children}</RevisionContext.Provider>;
}

/**
 * Номер правки и `track(result)` — запомнить номер из ответа действия. Вне страницы вызывного
 * (провайдера нет) номера нет: сервер примет запись, только если вызывного нет.
 */
export function useCallSheetRevision() {
  const state = useContext(RevisionContext);
  const revision = state?.revision ?? null;
  const setRevision = state?.setRevision;
  const track = useCallback(
    <T,>(result: T): T => {
      if (result && typeof result === "object" && "revision" in result) {
        const next = (result as { revision?: number | null }).revision;
        if (next !== undefined) setRevision?.(next);
      }
      return result;
    },
    [setRevision],
  );
  return { revision, track };
}

/** Скрытое поле с номером правки — для форм вызывного. */
export function RevisionField() {
  const { revision } = useCallSheetRevision();
  return <input type="hidden" name={REVISION_FIELD} value={revision ?? ""} />;
}

/**
 * Обёртка действия формы (`useActionState`): номер правки — в FormData, новый номер из ответа —
 * в состояние. Нужна там, где форма шлёт данные не своими полями (`submitKeepingFields`).
 */
export function useRevisionAction<S>(
  action: (prev: S, formData: FormData) => Promise<S>,
): (prev: S, formData: FormData) => Promise<S> {
  const { revision, track } = useCallSheetRevision();
  return useCallback(
    async (prev: S, formData: FormData) => {
      if (!formData.has(REVISION_FIELD)) formData.set(REVISION_FIELD, revision === null ? "" : String(revision));
      return track(await action(prev, formData));
    },
    [action, revision, track],
  );
}
