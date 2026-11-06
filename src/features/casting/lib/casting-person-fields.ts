/** Дата рождения для поля и показа: с сервера приходит Date, а в поле нужно ГГГГ-ММ-ДД. */
export function birthDateKey(value: Date | string) {
  return (value instanceof Date ? value.toISOString() : value).slice(0, 10);
}

/**
 * Кандидат кастинга в браузере (`pickFinanceFields`). Ставка и условия — фин. условия актёров
 * (`canFinanceRead("actors")`); телефон, почта и контакты агента — по праву просмотра кастинга.
 */
export const CASTING_PERSON_FIELDS = {
  open: [
    "id",
    "projectId",
    "photoUrl",
    "lastName",
    "firstName",
    "middleName",
    "birthDate",
    "education",
    "filmography",
    "phone",
    "email",
    "agentName",
    "agentPhone",
    "agentEmail",
    "physicalParams",
    "skills",
    "tags",
    "notes",
    "createdAt",
    "updatedAt",
    "candidates",
  ],
  finance: ["proposedRate", "proposedTerms"],
} as const;

/** Поля формы кандидата, которые сервер пишет: ставка и условия — только с фин. правкой актёров. */
export const CASTING_PERSON_INPUT_FIELDS = {
  open: [
    "lastName",
    "firstName",
    "middleName",
    "phone",
    "email",
    "agentName",
    "agentPhone",
    "agentEmail",
    "tags",
    "notes",
    "photoUrl",
    "skills",
    "birthDate",
    "education",
    "filmography",
    "physicalParams",
  ],
  finance: ["proposedRate", "proposedTerms"],
} as const;
