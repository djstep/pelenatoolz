"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  registerToastHandlers,
  unregisterToastHandlers,
} from "@/shared/ui/toast/toast-store";
import type { ToastInput, ToastRecord } from "@/shared/ui/toast/types";
import { ToastViewport } from "@/shared/ui/toast/toast-viewport";

const DEFAULT_DURATION: Record<ToastRecord["type"], number> = {
  success: 5000,
  error: 9000,
  info: 6000,
  warning: 7000,
};

type ToastContextValue = {
  push: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  success: (message: string, options?: Omit<ToastInput, "message" | "type">) => string;
  error: (message: string, options?: Omit<ToastInput, "message" | "type">) => string;
  info: (message: string, options?: Omit<ToastInput, "message" | "type">) => string;
  warning: (message: string, options?: Omit<ToastInput, "message" | "type">) => string;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function createToastId() {
  return `toast-${crypto.randomUUID()}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastRecord[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const push = useCallback((input: ToastInput) => {
    const type = input.type ?? "info";
    const id = createToastId();
    const record: ToastRecord = {
      id,
      type,
      title: input.title,
      message: input.message,
      duration: input.duration ?? DEFAULT_DURATION[type],
      createdAt: Date.now(),
    };
    setItems((prev) => [...prev.slice(-4), record]);
    return id;
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      dismiss,
      success: (message, options) =>
        push({ ...options, type: "success", message }),
      error: (message, options) => push({ ...options, type: "error", message }),
      info: (message, options) => push({ ...options, type: "info", message }),
      warning: (message, options) =>
        push({ ...options, type: "warning", message }),
    }),
    [dismiss, push],
  );

  useEffect(() => {
    registerToastHandlers({ push, dismiss });
    return unregisterToastHandlers;
  }, [dismiss, push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
