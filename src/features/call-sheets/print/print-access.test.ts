import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { DAY_NOT_FOUND, NO_RIGHTS } from "@/features/call-sheets/lib/template-rules";
import {
  attachmentDisposition,
  callSheetFileBaseName,
  checkCallSheetRead,
  NOT_WORKING_DAY,
  type CallSheetReadDeps,
} from "@/features/call-sheets/print/print-source";

/** Печать / PDF и Excel вызывного: право, день проекта, имя файла. */

function deps(overrides: Partial<CallSheetReadDeps> & { days?: Record<string, boolean> } = {}) {
  const asked: string[] = [];
  const days = overrides.days ?? { d1: true };
  return {
    asked,
    deps: {
      canRead: overrides.canRead ?? true,
      dayInProject:
        overrides.dayInProject ??
        (async (id: string) => {
          asked.push(id);
          return id in days ? { working: days[id] } : null;
        }),
    } satisfies CallSheetReadDeps,
  };
}

function source(relative: string) {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("право на печать и Excel вызывного", () => {
  test("без права — отказ 403 до обращения к базе", async () => {
    const { asked, deps: d } = deps({ canRead: false });
    assert.deepEqual(await checkCallSheetRead(d, "d1"), { error: NO_RIGHTS, status: 403 });
    assert.deepEqual(asked, []);
  });

  test("день чужого проекта (или нет такого) — отказ 404", async () => {
    const { deps: d } = deps({ days: { d1: true } });
    assert.deepEqual(await checkCallSheetRead(d, "чужой"), { error: DAY_NOT_FOUND, status: 404 });
  });

  test("нерабочий день — отказ", async () => {
    const { deps: d } = deps({ days: { off: false } });
    assert.deepEqual(await checkCallSheetRead(d, "off"), { error: NOT_WORKING_DAY, status: 404 });
  });

  test("пустой, не строка или слишком длинный id — отказ без базы", async () => {
    for (const bad of ["", "  ", 42, null, undefined, "x".repeat(101)]) {
      const { asked, deps: d } = deps();
      assert.deepEqual(await checkCallSheetRead(d, bad), { error: DAY_NOT_FOUND, status: 404 });
      assert.deepEqual(asked, []);
    }
  });

  test("свой рабочий день — можно", async () => {
    const { deps: d } = deps();
    assert.deepEqual(await checkCallSheetRead(d, "d1"), { dayId: "d1" });
  });

  test("печать и Excel идут через одну проверку: вход и проект → право → день проекта", () => {
    const loader = source("src/features/call-sheets/print/load-print-model.ts");
    const ctxAt = loader.indexOf("await requireProjectContext(projectId)");
    const gateAt = loader.indexOf("await checkCallSheetRead(");
    const loadAt = loader.indexOf("getShootDayDocument(projectId, gate.dayId)");
    assert.ok(ctxAt > 0 && ctxAt < gateAt && gateAt < loadAt, "requireProjectContext → checkCallSheetRead → данные");
    assert.match(loader, /callsheet:read"\) \|\| ctx\.can\("schedule:read"\)/);
    assert.match(loader, /where: \{ id, projectId \}/, "день ищется только в своём проекте");
    assert.doesNotMatch(loader, /\.(create|update|upsert|delete)(Many)?\(/, "ничего не пишет");

    const action = source("src/features/call-sheets/print-actions.ts");
    assert.match(action, /^"use server";/);
    assert.equal((action.match(/^export /gm) ?? []).length, 1, "одна публичная функция");
    assert.match(action, /await loadCallSheetPrintModel\(projectId, dayId\)/);

    const route = source("src/app/api/projects/[projectId]/call-sheets/[dayId]/xlsx/route.ts");
    assert.match(route, /await loadCallSheetPrintModel\(projectId, dayId\)/);
    assert.match(route, /attachmentDisposition\(/);
  });

  test("старого формата нет: PDF через pdfkit, печать FilmToolz, base64-экспорт", () => {
    const actions = source("src/features/day-docs/actions.ts");
    for (const gone of [
      "exportCallSheetPdfAction",
      "exportCallSheetXlsxAction",
      "exportCallSheetPrintHtmlAction",
      "saveDepartmentCallsAction",
    ]) {
      assert.ok(!actions.includes(gone), gone);
    }
    const menu = source("src/features/day-docs/components/day-docs-export-menu.tsx");
    assert.ok(!menu.includes("Вызывной PDF"));
    assert.ok(menu.includes("Печать / PDF"));
    const pkg = JSON.parse(source("package.json")) as { dependencies: Record<string, string> };
    for (const name of ["pdfkit", "@types/pdfkit", "dejavu-fonts-ttf"]) {
      assert.ok(!(name in pkg.dependencies), name);
    }
  });
});

describe("имя файла вызывного", () => {
  test("проект, дата, смена; запрещённые символы убраны", () => {
    assert.equal(
      callSheetFileBaseName({ projectName: "ИРП", numericDate: "11.09.2026", shiftNumber: 40 }),
      "Вызывной ИРП 11.09.2026 смена 40",
    );
    assert.equal(
      callSheetFileBaseName({ projectName: 'А/Б: "В"\n<Г>', numericDate: "01.11.2026", shiftNumber: null }),
      "Вызывной А Б В Г 01.11.2026",
    );
  });

  test("Content-Disposition: attachment, кириллица — filename*=UTF-8''", () => {
    const header = attachmentDisposition("Вызывной ИРП 11.09.2026.xlsx");
    assert.match(header, /^attachment; /);
    assert.match(header, /filename="[\x20-\x7e]+"/, "запасное имя — только ASCII");
    const encoded = header.match(/filename\*=UTF-8''(.+)$/)?.[1];
    assert.ok(encoded);
    assert.doesNotMatch(encoded, /[^A-Za-z0-9%._~!$&+,=:@-]/, "без пробелов и кавычек");
    assert.equal(decodeURIComponent(encoded), "Вызывной ИРП 11.09.2026.xlsx");
    assert.doesNotMatch(attachmentDisposition('a"b\\c.xlsx'), /filename="[^"]*["\\][^"]*"/);
  });
});
