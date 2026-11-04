import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PERSONAL_DATA_CONSENT_REQUIRED } from "@/features/auth/lib/personal-data-consent";
import { registerSchema } from "@/features/auth/schemas";

const form = {
  firstName: "Иван",
  lastName: "Петров",
  email: "ivan.petrov@example.com",
  password: "сцена-вторник-48-дубль",
  personalDataConsent: "on",
};

describe("registerSchema: согласие на обработку персональных данных", () => {
  test("галочка стоит — проходит", () => {
    assert.equal(registerSchema.safeParse(form).success, true);
  });

  test("галочки нет — отказ с понятным текстом", () => {
    for (const personalDataConsent of [null, undefined, "", "off"]) {
      const parsed = registerSchema.safeParse({ ...form, personalDataConsent });
      assert.equal(parsed.success, false, String(personalDataConsent));
      assert.equal(parsed.error?.issues[0]?.message, PERSONAL_DATA_CONSENT_REQUIRED);
    }
  });
});

describe("registerSchema: пароль", () => {
  test("равен части почты до @ — отказ по полю пароля", () => {
    const parsed = registerSchema.safeParse({ ...form, password: "ivan.petrov" });
    assert.equal(parsed.success, false);
    assert.deepEqual(parsed.error?.issues[0]?.path, ["password"]);
  });
});
