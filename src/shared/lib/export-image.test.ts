import assert from "node:assert/strict";
import type { LookupAddress } from "node:dns";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import nodeModule from "node:module";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import {
  buildScheduleDocx,
  schedulePhotoUrls,
  type ScheduleExportField,
} from "@/features/auditions/lib/export-schedule";
import type { AuditionScheduleRow } from "@/features/auditions/lib/schedule-shared";
import type { CastListExportBundle } from "@/features/casting/lib/cast-list-export-data";
import { buildCastListDocx, castListPhotoUrls } from "@/features/casting/lib/export-cast-list";
import type { ExportImageDeps, ResolveHost } from "@/shared/lib/export-image";

// export-image.ts — серверный модуль ("server-only"): как и Next на сервере,
// берём его с условием react-server (пустой файл вместо ошибки).
// registerHooks есть в Node 22.15+, а типы в проекте — от Node 20.
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
type ExportImageModule = typeof import("@/shared/lib/export-image");
let createGuardedLookup: ExportImageModule["createGuardedLookup"];
let EXPORT_IMAGE_MAX_BYTES: ExportImageModule["EXPORT_IMAGE_MAX_BYTES"];
let EXPORT_IMAGE_TIMEOUT_MS: ExportImageModule["EXPORT_IMAGE_TIMEOUT_MS"];
let isBlockedIp: ExportImageModule["isBlockedIp"];
let loadExportImages: ExportImageModule["loadExportImages"];
let loadExportImagesWith: ExportImageModule["loadExportImagesWith"];
before(async () => {
  ({
    createGuardedLookup,
    EXPORT_IMAGE_MAX_BYTES,
    EXPORT_IMAGE_TIMEOUT_MS,
    isBlockedIp,
    loadExportImages,
    loadExportImagesWith,
  } = await import("@/shared/lib/export-image"));
});

/** Выгрузка в Word: сервер сам получает фото — только свои загрузки с диска и публичные адреса. */

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);
const GIF = Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.alloc(32, 3)]);
const WEBP = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.alloc(4), Buffer.from("WEBPVP8 ", "latin1"), Buffer.alloc(32)]);
const BIG = 2 * 1024 * 1024;

/** DNS, который нельзя вызывать: адрес должен отсеяться раньше. */
function noDns(calls: string[]): ResolveHost {
  return async (hostname) => {
    calls.push(hostname);
    throw new Error(`DNS не должен вызываться: ${hostname}`);
  };
}

