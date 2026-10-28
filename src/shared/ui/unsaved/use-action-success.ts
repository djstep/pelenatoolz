"use client";

import { useEffect, useRef } from "react";

/**
 * Вызывает onSuccess один раз на каждый успешный ответ сервера из useActionState.
 * Без этого эффект «если успех — закрыть» срабатывает снова при каждой отрисовке
 * родителя (onClose — новая функция), и окно, открытое повторно, сразу закрывается.
 */
export function useActionSuccess<S extends { success?: unknown }>(
  state: S,
  onSuccess: (state: S) => void,
) {
  const handled = useRef(state);
  const callback = useRef(onSuccess);
  useEffect(() => {
    callback.current = onSuccess;
  });
  useEffect(() => {
    if (handled.current === state) return;
    handled.current = state;
    if (state.success) callback.current(state);
  }, [state]);
}
