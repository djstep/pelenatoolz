"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/shared/ui/toast/toast-provider";

type ActionToastState = {
  success?: string;
  error?: string;
};

export function useActionToast(state: ActionToastState) {
  const toast = useToast();
  const seen = useRef<ActionToastState>({});

  useEffect(() => {
    if (state.error && state.error !== seen.current.error) {
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
