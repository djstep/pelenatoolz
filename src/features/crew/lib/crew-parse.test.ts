import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseContacts, parseCounterpartyName } from "@/features/crew/lib/crew-parse";

const name = (lastName: string, firstName: string | null = null, middleName: string | null = null) => ({
  lastName,
  firstName,
  middleName,
});

describe("parseCounterpartyName", () => {
  test("обычное ФИО", () => {
    assert.deepEqual(parseCounterpartyName("Иванов Иван Иванович"), name("Иванов", "Иван", "Иванович"));
    assert.deepEqual(parseCounterpartyName("  Иванов   Иван  "), name("Иванов", "Иван"));
    assert.deepEqual(parseCounterpartyName("Иванов"), name("Иванов"));
  });

  test("ИП убирается в любом написании", () => {
    const expected = name("Звуков", "Олег", "Иванович");
    for (const text of [
      "ИП Звуков Олег Иванович",
      "ип Звуков Олег Иванович",
      "ИП, Звуков Олег Иванович",
      "ИП. Звуков Олег Иванович",
      "Индивидуальный предприниматель Звуков Олег Иванович",
      "Звуков Олег Иванович ИП",
      "Звуков Олег Иванович, ИП",
      "ИП «Звуков Олег Иванович»",
      "(ИП) Звуков Олег Иванович",
    ]) {
      assert.deepEqual(parseCounterpartyName(text, "IP"), expected, text);
    }
  });

  test("«И.П.» с точками убирается только у типа ИП: иначе это инициалы", () => {
    assert.deepEqual(parseCounterpartyName("И.П. Сидоров Олег", "IP"), name("Сидоров", "Олег"));
    assert.deepEqual(parseCounterpartyName("И.П. Сидоров", "INDIVIDUAL"), name("Сидоров", "И.", "П."));
  });

  test("слова, начинающиеся на «ип», не страдают", () => {
    assert.deepEqual(parseCounterpartyName("Ипатов Иван"), name("Ипатов", "Иван"));
    assert.deepEqual(parseCounterpartyName("ИП Ипатов Иван"), name("Ипатов", "Иван"));
  });

  test("самозанятый убирается", () => {
    assert.deepEqual(parseCounterpartyName("Самозанятая Гримова Анна"), name("Гримова", "Анна"));
    assert.deepEqual(parseCounterpartyName("Гримова Анна (самозанятая)"), name("Гримова", "Анна"));
  });

  test("двойная фамилия через дефис, с пробелами и тире", () => {
    const expected = name("Петрова-Водкина", "Анна", "Сергеевна");
    assert.deepEqual(parseCounterpartyName("Петрова-Водкина Анна Сергеевна"), expected);
    assert.deepEqual(parseCounterpartyName("Петрова - Водкина Анна Сергеевна"), expected);
    assert.deepEqual(parseCounterpartyName("Петрова — Водкина Анна Сергеевна"), expected);
    assert.deepEqual(parseCounterpartyName("ИП Петрова-Водкина Анна Сергеевна"), expected);
  });

  test("двойная фамилия через пробел узнаётся по отчеству", () => {
    assert.deepEqual(
      parseCounterpartyName("Петрова Водкина Анна Сергеевна"),
      name("Петрова Водкина", "Анна", "Сергеевна"),
    );
  });

  test("оглы и кызы — часть отчества", () => {
    assert.deepEqual(parseCounterpartyName("Мамедов Али Гасан оглы"), name("Мамедов", "Али", "Гасан оглы"));
  });

  test("инициалы, в том числе слитно и перед фамилией", () => {
    assert.deepEqual(parseCounterpartyName("Иванов И.И."), name("Иванов", "И.", "И."));
    assert.deepEqual(parseCounterpartyName("И.И. Иванов"), name("Иванов", "И.", "И."));
  });

  test("после ИП ничего нет: фамилия пустая, поле заполнит человек", () => {
    assert.deepEqual(parseCounterpartyName("ИП"), name(""));
    assert.deepEqual(parseCounterpartyName("   "), name(""));
  });
});

describe("parseContacts", () => {
  test("пусто", () => {
    assert.deepEqual(parseContacts(null), { phone: null, email: null });
    assert.deepEqual(parseContacts("звонить ассистенту"), { phone: null, email: null });
  });

  test("телефон и почта вместе", () => {
    assert.deepEqual(parseContacts("+7 900 111-22-33, svetov@e2e.test"), {
      phone: "+7 900 111-22-33",
      email: "svetov@e2e.test",
    });
    assert.deepEqual(parseContacts("8 (900) 222-33-44 anna.grim@e2e.test"), {
      phone: "8 (900) 222-33-44",
      email: "anna.grim@e2e.test",
    });
  });

  test("несколько телефонов: первый", () => {
    assert.equal(parseContacts("+7 900 111-22-33, +7 900 222-33-44").phone, "+7 900 111-22-33");
    assert.equal(parseContacts("тел.: 8 900 111-22-33; 8 900 222-33-44").phone, "8 900 111-22-33");
    assert.equal(parseContacts("моб. 89001112233\n(495) 123-45-67").phone, "89001112233");
  });

  test("два телефона через пробел не слипаются", () => {
    assert.equal(parseContacts("8 900 111-22-33 8 900 222-33-44").phone, "8 900 111-22-33");
    assert.equal(parseContacts("+7 900 111 22 33 +7 900 222 33 44").phone, "+7 900 111 22 33");
  });

  test("разные написания", () => {
    assert.equal(parseContacts("тел. +7 (900) 333-44-55").phone, "+7 (900) 333-44-55");
    assert.equal(parseContacts("(495) 123-45-67 доб. 12").phone, "(495) 123-45-67");
    assert.equal(parseContacts("8.900.111.22.33").phone, "8.900.111.22.33");
    assert.equal(parseContacts("+375 29 123-45-67").phone, "+375 29 123-45-67");
    assert.equal(parseContacts("городской 123-45-67").phone, "123-45-67");
  });

  test("реквизиты и даты — не телефон", () => {
    assert.equal(parseContacts("ИНН 7701234567").phone, null);
    assert.equal(parseContacts("ИНН: 770123456789").phone, null);
    assert.equal(parseContacts("770123456789").phone, null);
    assert.equal(parseContacts("р/с 40702810900000012345").phone, null);
    assert.equal(parseContacts("паспорт 4510 123456").phone, null);
    assert.equal(parseContacts("договор от 12.05.2024").phone, null);
    assert.equal(parseContacts("от 2024-05-12").phone, null);
    assert.equal(parseContacts("ИНН 7701234567, тел. 8 900 111-22-33").phone, "8 900 111-22-33");
  });

  test("цифры в почте — не телефон", () => {
    assert.deepEqual(parseContacts("ivan89001112233@mail.ru"), {
      phone: null,
      email: "ivan89001112233@mail.ru",
    });
  });

  test("несколько почт: первая, знаки препинания вокруг не попадают", () => {
    assert.equal(parseContacts("почта: <a.b@site.ru>, c@site.ru.").email, "a.b@site.ru");
    assert.equal(parseContacts("c@site.ru.").email, "c@site.ru");
  });
});
