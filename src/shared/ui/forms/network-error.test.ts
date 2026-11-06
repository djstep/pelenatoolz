import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isNetworkError } from "@/shared/ui/forms/network-error";

describe("isNetworkError", () => {
  for (const message of [
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Load failed",
    "network error",
  ]) {
    it(`обрыв: ${message}`, () => {
      assert.equal(isNetworkError(new TypeError(message)), true);
    });
  }

  it("ответ оборвался на середине", () => {
    assert.equal(isNetworkError(new Error("Connection closed.")), true);
  });

  it("ошибка в коде — не обрыв", () => {
    assert.equal(isNetworkError(new TypeError("x is not a function")), false);
    assert.equal(isNetworkError(new Error("Failed to fetch")), false);
  });

  it("ошибка с сервера — не обрыв", () => {
    const error = Object.assign(new TypeError("Failed to fetch"), { digest: "123" });
    assert.equal(isNetworkError(error), false);
  });

  it("не ошибка — не обрыв", () => {
    assert.equal(isNetworkError("Failed to fetch"), false);
    assert.equal(isNetworkError(null), false);
  });
});
