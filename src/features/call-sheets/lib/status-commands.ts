/**
 * Кнопки статуса на странице вызывного: какие показать и короткие тексты (кнопка, окно
 * подтверждения, сообщение после перехода). Права проверяет сервер (`status-rules.ts`);
 * здесь — те же правила, чтобы не показывать кнопку, которая всё равно получит отказ.
 */

import type { CallSheetStatusValue } from "@/features/call-sheets/lib/revision";
import {
  canRunStatusCommand,
  type StatusCommand,
  type StatusRights,
} from "@/features/call-sheets/lib/status-rules";

export type StatusButton = {
  command: StatusCommand;
  label: string;
  secondary: boolean;
  /** Вопрос окна подтверждения — одной строкой. */
  confirmTitle: string;
  confirmLabel: string;
  /** Сообщение после перехода — одно-два слова. */
  done: string;
};

const FROM: Record<CallSheetStatusValue, StatusCommand[]> = {
  DRAFT: ["submit"],
  IN_REVIEW: ["approve", "return"],
  APPROVED: ["reopen"],
};

function button(command: StatusCommand, version: number): StatusButton {
  switch (command) {
    case "submit":
      return {
        command,
        label: "На согласование",
        secondary: false,
        confirmTitle: "Отправить на согласование?",
        confirmLabel: "Отправить",
        done: "Отправлено на согласование",
      };
    case "approve":
      return {
        command,
        label: "Утвердить",
        secondary: false,
        confirmTitle: `Утвердить версию ${version}?`,
        confirmLabel: "Утвердить",
        done: "Утверждено",
      };
    case "return":
      return {
        command,
        label: "Вернуть в черновик",
        secondary: true,
        confirmTitle: "Вернуть в черновик?",
        confirmLabel: "Вернуть",
        done: "Возвращено в черновик",
      };
    case "reopen":
      return {
        command,
        label: "Внести изменения",
        secondary: true,
        confirmTitle: `Создать черновик версии ${version + 1}?`,
        confirmLabel: "Создать",
        done: `Черновик версии ${version + 1}`,
      };
  }
}

export function statusButtonsFor(
  sheet: { status: CallSheetStatusValue; version: number },
  rights: StatusRights,
): StatusButton[] {
  return FROM[sheet.status]
    .filter((command) => canRunStatusCommand(command, rights))
    .map((command) => button(command, sheet.version));
}
