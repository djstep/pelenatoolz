import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

/**
 * Окна подтверждения: красная кнопка — только удаление и необратимое; переходы статуса,
 * утверждение, «Сделать текущей», «Вырезать» (обратимо) — обычная. Удаление сцены, которую
 * удалить нельзя, — кнопка неактивна, причина в окне. Пустой полосы под вопросом нет.
 */

function source(relative: string) {
  return readFileSync(path.join(process.cwd(), relative), "utf8").replace(/\r\n/g, "\n");
}

describe("окно подтверждения", () => {
  test("кнопка: красная по умолчанию, обычная при tone: primary; отказ — неактивна", () => {
    const provider = source("src/shared/ui/confirm/confirm-provider.tsx");
    assert.match(provider, /variant=\{open\?\.tone === "primary" \? "primary" : "danger"\}/);
    assert.match(provider, /disabled=\{busy \|\| details === null \|\| error !== null \|\| refused\}/);
    assert.match(provider, /const refused = Boolean\(open\?\.detailsAreRefusals && details && details\.length > 0\)/);
    assert.match(provider, /\{hasBody \? \(/, "без пояснений тело окна не рисуется");
    const modal = source("src/shared/ui/modal.tsx");
    assert.match(modal, /children == null \|\| children === false \? null/);
  });

  for (const [file, label] of [
    ["src/features/call-sheets/components/call-sheet-status-panel.tsx", "confirmLabel: b.confirmLabel"],
    ["src/features/smeta/components/budget-review-actions.tsx", 'confirmLabel: "Утвердить"'],
    ["src/features/screenplay/lib/confirm-make-current.ts", 'confirmLabel: "Сделать текущей"'],
    ["src/features/screenplay/components/screenplay-workspace.tsx", 'confirmLabel: "Продолжить"'],
    ["src/features/script/components/scene-editor.tsx", 'confirmLabel: "Вырезать"'],
    ["src/features/schedule/components/schedule-dnd-board.tsx", 'confirmLabel: "Убрать из дня"'],
  ] as const) {
    test(`обычная кнопка: ${path.basename(file)} (${label})`, () => {
      const text = source(file);
      const at = text.indexOf(label);
      assert.ok(at > 0, label);
      assert.match(text.slice(at, at + 200), /tone: "primary"/);
    });
  }

  test("удаление сцен: причины отказа выключают «Удалить»", () => {
    const text = source("src/features/script/components/libretto-workspace.tsx");
    const at = text.indexOf("getScenesDeleteImpactAction(projectId, selectedIds)");
    assert.match(text.slice(at, at + 200), /detailsAreRefusals: true/);
  });
});
