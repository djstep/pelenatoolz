/**
 * Снимок значений полей внутри элемента: всё, что человек может изменить.
 * Поля с name (включая скрытые — в них лежат выбранные компания, тип и т.п.)
 * и поля без name (формы, которые сохраняют обработчиком) — по порядку, а также
 * выбранные файлы. Служебные поля Next.js ($ACTION_…) и всё внутри
 * [data-unsaved-ignore] (поиск в выпадающих списках, настройки окна) пропускаются.
 * Два снимка равны — значит, изменений нет (в том числе если вернули как было).
 */
export function snapshotFields(root: Element): string {
  const values: [string, string][] = [];
  root
    .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "input, select, textarea",
    )
    .forEach((el, index) => {
      if (el.closest("[data-unsaved-ignore]")) return;
      if (el instanceof HTMLInputElement) {
        if (["submit", "button", "reset", "image"].includes(el.type)) return;
        if (el.type === "file") {
          const names = Array.from(el.files ?? []).map((f) => f.name);
          if (names.length) values.push([`file:${el.name || el.id}`, names.join("|")]);
          return;
        }
      }
      if (el.name.startsWith("$ACTION")) return;
      if (!el.name && el.type === "hidden") return;
      const key = el.name || `#${index}`;
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        values.push([key, el.checked ? `on:${el.value}` : "off"]);
        return;
      }
      if (el instanceof HTMLSelectElement && el.multiple) {
        values.push([
          key,
          Array.from(el.selectedOptions)
            .map((o) => o.value)
            .join("|"),
        ]);
        return;
      }
      values.push([key, el.value]);
    });
  return JSON.stringify(values);
}
