import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { changePasswordSchema, profileAuditChanges, profileSchema } from "@/features/profile/schemas";
import { isValidPhone } from "@/shared/lib/phone";

describe("смена пароля: форма", () => {
  const firstIssue = (input: Record<string, string>) =>
    changePasswordSchema.safeParse(input).error?.issues[0]?.message;

  test("всё заполнено верно", () => {
    const parsed = changePasswordSchema.safeParse({
      currentPassword: "старый",
      newPassword: "новый-длинный",
      newPasswordRepeat: "новый-длинный",
    });
    assert.equal(parsed.success, true);
  });

  test("без текущего пароля — нельзя", () => {
    assert.equal(
      firstIssue({ currentPassword: "", newPassword: "новый", newPasswordRepeat: "новый" }),
      "Введите текущий пароль",
    );
  });

  test("повтор не совпал — нельзя", () => {
    assert.equal(
      firstIssue({ currentPassword: "старый", newPassword: "новый", newPasswordRepeat: "другой" }),
      "Новый пароль и повтор не совпадают",
    );
  });

  test("новый равен текущему — нельзя", () => {
    assert.equal(
      firstIssue({ currentPassword: "тот-же", newPassword: "тот-же", newPasswordRepeat: "тот-же" }),
      "Новый пароль совпадает с текущим",
    );
  });
});

describe("телефон", () => {
  test("обычные записи номера проходят", () => {
    for (const phone of ["+7 (999) 123-45-67", "8 999 1234567", "89991234567", "12345"]) {
      assert.equal(isValidPhone(phone), true, phone);
    }
  });

  test("буквы, лишние «+» и слишком мало / много цифр — нет", () => {
    for (const phone of ["звонить вечером", "7+999", "1234", "+7 999 123 45 67 89 01 2", "+7 999 123-45-67 доб. 2"]) {
      assert.equal(isValidPhone(phone), false, phone);
    }
  });
});

describe("профиль", () => {
  test("пустые телефон и почта — null, почта приводится к нижнему регистру", () => {
    assert.deepEqual(
      profileSchema.parse({ name: "  Анна Петрова ", phone: " ", googleEmail: " Anna@Gmail.com " }),
      { name: "Анна Петрова", phone: null, googleEmail: "anna@gmail.com" },
    );
  });

  test("без имени, с плохим телефоном или почтой — ошибка", () => {
    assert.equal(profileSchema.safeParse({ name: " ", phone: "", googleEmail: "" }).success, false);
    assert.equal(profileSchema.safeParse({ name: "А", phone: "abc", googleEmail: "" }).success, false);
    assert.equal(
      profileSchema.safeParse({ name: "А", phone: "", googleEmail: "не почта" }).success,
      false,
    );
  });

  test("в журнал — имя, а телефон и почта только фактом изменения", () => {
    const changes = profileAuditChanges(
      { name: "Анна", phone: "+7 900 111-22-33", googleEmail: null },
      { name: "Анна Петрова", phone: "+7 900 999-99-99", googleEmail: "anna@gmail.com" },
    );
    assert.deepEqual(changes, {
      name: { from: "Анна", to: "Анна Петрова" },
      phoneChanged: true,
      googleEmailChanged: true,
    });
    const text = JSON.stringify(changes);
    assert.ok(!text.includes("999") && !text.includes("@"));
  });

  test("ничего не поменялось — журнал не пишется", () => {
    const same = { name: "Анна", phone: null, googleEmail: null };
    assert.deepEqual(profileAuditChanges(same, same), {});
  });
});
