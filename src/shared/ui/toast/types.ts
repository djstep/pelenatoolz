export type ToastType = "success" | "error" | "info" | "warning";

export type ToastInput = {
  type?: ToastType;
  title?: string;
  message: string;
  duration?: number;
};

export type ToastRecord = ToastInput & {
  id: string;
  type: ToastType;
  duration: number;
  createdAt: number;
};
