/** Имя участника для журнала: снимок на момент события, без почты и телефона. */
export function auditMemberName(name: string | null | undefined): string {
  return name?.trim() || "Без имени";
}