function hosts(map: Record<string, string[]>): ResolveHost {
  return async (hostname) => {
    const list = map[hostname];
    if (!list) throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
    return list.map((address): LookupAddress => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
}

describe("запрещённые адреса", () => {
  const blocked = [
    "127.0.0.1",
    "127.1.2.3",
    "10.1.2.3",
    "172.16.5.4",
    "192.168.1.1",
    "100.64.0.1",
    "169.254.169.254",
    "0.0.0.0",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "[::1]",
    "::1",
    "::",
    "[::]",
    "fe80::1",
    "fd00::1",
    "fc00::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "0:0:0:0:0:ffff:7f00:1",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b:1::1",
    "2002:7f00:1::",
    "localhost",
    "не адрес",
  ];
  for (const ip of blocked) {
    test(`запрещён ${ip}`, () => assert.equal(isBlockedIp(ip), true));
  }
  for (const ip of ["8.8.8.8", "93.184.216.34", "2a00:1450:4010:c05::8a", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) {
    test(`разрешён ${ip}`, () => assert.equal(isBlockedIp(ip), false));
  }

  test("localhost по настоящему DNS — отказ", async () => {
    const lookup = createGuardedLookup(
      async (h) => (await import("node:dns")).promises.lookup(h, { all: true }),
      isBlockedIp,
    );
    const err = await new Promise<Error | null>((resolve) => lookup("localhost", {}, (e) => resolve(e)));
    assert.ok(err);
  });
});

describe("lookup сокета", () => {
  const lookup: ReturnType<ExportImageModule["createGuardedLookup"]> = (...args) =>
    createGuardedLookup(hosts({ "pub.test": ["8.8.8.8", "2001:4860:4860::8888"], "mix.test": ["8.8.8.8", "10.0.0.5"] }), isBlockedIp)(...args);

  test("all: true — массив проверенных адресов", async () => {
    const out = await new Promise<unknown>((resolve, reject) =>
      lookup("pub.test", { all: true }, (err, address) => (err ? reject(err) : resolve(address))),
    );
    assert.deepEqual(out, [
      { address: "8.8.8.8", family: 4 },
      { address: "2001:4860:4860::8888", family: 6 },
    ]);
  });

  test("обычный вызов — адрес и семейство; family: 6 — IPv6", async () => {
    const plain = await new Promise<[unknown, unknown]>((resolve, reject) =>
      lookup("pub.test", {}, (err, address, family) => (err ? reject(err) : resolve([address, family]))),
    );
    assert.deepEqual(plain, ["8.8.8.8", 4]);
    const v6 = await new Promise<[unknown, unknown]>((resolve, reject) =>
      lookup("pub.test", { family: 6 }, (err, address, family) => (err ? reject(err) : resolve([address, family]))),
    );
    assert.deepEqual(v6, ["2001:4860:4860::8888", 6]);
  });

  test("среди адресов один приватный — отказ в обоих вызовах", async () => {
    for (const options of [{}, { all: true }]) {
      const err = await new Promise<Error | null>((resolve) => lookup("mix.test", options, (e) => resolve(e)));
      assert.ok(err);
    }
  });
});

describe("внешние адреса — тестовый сервер", () => {
  let server: http.Server;
  let port = 0;
  let uploadsRoot = "";
  const requests: string[] = [];
  const closed: string[] = [];

  before(async () => {
    uploadsRoot = await mkdtemp(path.join(os.tmpdir(), "export-image-"));
    server = http.createServer((req, res) => {
      const url = req.url ?? "/";
      requests.push(url);
      res.on("error", () => {});
      res.on("close", () => closed.push(url));
      const image = (body: Buffer, type = "image/png") => {
        res.writeHead(200, { "content-type": type, "content-length": body.length });
        res.end(body);
      };
      switch (url) {
        case "/a.png":
          return image(PNG);
        case "/a.jpg":
          return image(JPEG, "image/jpeg");
        case "/a.gif":
          return image(GIF, "image/gif");
        case "/a.webp":
          return image(WEBP, "image/webp");
        case "/html":
          return image(Buffer.from("<html></html>"), "text/html");
        case "/fake.png":
          return image(Buffer.from("<html><script>alert(1)</script></html>"), "image/png");
        case "/to-meta":
          res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
          return res.end();
        case "/c1":
        case "/c2":
        case "/c3":
        case "/c4": {
          const n = Number(url.slice(2));
          res.writeHead(302, { location: n < 4 ? `/c${n + 1}` : "/a.png" });
          return res.end();
        }
        case "/huge-declared":
          res.writeHead(200, { "content-type": "image/png", "content-length": EXPORT_IMAGE_MAX_BYTES + 1 });
          return res.end(Buffer.concat([PNG, Buffer.alloc(EXPORT_IMAGE_MAX_BYTES + 1 - PNG.length)]));
        case "/infinite": {
          res.writeHead(200, { "content-type": "image/png" });
          res.write(PNG);
          const chunk = Buffer.alloc(64 * 1024);
          const pump = () => {
            while (!res.destroyed && res.write(chunk)) {
              /* пишем, пока не упрёмся в буфер */
            }
            if (!res.destroyed) res.once("drain", pump);
          };
          return pump();
        }
        case "/big1.png":
        case "/big2.png":
          return image(Buffer.concat([PNG, Buffer.alloc(BIG - PNG.length)]));
        case "/slow.png":
          setTimeout(() => image(PNG), 1_000);
          return;
        case "/silent":
          return; // не отвечает
        default:
          res.writeHead(404);
          res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(uploadsRoot, { recursive: true, force: true });
  });

  /** `img.test` → тестовый сервер; 127.0.0.1 разрешён только ему, остальное — по настоящей проверке. */
  function deps(extra: Partial<ExportImageDeps> = {}): ExportImageDeps {
    return {
      resolveHost: hosts({ "img.test": ["127.0.0.1"] }),
      isBlockedIp: (ip) => (ip === "127.0.0.1" ? false : isBlockedIp(ip)),
      allowedPorts: [80, 443, port],
      uploadsRoot,
      ...extra,
    };
  }
  const at = (p: string) => `http://img.test:${port}${p}`;
  async function one(url: string, d = deps()) {
    const result = await loadExportImagesWith("p1", [url], d);
    return { image: result.get(url), partial: result.partial };
  }
  function requestsSince(start: number) {
    return requests.slice(start);
  }

  test("картинка скачивается, тип — по сигнатуре", async () => {
    assert.equal((await one(at("/a.png"))).image?.type, "png");
    assert.equal((await one(at("/a.jpg"))).image?.type, "jpg");
    assert.equal((await one(at("/a.gif"))).image?.type, "gif");
  });

  test("WebP — фото нет", async () => {
    assert.equal((await one(at("/a.webp"))).image, null);
  });

  test("адреса: число, 0x7f.1, порт 8080, user:pass@, ftp:, file: — отказ без DNS и без запроса", async () => {
    const start = requests.length;
    const dns: string[] = [];
    const strict = deps({ resolveHost: noDns(dns), isBlockedIp, allowedPorts: [80, 443] });
    for (const url of [
      "http://2130706433/a.png",
      "http://0x7f.1/a.png",
      `http://127.0.0.1:${port}/a.png`,
      "http://[::1]/a.png",
      "http://[::ffff:127.0.0.1]/a.png",
      "http://169.254.169.254/latest/meta-data/",
      "http://img.test:8080/a.png",
      at("/a.png"),
      "http://user:pass@img.test/a.png",
      "ftp://img.test/a.png",
      "file:///etc/passwd",
      "javascript:alert(1)",
    ]) {
      assert.equal((await one(url, strict)).image, null, url);
    }
    assert.deepEqual(dns, []);
    assert.deepEqual(requestsSince(start), []);
  });

  test("домен резолвится в приватный IP — отказ без подключения", async () => {
    const start = requests.length;
    const evil = deps({ resolveHost: hosts({ "evil.test": ["127.0.0.1"] }), isBlockedIp });
    assert.equal((await one(`http://evil.test:${port}/a.png`, evil)).image, null);
    const mixed = deps({ resolveHost: hosts({ "mix.test": ["127.0.0.1", "10.0.0.5"] }) });
    assert.equal((await one(`http://mix.test:${port}/a.png`, mixed)).image, null);
    assert.deepEqual(requestsSince(start), []);
  });

  test("302 на 169.254.169.254 — фото нет, второго запроса нет", async () => {
    const start = requests.length;
    assert.equal((await one(at("/to-meta"))).image, null);
    assert.deepEqual(requestsSince(start), ["/to-meta"]);
  });

  test("цепочка из 3 редиректов — фото есть, из 4 — отказ", async () => {
    assert.equal((await one(at("/c2"))).image?.type, "png");
    const start = requests.length;
    assert.equal((await one(at("/c1"))).image, null);
    assert.deepEqual(requestsSince(start), ["/c1", "/c2", "/c3", "/c4"]);
  });

  test("Content-Length больше 3 МБ — отказ и предупреждение, остальные фото вставлены", async () => {
    const urls = [at("/huge-declared"), at("/a.png")];
    const result = await loadExportImagesWith("p1", urls, deps());
    assert.equal(result.get(urls[0]), null);
    assert.equal(result.get(urls[1])?.type, "png");
    assert.equal(result.partial, true);
  });

  test("без Content-Length бесконечный поток — обрыв и предупреждение", async () => {
    const result = await one(at("/infinite"));
    assert.equal(result.image, null);
    assert.equal(result.partial, true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(closed.includes("/infinite"), "соединение закрыто");
  });

  test("свой файл больше 3 МБ — фото нет и предупреждение", async () => {
    await mkdir(path.join(uploadsRoot, "p1"), { recursive: true });
    await writeFile(path.join(uploadsRoot, "p1", "huge.jpg"), Buffer.concat([JPEG, Buffer.alloc(EXPORT_IMAGE_MAX_BYTES)]));
    const result = await one("/uploads/p1/huge.jpg");
    assert.equal(result.image, null);
    assert.equal(result.partial, true);
  });

  test("text/html, HTML под видом image/png, 404 — отказ без предупреждения", async () => {
    for (const p of ["/html", "/fake.png", "/missing.png"]) {
      const result = await one(at(p));
      assert.equal(result.image, null, p);
      assert.equal(result.partial, false, `${p}: ошибка одного фото — тихо`);
    }
  });

  test("сервер молчит — через 5 с фото нет", async () => {
    const started = Date.now();
    const result = await one(at("/silent"));
    const elapsed = Date.now() - started;
    assert.equal(result.image, null);
    assert.equal(result.partial, false);
    assert.ok(elapsed >= EXPORT_IMAGE_TIMEOUT_MS - 100 && elapsed < EXPORT_IMAGE_TIMEOUT_MS + 2_000, `${elapsed} мс`);
  });

  test("общий бюджет байт исчерпан — следующие фото пропущены, предупреждение", async () => {
    const urls = [at("/big1.png"), at("/big2.png")];
    const result = await loadExportImagesWith("p1", urls, deps());
    assert.equal(urls.filter((u) => result.get(u)).length, 1);
    assert.equal(result.partial, true);
  });

  test("общее время вышло — фото нет, предупреждение", async () => {
    const result = await loadExportImagesWith("p1", [at("/slow.png")], deps({ limits: { totalMs: 200 } }));
    assert.equal(result.get(at("/slow.png")), null);
    assert.equal(result.partial, true);
  });

  test("пути сайта: своя загрузка — с диска, остальное — фото нет", async () => {
    await mkdir(path.join(uploadsRoot, "p1"), { recursive: true });
    await mkdir(path.join(uploadsRoot, "p2"), { recursive: true });
    await writeFile(path.join(uploadsRoot, "p1", "own_1-A.png"), PNG);
    await writeFile(path.join(uploadsRoot, "p1", "pic.webp"), WEBP);
    await writeFile(path.join(uploadsRoot, "p2", "other.png"), PNG);
    const start = requests.length;
    const dns: string[] = [];
    const d = deps({ resolveHost: noDns(dns) });

    assert.equal((await one("/uploads/p1/own_1-A.png", d)).image?.type, "png");
    for (const url of [
      "/uploads/p2/other.png",
      "/uploads/p1/../p2/other.png",
      "/uploads/p1/pic.webp",
      "/uploads/p1/missing.png",
      "/favicon.ico",
      "/api/projects/p1/media/x",
      "//img.test/a.png",
    ]) {
      const result = await one(url, d);
      assert.equal(result.image, null, url);
      assert.equal(result.partial, false, url);
    }
    assert.deepEqual(dns, []);
    assert.deepEqual(requestsSince(start), []);
  });
});

describe("выгрузки в Word со «своим фото» http://127.0.0.1/", () => {
  const LOCAL = "http://127.0.0.1/";

  test("публичная функция не ходит на 127.0.0.1", async () => {
    const result = await loadExportImages("p1", [LOCAL, "http://localhost/a.png"]);
    assert.equal(result.get(LOCAL), null);
    assert.equal(result.partial, false);
  });

  test("каст-лист собирается без фото и без ошибки", async () => {
    const bundle: CastListExportBundle = {
      project: { id: "p1", name: "Проект", fullName: null },
      character: { id: "ch1", name: "Маша", description: null, roleRequirements: null, roleType: null, roleTypeLabel: null },
      locale: "ru",
      candidates: [
        {
          id: "c1",
          status: "NEW" as CastListExportBundle["candidates"][number]["status"],
          statusLabel: "Новый",
          rating: null,
          notes: null,
          createdAt: new Date("2026-11-01"),
          person: {
            id: "a1",
            photoUrl: null,
            lastName: "Иванова",
            firstName: null,
            middleName: null,
            label: "Иванова",
            birthDate: null,
            education: null,
            filmography: null,
            phone: null,
            email: null,
            agentName: null,
            agentPhone: null,
            agentEmail: null,
            physicalParams: {},
            skills: [],
            notes: null,
          },
          comments: [],
          auditions: [],
        },
      ],
    };
    const args: Parameters<typeof buildCastListDocx>[0] = {
      bundle,
      characterFieldIds: ["name"],
      actorFieldIds: ["photo", "notes"],
      sort: "nameAsc",
      candidateConfigs: [{ candidateId: "c1", photoOverrideUrl: LOCAL, tapes: [], commentIds: null, commentsManual: false }],
    };
    assert.deepEqual(castListPhotoUrls(args), [LOCAL]);
    const photos = await loadExportImages("p1", castListPhotoUrls(args));
    const buffer = await buildCastListDocx(args, photos);
    assert.equal(buffer.subarray(0, 2).toString("latin1"), "PK");
    assert.ok(!buffer.includes("word/media/"), "картинок в файле нет");
    assert.equal(photos.partial, false);
  });

  test("план проб собирается без фото и без ошибки", async () => {
    const schedules: AuditionScheduleRow[] = [
      {
        id: "s1",
        projectId: "p1",
        date: "2026-11-01",
        time: "10:00",
        comment: null,
        createdAt: "2026-11-01",
        updatedAt: "2026-11-01",
        dateKey: "2026-11-01",
        kind: "LIVE" as AuditionScheduleRow["kind"],
        candidates: [
          {
            linkId: "l1",
            castingCandidateId: "c1",
            rating: null,
            person: { id: "a1", photoUrl: LOCAL, lastName: "Иванова", firstName: null, middleName: null, label: "Иванова" },
            character: { id: "ch1", name: "Маша", roleType: null },
          },
        ],
      },
    ];
    const fields: ScheduleExportField[] = ["time", "photo", "name"];
    assert.deepEqual(schedulePhotoUrls(schedules, fields), [LOCAL]);
    const photos = await loadExportImages("p1", schedulePhotoUrls(schedules, fields));
    const buffer = await buildScheduleDocx("Проект", schedules, fields, photos);
    assert.equal(buffer.subarray(0, 2).toString("latin1"), "PK");
    assert.ok(!buffer.includes("word/media/"), "картинок в файле нет");
    assert.equal(photos.partial, false);
  });
});
