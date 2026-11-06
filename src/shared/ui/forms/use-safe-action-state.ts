"use client";

import { useActionState } from "react";
import { isNetworkError, NO_CONNECTION_ERROR } from "@/shared/ui/forms/network-error";
import { useToast } from "@/shared/ui/toast/toast-provider";

/**
 * useActionState для форм: обрыв связи не роняет страницу на экран ошибки, форма остаётся
 * с введёнными данными. Состояние — новый объект с error: на него отвечают вопрос при уходе
 * и подсказка в форме. Остальные ошибки и redirect проходят как обычно.
 */
export function useSafeActionState<State, Payload = FormData>(
  action: (state: Awaited<State>, payload: Payload) => State | Promise<State>,
  initialState: Awaited<State>,
  permalink?: string,
) {
  const toast = useToast();
  return useActionState<State, Payload>(
    async (state, payload) => {
      try {
        return await action(state, payload);
      } catch (error) {
        if (!isNetworkError(error)) throw error;
        toast.error(NO_CONNECTION_ERROR);
        return { ...state, success: undefined, error: NO_CONNECTION_ERROR } as State;
      }
    },
    initialState,
    permalink,
  );
}
