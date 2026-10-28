/**
 * Снимок значений формы внутри элемента: то, что ушло бы на сервер при сохранении.
 * Берутся поля с name (включая скрытые — в них лежат выбранные компания, тип и т.п.)
 * и выбранные файлы. Служебные поля Next.js ($ACTION_…) и всё внутри
 * [data-unsaved-ignore] (настройки окна, а не данные) пропускаются.
 * Два снимка равны — значит, изменений нет (в том числе если вернули как было).
 */
export function snapshotFields(root: Element): string {
  const values: [string, string][] = [];
  root
    .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "input, select, textarea",
    )
    .forEach((el) => {
      if (el.closest("[data-unsaved-ignore]")) return;
      if (el instanceof HTMLInputElement) {
        if (["submit", "button", "reset", "image"].includes(el.type)) return;
        if (el.type === "file") {
          const names = Array.from(el.files ?? []).map((f) => f.name);
          if (names.length) values.push([`file:${el.name || el.id}`, names.join("|")]);
          return;
        }
      }
      if (!el.name || el.name.startsWith("$ACTION")) return;
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        values.push([el.name, el.checked ? `on:${el.value}` : "off"]);
        return;
      }
      if (el instanceof HTMLSelectElement && el.multiple) {
        values.push([
          el.name,
          Array.from(el.selectedOptions)
            .map((o) => o.value)
            .join("|"),
        ]);
        return;
      }
      values.push([el.name, el.value]);
    });
  return JSON.stringify(values);
}
