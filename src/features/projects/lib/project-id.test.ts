import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isProjectId } from "@/features/projects/lib/project-id";

describe("isProjectId", () => {
  test("настоящие id проходят", () => {
    assert.equal(isProjectId("cmw55kg0x0008dwcoqeoetkv0"), true);
    assert.equal(isProjectId("a1b2-c3_d4"), true);
  });

  test("фильтры Prisma, массивы и мусор не проходят", () => {
    const forged: unknown[] = [
      { not: "x" },
      { in: ["a", "b"] },
      ["cmw55kg0x0008dwcoqeoetkv0"],
      "",
      "a".repeat(65),
      "../etc",
      "id with space",
      null,
      undefined,
      42,
    ];
    for (const value of forged) assert.equal(isProjectId(value), false, JSON.stringify(value));
  });
});
