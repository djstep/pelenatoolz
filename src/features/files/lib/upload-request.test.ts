import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MAX_UPLOAD_BYTES, readUploadHead, UPLOAD_NAME_HEADER, UPLOAD_SCOPE_HEADER } from "./upload-request";

const headers = (values: Record<string, string>) =>
  new Headers({ [UPLOAD_NAME_HEADER]: encodeURIComponent("проба 1.mov"), ...values });

describe("заголовки загрузки", () => {
  test("обычная загрузка", () => {
    assert.deepEqual(readUploadHead(headers({ "content-type": "video/quicktime", "content-length": "10" })), {
      name: "проба 1.mov",
      type: "video/quicktime",
      declaredBytes: 10,
      contractsOnly: false,
    });
  });

  test("неизвестный тип — пусто, файл договора отмечен", () => {
    const head = readUploadHead(
      headers({ "content-type": "application/octet-stream", [UPLOAD_SCOPE_HEADER]: "contract" }),
    );
    assert.ok(!("error" in head));
    assert.equal(head.type, "");
    assert.equal(head.contractsOnly, true);
    assert.equal(head.declaredBytes, null);
  });

  test("старая вкладка с формой получает просьбу обновить страницу", () => {
    const head = readUploadHead(headers({ "content-type": "multipart/form-data; boundary=x" }));
    assert.ok("error" in head);
    assert.equal(head.status, 415);
  });

  test("нет имени или оно испорчено", () => {
    for (const name of ["", "%E0%A4%A"]) {
      const head = readUploadHead(new Headers({ [UPLOAD_NAME_HEADER]: name }));
      assert.ok("error" in head, name);
      assert.equal(head.status, 400);
    }
  });

  test("пустой и слишком большой файл отклоняются до чтения тела", () => {
    assert.ok("error" in readUploadHead(headers({ "content-length": "0" })));
    assert.ok("error" in readUploadHead(headers({ "content-length": String(MAX_UPLOAD_BYTES + 1) })));
    assert.ok(!("error" in readUploadHead(headers({ "content-length": String(MAX_UPLOAD_BYTES) }))));
  });

  test("длинное имя обрезается", () => {
    const head = readUploadHead(new Headers({ [UPLOAD_NAME_HEADER]: encodeURIComponent("я".repeat(300)) }));
    assert.ok(!("error" in head));
    assert.equal(head.name.length, 255);
  });
});
