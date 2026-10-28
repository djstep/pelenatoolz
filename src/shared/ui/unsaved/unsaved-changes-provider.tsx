"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";

export type UnsavedChoice = "stay" | "discard" | "save";

/** Сохранить изменения источника: true — сохранено, false — ошибка (её показывает сама форма). */
export type UnsavedSave = () => Promise<boolean>;

type ConfirmOptions = {
  /** Показать «Сохранить»; ответ "save" — сохраняет тот, кто спрашивал. */
  canSave?: boolean;
  /**
   * Показать «Сохранить» и сохранить здесь же: пока идёт сохранение, кнопки неактивны.
   * Успех — ответ "save", ошибка — "stay" (вопрос закрывается, ошибка видна в форме).
   */
  onSave?: UnsavedSave;
};

type Prompt = {
  canSave: boolean;
  onSave?: UnsavedSave;
  resolve: (choice: UnsavedChoice) => void;
};

type Source = { isDirty: () => boolean; save?: UnsavedSave };

type UnsavedChangesApi = {
  /**
   * Источник несохранённых изменений (окно, форма на странице). Возвращает отписку.
   * save — если источник умеет сохраняться сам: тогда при переходе по ссылке в вопросе есть «Сохранить».
   */
  register: (isDirty: () => boolean, save?: UnsavedSave) => () => void;
  /** Спросить, что делать с изменениями. */
  confirm: (opts?: ConfirmOptions) => Promise<UnsavedChoice>;
  /** Идёт ли сейчас вопрос (чтобы окна не реагировали на Esc под ним). */
  isPrompting: () => boolean;
  /** Есть ли где-то несохранённые изменения (например, перед скрытием редактора). */
  hasUnsaved: () => boolean;
};

const UnsavedChangesContext = createContext<UnsavedChangesApi | null>(null);

export function useUnsavedChanges(): UnsavedChangesApi {
  const ctx = useContext(UnsavedChangesContext);
  if (!ctx) throw new Error("useUnsavedChanges: нет UnsavedChangesProvider");
  return ctx;
}

/**
 * Общий механизм предупреждения о несохранённых изменениях:
 * реестр «грязных» источников, перехват переходов по ссылкам внутри программы,
 * штатное предупреждение браузера при закрытии и перезагрузке вкладки.
 * Окно вопроса одно на всё приложение.
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const sources = useRef(new Map<number, Source>());
  const nextId = useRef(1);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const promptRef = useRef<Prompt | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const anyDirty = useCallback(() => {
    for (const source of sources.current.values()) {
      if (source.isDirty()) return true;
    }
    return false;
  }, []);

  const confirm = useCallback(
    (opts?: ConfirmOptions) =>
      new Promise<UnsavedChoice>((resolve) => {
        const p: Prompt = {
          canSave: Boolean(opts?.canSave || opts?.onSave),
          onSave: opts?.onSave,
          resolve,
        };
        promptRef.current = p;
        setPrompt(p);
      }),
    [],
  );

  const answer = useCallback((choice: UnsavedChoice) => {
    if (savingRef.current) return;
    const p = promptRef.current;
    promptRef.current = null;
    setPrompt(null);
    p?.resolve(choice);
  }, []);

  const save = useCallback(async () => {
    const p = promptRef.current;
    if (!p?.onSave) {
      answer("save");
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    let ok = false;
    try {
      ok = await p.onSave();
    } catch {
      ok = false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    answer(ok ? "save" : "stay");
  }, [answer]);

  const api = useMemo<UnsavedChangesApi>(
    () => ({
      register: (isDirty, save) => {
        const id = nextId.current++;
        sources.current.set(id, { isDirty, save });
        return () => {
          sources.current.delete(id);
        };
      },
      confirm,
      isPrompting: () => promptRef.current !== null,
      hasUnsaved: anyDirty,
    }),
    [confirm, anyDirty],
  );

  // Закрытие и перезагрузка вкладки — штатное предупреждение браузера.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!anyDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [anyDirty]);

  // Переходы по ссылкам внутри программы (меню, «← К списку» и т.п.).
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.target && link.target !== "_self") return;
      if (link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return; // якорь на той же странице
      }
      const dirty = [...sources.current.values()].filter((source) => source.isDirty());
      if (dirty.length === 0) return;
      // Не даём Next.js перейти, пока человек не ответит.
      event.preventDefault();
      event.stopPropagation();
      // «Сохранить» — только если каждый источник с изменениями умеет сохраняться сам.
      const onSave = dirty.every((source) => source.save)
        ? async () => {
            for (const source of dirty) {
              if (!(await source.save!())) return false;
            }
            return true;
          }
        : undefined;
      void confirm({ onSave }).then((choice) => {
        if (choice === "stay") return;
        sources.current.clear();
        router.push(url.pathname + url.search + url.hash);
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [anyDirty, confirm, router]);

  // Esc в окне вопроса — «Остаться».
  useEffect(() => {
    if (!prompt) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      answer("stay");
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [prompt, answer]);

  return (
    <UnsavedChangesContext.Provider value={api}>
      {children}
      {prompt
        ? createPortal(
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
              <button
                type="button"
                className="absolute inset-0 bg-black/60"
                aria-label="Остаться"
                onClick={() => answer("stay")}
              />
              <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="unsaved-title"
                className="relative w-full max-w-sm glass-card p-5 shadow-2xl"
              >
                <h2 id="unsaved-title" className="font-display text-lg font-semibold">
                  Есть несохранённые изменения
                </h2>
                <p className="mt-1 text-sm text-[var(--muted-fg)]">
                  Если закрыть без сохранения, изменения пропадут.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {prompt.canSave ? (
                    <Button type="button" disabled={saving} onClick={() => void save()}>
                      {saving ? "Сохранение…" : "Сохранить"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    autoFocus
                    disabled={saving}
                    onClick={() => answer("stay")}
                  >
                    Остаться
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={saving}
                    onClick={() => answer("discard")}
                  >
                    Не сохранять
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </UnsavedChangesContext.Provider>
  );
}
