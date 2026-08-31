import type { ToastInput, ToastRecord } from "@/shared/ui/toast/types";

type PushToast = (input: ToastInput) => string;
type DismissToast = (id: string) => void;

let pushToast: PushToast | null = null;
let dismissToast: DismissToast | null = null;

export function registerToastHandlers(handlers: {
  push: PushToast;
  dismiss: DismissToast;
}) {
  pushToast = handlers.push;
  dismissToast = handlers.dismiss;
}

export function unregisterToastHandlers() {
  pushToast = null;
  dismissToast = null;
}

function show(input: ToastInput) {
  return pushToast?.(input) ?? "";
}

export const toast = {
  show,
  success: (message: string, options?: Omit<ToastInput, "message" | "type">) =>
    show({ ...options, type: "success", message }),
  error: (message: string, options?: Omit<ToastInput, "message" | "type">) =>
    show({ ...options, type: "error", message }),
  info: (message: string, options?: Omit<ToastInput, "message" | "type">) =>
    show({ ...options, type: "info", message }),
  warning: (message: string, options?: Omit<ToastInput, "message" | "type">) =>
    show({ ...options, type: "warning", message }),
  dismiss: (id: string) => dismissToast?.(id),
};
