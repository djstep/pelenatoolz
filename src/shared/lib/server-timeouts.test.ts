import assert from "node:assert/strict";
import { createRequire } from "node:module";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { describe, test } from "node:test";

const load = createRequire(import.meta.url);
const { applyLimits, isUploadPath } = load(path.join(process.cwd(), "scripts", "server-timeouts.cjs")) as {
  applyLimits: (server: http.Server, limits: { uploadMs: number; otherMs: number }) => http.Server;
  isUploadPath: (url?: string) => boolean;
};

/** Шлёт заголовки с обещанием тела и молчит. Возвращает, оборвал ли сервер соединение за `waitMs`. */
function stalled(port: number, url: string, waitMs: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(`POST ${url} HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\npartial`);
    });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, waitMs);
    socket.on("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
    socket.on("error", () => undefined);
  });
}

describe("предел приёма запроса", () => {
  test("адреса загрузки", () => {
    assert.equal(isUploadPath("/api/projects/p1/uploads/video"), true);
    assert.equal(isUploadPath("/api/projects/p1/uploads/file?x=1"), true);
    for (const url of [
      "/api/projects/p1/uploads",
      "/api/projects/p1/uploads/video/extra",
      "/api/projects/p1/media/f1",
      "/ru/login",
      "/api/projects/p1/uploads/other",
      undefined,
    ]) {
      assert.equal(isUploadPath(url), false, String(url));
    }
  });

  test("часовой предел стоит на сервере, обычный адрес обрывается раньше, загрузка — нет", async () => {
    const server = applyLimits(http.createServer(), { uploadMs: 3_600_000, otherMs: 150 });
    assert.equal(server.requestTimeout, 3_600_000);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;

    assert.equal(await stalled(port, "/ru/login", 1500), true);
    assert.equal(await stalled(port, "/api/projects/p1/uploads/video", 600), false);

    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  test("запрос без задержки не обрывается, а долгий ответ не считается", async () => {
    const server = applyLimits(
      http.createServer((_request, response) => {
        response.write("a");
        setTimeout(() => response.end("b"), 400);
      }),
      { uploadMs: 3_600_000, otherMs: 100 },
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;

    const body = await fetch(`http://127.0.0.1:${port}/api/projects/p1/media/f1`).then((res) => res.text());
    assert.equal(body, "ab");

    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
});
