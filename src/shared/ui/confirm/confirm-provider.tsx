"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/shared/ui/button";
import { Modal } from "@/shared/ui/modal";

export type ConfirmRequest = {
  /** Что делаем, с названием: «Удалить платёж № 12?» */
  title: string;
  /**
   * Что удалится или отвяжется вместе с объектом — по строке на пункт.
   * Функция — загрузить при открытии окна (например, числа с сервера).
   */
  details?: string[] | (() => Promise<string[]>);
  /** Текст красной кнопки, по умолчанию «Удалить». */
  confirmLabel?: string;
  /**
   * Само действие. Вернуть текст — сервер отказал: окно остаётся и показывает причину.
   * Ничего не вернуть — готово, окно закрывается.
   */
  action: () => Promise<string | null | undefined | void>;
};

type Confirm = (request: ConfirmRequest) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

/** Спросить подтверждение и выполнить действие. true — выполнено, false — отменено или отказ. */
export function useConfirm(): Confirm {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm: нет ConfirmProvider");
  return ctx;
}

type Open = ConfirmRequest & { resolve: (done: boolean) => void };

/**
 * Общее окно подтверждения удаления и других необратимых действий:
 * «Удалить» (красная) / «Отмена», фокус на «Отмена» — Enter ничего не удаляет.
 * Пока действие выполняется, кнопки неактивны и окно не закрывается.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null);
  const [details, setDetails] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const openRef = useRef<Open | null>(null);

  const confirm = useCallback<Confirm>(
    (request) =>
      new Promise<boolean>((resolve) => {
        const next: Open = { ...request, resolve };
        openRef.current = next;
        setOpen(next);
        setError(null);
        if (typeof request.details === "function") {
          setDetails(null);
          request
            .details()
            .then((lines) => {
              if (openRef.current === next) setDetails(lines);
            })
            .catch(() => {
              if (openRef.current === next) setDetails([]);
            });
        } else {
          setDetails(request.details ?? []);
        }
      }),
    [],
  );

  const finish = useCallback((done: boolean) => {
    const current = openRef.current;
    openRef.current = null;
    setOpen(null);
    current?.resolve(done);
  }, []);

  const cancel = useCallback(() => {
    if (busyRef.current) return;
    finish(false);
  }, [finish]);

  const run = useCallback(async () => {
    const current = openRef.current;
    if (!current || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    let refusal: string | null = null;
    try {
      refusal = (await current.action()) || null;
    } catch {
      refusal = "Не удалось выполнить. Попробуйте ещё раз.";
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
    if (refusal) setError(refusal);
    else finish(true);
  }, [finish]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={open !== null}
        onClose={cancel}
        title={open?.title ?? ""}
        footer={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="danger"
              disabled={busy || details === null || error !== null}
              onClick={() => void run()}
            >
              {busy ? "Выполняется…" : (open?.confirmLabel ?? "Удалить")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              autoFocus
              disabled={busy}
              onClick={cancel}
            >
              Отмена
            </Button>
          </div>
        }
      >
        {details === null ? (
          <p className="text-sm text-[var(--muted-fg)]">Проверяем связанные данные…</p>
        ) : details.length > 0 ? (
          <ul className="space-y-1 text-sm text-[var(--muted-fg)]">
            {details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}
      </Modal>
    </ConfirmContext.Provider>
  );
}
