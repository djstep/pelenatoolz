import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import { estimateScreenplayTiming, timingModeHint } from "@/features/screenplay/lib/timing";

const headings = [
  "НАТ. ЗАГОРОДНЫЙ ДОМ — РАССВЕТ (00:15)",
  "ИНТ. ДОМ. КУХНЯ — УТРО (ПОЗЖЕ) (02:05)",
  "ИНТ. ДОМ. ДЕТСКАЯ / КОРИДОР — ДЕНЬ (01:40)",
];
const blocks: ScreenplayBlock[] = headings.map((content, sortOrder) => ({
  id: String(sortOrder),
  type: "SLUGLINE",
  content,
  sceneId: `s${sortOrder}`,
  sortOrder,
}));
blocks.push({ id: "action", type: "ACTION", content: "Часы на стене (12:30).", sceneId: "s0", sortOrder: 3 });
const plans = (seconds: (number | null)[]) =>
  seconds.map((planSeconds, i) => ({ sceneId: `s${i}`, planSeconds }));

describe("итог сценария в режиме «Из файла»", () => {
  test("план сцен пуст — складываются все метки, а не первая", () => {
    const timing = estimateScreenplayTiming(blocks, "IMPORTED", 1, plans([null, null, null]));
    assert.equal(timing.seconds, 240);
    assert.equal(timing.label, "4:00");
  });

  test("план сцен заполнен — главнее меток", () => {
    assert.equal(estimateScreenplayTiming(blocks, "IMPORTED", 1, plans([10, 20, 30])).seconds, 60);
  });

  test("вырезанная сцена не считается", () => {
    const refs = [...plans([10, 20]), { sceneId: "s2", planSeconds: 30, cut: true }];
    assert.equal(estimateScreenplayTiming(blocks, "IMPORTED", 1, refs).seconds, 30);
  });
});

test("подсказка «Вручную» говорит, куда вводить", () => {
  const hint = timingModeHint("MANUAL", 1);
  assert.match(hint, /карточке сцены/);
  assert.match(hint, /Хронометраж сцены/);
  assert.match(hint, /План/);
});
