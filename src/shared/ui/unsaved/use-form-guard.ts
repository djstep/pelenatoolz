"use client";

import { useCallback, useEffect, useRef } from "react";
import { snapshotFields } from "@/shared/ui/unsaved/snapshot";
import { useUnsavedChanges } from "@/shared/ui/unsaved/unsaved-changes-provider";

/** Через сколько после показа формы запоминать исходные значения. */
const BASELINE_DELAY_MS = 150;
/** Повторный снимок после сохранения: страница успевает получить данные с сервера. */
const RESYNC_DELAY_MS = 600;
/** Сколько ждать ответа сервера на «Сохранить» из вопроса о переходе; дольше — не сохранилось. */
const SAVE_TIMEOUT_MS = 30_000;

/**
 * Форма на странице (не в окне): при несохранённых изменениях спрашивает при переходе
 * по ссылкам внутри программы и при закрытии вкладки. ref — на <form> или контейнер полей;
 * исходные значения запоминаются, когда форма появилась на странице (в том числе по условию).
 * После успешного сохранения вызвать markClean() — текущие значения станут исходными.
 * resetKey: сменился (форма пересоздана для другой записи) — исходные значения берутся заново.
 * saveState: состояние useActionState этой формы (ref — на <form>). Тогда в вопросе о переходе
 * есть «Сохранить»: форма отправляется как обычно, переход — только после ответа с success.
 */
export function useFormGuard<T extends HTMLElement = HTMLFormElement>(
  enabled = true,
  resetKey?: string | number,
  saveState?: { success?: unknown },
) {
  const unsaved = useUnsavedChanges();
  const element = useRef<T | null>(null);
  const baseline = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const saveWaiter = useRef<((ok: boolean) => void) | null>(null);
  const canSave = saveState !== undefined;

  const snapshotNow = useCallback(() => {
    if (element.current) baseline.current = snapshotFields(element.current);
  }, []);

  const snapshotLater = useCallback(
    (delay: number) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(snapshotNow, delay);
    },
    [snapshotNow],
  );

  const ref = useCallback(
    (el: T | null) => {
      element.current = el;
      baseline.current = null;
      if (el) snapshotLater(BASELINE_DELAY_MS);
    },
    [snapshotLater],
  );

  const markClean = useCallback(() => {
    snapshotNow();
    snapshotLater(RESYNC_DELAY_MS);
  }, [snapshotNow, snapshotLater]);

  // Ответ сервера на отправку формы завершает ожидающее «Сохранить».
  useEffect(() => {
    const done = saveWaiter.current;
    if (!done) return;
    saveWaiter.current = null;
    done(Boolean(saveState?.success));
  }, [saveState]);

  const save = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        const form = element.current;
        if (!(form instanceof HTMLFormElement)) {
          resolve(false);
          return;
        }
        if (!form.checkValidity()) {
          resolve(false);
          // Подсказка браузера у поля — после того как закроется вопрос.
          window.setTimeout(() => form.reportValidity(), 0);
          return;
        }
        const timeout = window.setTimeout(() => {
          if (saveWaiter.current !== finish) return;
          saveWaiter.current = null;
          resolve(false);
        }, SAVE_TIMEOUT_MS);
        const finish = (ok: boolean) => {
          window.clearTimeout(timeout);
          resolve(ok);
        };
        saveWaiter.current = finish;
        form.requestSubmit();
      }),
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    baseline.current = null;
    snapshotLater(BASELINE_DELAY_MS);
    const unregister = unsaved.register(
      () =>
        element.current !== null &&
        baseline.current !== null &&
        snapshotFields(element.current) !== baseline.current,
      canSave ? save : undefined,
    );
    return () => {
      window.clearTimeout(timer.current);
      unregister();
      baseline.current = null;
    };
  }, [enabled, unsaved, snapshotLater, resetKey, canSave, save]);

  return { ref, markClean };
}
