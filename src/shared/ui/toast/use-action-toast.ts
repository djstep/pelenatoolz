"use client";

import { useEffect, useRef } from "react";
import { NO_CONNECTION_ERROR } from "@/shared/ui/forms/network-error";
import { useToast } from "@/shared/ui/toast/toast-provider";

type ActionToastState = {
  success?: string;
  error?: string;
};

export function useActionToast(state: ActionToastState) {
  const toast = useToast();
  const seen = useRef<ActionToastState>({});

  useEffect(() => {
    // Обрыв показывает сама отправка: при повторном обрыве текст тот же, а тост нужен снова.
    if (state.error && state.error !== seen.current.error && state.error !== NO_CONNECTION_ERROR) {
      toast.error(state.error);
    }
    if (state.success && state.success !== seen.current.success) {
      toast.success(state.success);
    }
    seen.current = {
      success: state.success,
      error: state.error,
    };
  }, [state.error, state.success, toast]);
}
