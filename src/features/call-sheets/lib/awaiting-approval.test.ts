import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import nodeModule from "node:module";
import path from "node:path";
import { before, describe, test } from "node:test";
import type { Permission } from "@/features/memberships/permissions";
import {
  AWAITING_APPROVAL_FILTER,
  awaitingApprovalCount,
  isAwaitingApproval,
} from "@/features/call-sheets/lib/awaiting-approval";
import { statusButtonsFor } from "@/features/call-sheets/lib/status-commands";

// project-nav-groups.ts → role-rules.ts — серверный модуль ("server-only"):
// берём его с условием react-server, как в members-pages-access.test.ts.
type ResolveContext = { conditions: string[] };
type RegisterHooks = (hooks: {
  resolve: (
    specifier: string,
    context: ResolveContext,
    nextResolve: (specifier: string, context: ResolveContext) => unknown,
  ) => unknown;
}) => void;
(nodeModule as unknown as { registerHooks: RegisterHooks }).registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return nextResolve(specifier, {
        ...context,
        conditions: [...context.conditions, "react-server"],
      });
    }
    return nextResolve(specifier, context);
  },
});

let nav: typeof import("@/features/projects/lib/project-nav-groups");
before(async () => {
  nav = await import("@/features/projects/lib/project-nav-groups");
});

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8").replace(/\r\n/g, "\n");
const canOnly =
  (...allowed: Permission[]) =>
  (permission: Permission) =>
    allowed.includes(permission);

describe("вызывные на согласовании: счётчик и фильтр", () => {
  test("счётчик — только с правом «Вызывные — утверждение»; без права в базу не ходит", async () => {
    let calls = 0;
    const count = async () => {
      calls += 1;
      return 3;
    };
    assert.equal(await awaitingApprovalCount(canOnly("callsheet:read", "callsheet:write"), count), null);
    assert.equal(calls, 0, "без права запроса нет");
    assert.equal(await awaitingApprovalCount(canOnly("callsheet:approve"), count), 3);
    assert.equal(calls, 1);
  });

  test("запрос счётчика — count по статусу «на согласовании», вызывные не загружаются", () => {
    const queries = source("src/features/call-sheets/queries.ts");
    const fn = queries.slice(queries.indexOf("export async function countCallSheetsAwaitingApproval"));
    assert.match(fn, /prisma\.callSheet\.count\(\{\s*where: \{ projectId, status: "IN_REVIEW"/);
    assert.ok(!/findMany|findFirst/.test(fn.slice(0, fn.indexOf("\n}\n"))));

    const layout = source("src/app/[locale]/projects/[projectId]/layout.tsx");
    assert.ok(layout.includes("awaitingApprovalCount(ctx.can, () =>"));
    assert.ok(layout.includes("countCallSheetsAwaitingApproval(projectId)"));
    assert.ok(layout.includes(`"/call-sheets",`));
  });

  test("счётчик в меню — у пункта «Вызывные»; нет или 0 — меню не меняется", () => {
    const groups = [
      {
        id: "planning",
        items: [
          { href: "/schedule", label: "КПП" },
          { href: "/call-sheets", label: "Вызывные" },
        ],
      },
    ];
    assert.equal(nav.withNavCount(groups, "/call-sheets", null), groups);
    assert.equal(nav.withNavCount(groups, "/call-sheets", 0), groups);
    const withCount = nav.withNavCount(groups, "/call-sheets", 2);
    assert.deepEqual(withCount[0]!.items, [
      { href: "/schedule", label: "КПП" },
      { href: "/call-sheets", label: "Вызывные", count: 2 },
    ]);
  });

  test("список вызывных: «Ждут утверждения» и фильтр — только с правом", () => {
    assert.equal(isAwaitingApproval({ status: "IN_REVIEW" }), true);
    assert.equal(isAwaitingApproval({ status: "DRAFT" }), false);
    assert.equal(isAwaitingApproval({ status: "APPROVED" }), false);
    assert.equal(isAwaitingApproval(null), false);

    const page = source("src/app/[locale]/projects/[projectId]/call-sheets/page.tsx");
    assert.ok(page.includes("const canApprove = ctx.can(CALL_SHEET_APPROVE_PERMISSION);"));
    assert.ok(page.includes("const onlyAwaiting = canApprove && filter === AWAITING_APPROVAL_FILTER;"));
    assert.ok(page.includes("canApprove ? { count: awaiting.length, active: onlyAwaiting } : undefined"));
    assert.equal(AWAITING_APPROVAL_FILTER, "review");
  });
});

describe("панель статуса: кнопки и короткие тексты", () => {
  const editor = { canEdit: true, canApprove: false };
  const approver = { canEdit: false, canApprove: true };
  const both = { canEdit: true, canApprove: true };
  const labels = (status: "DRAFT" | "IN_REVIEW" | "APPROVED", rights: typeof editor) =>
    statusButtonsFor({ status, version: 2 }, rights).map((b) => b.label);

  test("«Утвердить» — только с правом утверждения", () => {
    assert.deepEqual(labels("IN_REVIEW", editor), ["Вернуть в черновик"]);
    assert.deepEqual(labels("IN_REVIEW", approver), ["Утвердить", "Вернуть в черновик"]);
    assert.deepEqual(labels("IN_REVIEW", both), ["Утвердить", "Вернуть в черновик"]);
    for (const status of ["DRAFT", "APPROVED"] as const) {
      assert.ok(!labels(status, both).includes("Утвердить"), status);
    }
    assert.deepEqual(labels("DRAFT", editor), ["На согласование"]);
    assert.deepEqual(labels("DRAFT", approver), []);
    assert.deepEqual(labels("APPROVED", editor), ["Внести изменения"]);
    assert.deepEqual(labels("APPROVED", approver), []);
  });

  test("подтверждение — одна строка без пояснений; сообщение после перехода — одно-два слова", () => {
    const all = (["DRAFT", "IN_REVIEW", "APPROVED"] as const).flatMap((status) =>
      statusButtonsFor({ status, version: 2 }, both),
    );
    assert.deepEqual(
      Object.fromEntries(all.map((b) => [b.command, b.done])),
      {
        submit: "Отправлено на согласование",
        approve: "Утверждено",
        return: "Возвращено в черновик",
        reopen: "Черновик версии 3",
      },
    );
    for (const b of all) {
      assert.ok(!("details" in b), b.command);
      assert.ok(!/утвердить (его )?(сможет|может)|уведом|участник/i.test(b.confirmTitle), b.command);
    }

    const panel = source("src/features/call-sheets/components/call-sheet-status-panel.tsx");
    assert.ok(!panel.includes("details:"), "окна без списка пояснений");
    for (const text of ["Утвердить может", "утверждён ", "approvedLabel", "только просмотр"]) {
      assert.ok(!panel.includes(text), text);
    }
    assert.ok(panel.includes("<CallSheetStatusBadge status={data.status} />"));
  });
});
