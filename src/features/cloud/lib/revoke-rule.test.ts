import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  revokeIsAccountWide,
  sameProviderAccount,
  shouldRevokeAtProvider,
  type ProviderAccount,
} from "@/features/cloud/lib/revoke-rule";

const google = (accountSubject: string | null, accountEmail: string | null = null): ProviderAccount => ({
  provider: "GOOGLE_DRIVE",
  accountSubject,
  accountEmail,
});
const yandex = (accountSubject: string | null, accountEmail: string | null = null): ProviderAccount => ({
  provider: "YANDEX_DISK",
  accountSubject,
  accountEmail,
});

describe("правило отзыва токенов: другой активный доступ того же аккаунта", () => {
  test("Google — отзыв общий на аккаунт, Яндекс — только токен устройства", () => {
    assert.equal(revokeIsAccountWide("GOOGLE_DRIVE"), true);
    assert.equal(revokeIsAccountWide("YANDEX_DISK"), false);
  });

  test("Google: других подключений нет — отзываем", () => {
    assert.equal(shouldRevokeAtProvider(google("sub-1"), []), true);
  });

  test("Google: тот же аккаунт подключён ещё где-то (личный у другого человека, диск проекта) — не отзываем", () => {
    assert.equal(shouldRevokeAtProvider(google("sub-1"), [google("sub-1")]), false);
    assert.equal(shouldRevokeAtProvider(google("sub-1"), [google("sub-2"), google("sub-1")]), false);
  });

  test("Google: подключены только другие аккаунты — отзываем", () => {
    assert.equal(shouldRevokeAtProvider(google("sub-1"), [google("sub-2"), google("sub-3")]), true);
  });

  test("Google: id аккаунта решает, почта не важна, если id есть у обоих", () => {
    assert.equal(sameProviderAccount(google("sub-1", "a@x.ru"), google("sub-2", "a@x.ru")), false);
    assert.equal(sameProviderAccount(google("sub-1", "a@x.ru"), google("sub-1", "b@x.ru")), true);
  });

  test("старое подключение без id — сверка по почте без учёта регистра", () => {
    assert.equal(shouldRevokeAtProvider(google(null, "Keeper@Gmail.com"), [google("sub-9", " keeper@gmail.com ")]), false);
    assert.equal(shouldRevokeAtProvider(google("sub-1", "keeper@gmail.com"), [google(null, "KEEPER@gmail.com")]), false);
    assert.equal(shouldRevokeAtProvider(google(null, "a@gmail.com"), [google(null, "b@gmail.com")]), true);
  });

  test("аккаунт неизвестен (ни id, ни почты) — отзываем, как раньше: сверить не с чем", () => {
    assert.equal(shouldRevokeAtProvider(google(null, null), [google(null, null), google("sub-1")]), true);
  });

  test("Яндекс: отзываем всегда — токен своего устройства другие подключения не задевает", () => {
    assert.equal(shouldRevokeAtProvider(yandex("y-1"), [yandex("y-1")]), true);
  });

  test("подключение другого провайдера с тем же id не мешает", () => {
    assert.equal(sameProviderAccount(google("1"), yandex("1")), false);
    assert.equal(shouldRevokeAtProvider(google("1"), [yandex("1")]), true);
  });
});
