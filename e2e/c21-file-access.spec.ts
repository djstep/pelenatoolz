import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { MembershipStatus, ProjectType } from "@prisma/client";
import { CREW, E2E_ROLES, type E2ERoleKey } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Доступ к файлам проекта. Сканы договоров и актов открывает только право на договоры.
 * Картинки `/uploads/...` — только активные участники своего проекта.
 * Запросы идут напрямую, как при подделанной ссылке.
 */

const ctx = e2eContext();
const db = e2eDb();
const ORIGIN = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin;
const FILES_PATH = projectPath(ctx, "/files");
const UPLOADS_DISK = path.join(process.cwd(), "storage", "uploads");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test.describe.configure({ mode: "serial" });

async function pageAs(browser: Browser, role: E2ERoleKey) {
  const context = await browser.newContext({ storageState: storageStatePath(role) });
  return context.newPage();
}

function postFile(page: Page, name: string, scope?: "contract") {
  return page.request.post(`/api/projects/${ctx.projectId}/uploads/file`, {
    headers: { origin: ORIGIN },
    multipart: {
      file: { name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e") },
      ...(scope ? { scope } : {}),
    },
  });
}

async function uploadFile(page: Page, name: string, scope?: "contract") {
  const res = await postFile(page, name, scope);
  expect(res.status()).toBe(200);
  return (await res.json()) as { id: string; url: string };
}

async function uploadImage(page: Page) {
  const res = await page.request.post(`/api/projects/${ctx.projectId}/uploads`, {
    headers: { origin: ORIGIN },
    multipart: { file: { name: "photo.png", mimeType: "image/png", buffer: PNG } },
  });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { url: string }).url;
}

async function seedContract() {
  return db.contract.findFirstOrThrow({
    where: { projectId: ctx.projectId, number: CREW.contracts.individual.number },
    select: { id: true, companyId: true, counterpartyId: true },
  });
}

/** Id действия удаления берётся из настоящего удаления на экране. */
async function captureDeleteAction(page: Page, name: string) {
  let actionId = "";
  page.on("request", (request) => {
    actionId ||= request.headers()["next-action"] ?? "";
  });
  await page.goto(FILES_PATH);
  await page.getByRole("row", { name }).getByRole("button", { name: "Удалить" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Удалить" }).click();
  await expect(page.getByRole("row", { name })).toHaveCount(0);
  expect(actionId).not.toBe("");
  return actionId;
}

async function callAction(page: Page, sitePath: string, actionId: string, args: unknown[]) {
  const res = await page.request.post(sitePath, {
    headers: {
      "next-action": actionId,
      accept: "text/x-component",
      "content-type": "text/plain;charset=UTF-8",
      origin: ORIGIN,
    },
    data: JSON.stringify(args),
  });
  return res.text();
}

test.describe("файлы договоров и актов", () => {
  const contractName = "e2e-скан-договора.pdf";
  const actName = "e2e-скан-акта.pdf";
  const openName = "e2e-общий-файл.pdf";
  const screenName = "e2e-скан-с-экрана.pdf";
  const attachedName = "e2e-прикреплённый-файл.pdf";
  const fileNames = [contractName, actName, openName, screenName, attachedName];
  let certificateId = "";

  test.afterAll(async () => {
    await db.projectFile.deleteMany({
      where: { projectId: ctx.projectId, originalName: { in: fileNames } },
    });
    if (certificateId) await db.certificate.delete({ where: { id: certificateId } });
  });

  test("без права на договоры скан не открывается, не виден и не удаляется", async ({ browser }) => {
    const producer = await pageAs(browser, "producer");
    const crewonly = await pageAs(browser, "crewonly");
    const contract = await seedContract();
    const status = await db.projectApprovalStatus.findFirstOrThrow({
      where: { projectId: ctx.projectId, key: "UNSIGNED" },
      select: { id: true },
    });

    const contractFile = await uploadFile(producer, contractName, "contract");
    await db.contractFile.create({ data: { contractId: contract.id, fileId: contractFile.id } });

    const certificate = await db.certificate.create({
      data: {
        projectId: ctx.projectId,
        date: new Date("2026-01-15"),
        number: "E2E-АКТ-ФАЙЛ",
        companyId: contract.companyId,
        counterpartyId: contract.counterpartyId,
        amount: "1000",
        amountWithVat: "1000",
        statusId: status.id,
      },
      select: { id: true },
    });
    certificateId = certificate.id;
    const actFile = await uploadFile(producer, actName, "contract");
    await db.certificateFile.create({ data: { certificateId, fileId: actFile.id } });

    const openFile = await uploadFile(producer, openName);

    // С правом на договоры и общий файл без него открываются.
    expect((await producer.request.get(contractFile.url)).status()).toBe(200);
    expect((await producer.request.get(actFile.url)).status()).toBe(200);
    expect((await crewonly.request.get(openFile.url)).status()).toBe(200);

    expect((await crewonly.request.get(contractFile.url)).status()).toBe(403);
    expect((await crewonly.request.get(actFile.url)).status()).toBe(403);
    const part = await crewonly.request.get(contractFile.url, { headers: { range: "bytes=0-1" } });
    expect(part.status()).toBe(403);

    await crewonly.goto(FILES_PATH);
    await expect(crewonly.getByRole("row", { name: openName })).toBeVisible();
    await expect(crewonly.getByText(contractName)).toHaveCount(0);
    await expect(crewonly.getByText(actName)).toHaveCount(0);

    await producer.goto(FILES_PATH);
    await expect(producer.getByRole("row", { name: contractName })).toBeVisible();

    const actionId = await captureDeleteAction(crewonly, openName);
    for (const id of [contractFile.id, actFile.id]) {
      expect(await callAction(crewonly, FILES_PATH, actionId, [ctx.projectId, id])).toContain("Недостаточно прав");
    }
    expect(await db.projectFile.count({ where: { id: { in: [contractFile.id, actFile.id] } } })).toBe(2);
    expect(await db.contractFile.count({ where: { fileId: contractFile.id } })).toBe(1);

    // Без права на договоры закрытый файл не загрузить.
    expect((await postFile(crewonly, "e2e-чужой-скан.pdf", "contract")).status()).toBe(403);
  });

  test("файл остаётся закрытым после открепления, удаления договора и при прикреплении с экрана", async ({ browser }) => {
    const producer = await pageAs(browser, "producer");
    const crewonly = await pageAs(browser, "crewonly");
    const contract = await seedContract();
    const contractPath = projectPath(ctx, `/counterparties/contracts/${contract.id}`);

    const scanFromForm = await db.projectFile.findFirstOrThrow({
      where: { projectId: ctx.projectId, originalName: contractName },
      select: { id: true, url: true },
    });
    await db.contractFile.deleteMany({ where: { fileId: scanFromForm.id } });
    expect((await crewonly.request.get(scanFromForm.url!)).status()).toBe(403);
    await crewonly.goto(FILES_PATH);
    await expect(crewonly.getByText(contractName)).toHaveCount(0);

    // Настоящая загрузка на странице договора: файл закрыт и привязан.
    let attachAction = "";
    producer.on("request", (request) => {
      attachAction ||= request.headers()["next-action"] ?? "";
    });
    await producer.goto(contractPath);
    await producer.locator('input[type="file"]').first().setInputFiles({
      name: screenName,
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 e2e"),
    });
    await expect(producer.getByText(screenName)).toBeVisible();
    const screenFile = await db.projectFile.findFirstOrThrow({
      where: { projectId: ctx.projectId, originalName: screenName },
      select: { contractsOnly: true, contractFiles: { select: { contractId: true } } },
    });
    expect(screenFile.contractsOnly).toBe(true);
    expect(screenFile.contractFiles).toEqual([{ contractId: contract.id }]);

    // Общий файл, прикреплённый к договору, закрывается сам.
    const attached = await uploadFile(producer, attachedName);
    expect((await crewonly.request.get(attached.url)).status()).toBe(200);
    await callAction(producer, contractPath, attachAction, [ctx.projectId, contract.id, attached.id, "OTHER"]);
    expect((await crewonly.request.get(attached.url)).status()).toBe(403);
  });
});

test.describe("загруженный код не выполняется на сайте", () => {
  const HTML = '<html><head><title>e2e</title></head><script>document.title="ВЫПОЛНЕНО"</script></html>';
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>document.title="ВЫПОЛНЕНО"</script></svg>';
  const names = ["e2e-код.html", "e2e-код.svg", "e2e-код-как-картинка.png", "e2e-картинка.png"];

  async function upload(page: Page, name: string, mimeType: string, body: string | Buffer) {
    const res = await page.request.post(`/api/projects/${ctx.projectId}/uploads/file`, {
      headers: { origin: ORIGIN },
      multipart: { file: { name, mimeType, buffer: Buffer.from(body) } },
    });
    expect(res.status()).toBe(200);
    return ((await res.json()) as { url: string }).url;
  }

  /** Открытие в браузере: страницы нет, файл уходит в скачивание, код не запускается. */
  async function expectDownload(page: Page, url: string, name: string) {
    const download = page.waitForEvent("download");
    await page.goto(url).catch(() => undefined);
    expect((await download).suggestedFilename()).toBe(name);
    expect(await page.title()).not.toBe("ВЫПОЛНЕНО");
  }

  test.afterAll(async () => {
    await db.projectFile.deleteMany({ where: { projectId: ctx.projectId, originalName: { in: names } } });
  });

  test("HTML и SVG скачиваются, а не открываются", async ({ browser }) => {
    const producer = await pageAs(browser, "producer");
    const html = await upload(producer, names[0], "text/html", HTML);
    const svg = await upload(producer, names[1], "image/svg+xml", SVG);

    for (const url of [html, svg]) {
      const res = await producer.request.get(url);
      expect(res.headers()["content-disposition"]).toMatch(/^attachment/);
      expect(res.headers()["x-content-type-options"]).toBe("nosniff");
      expect(res.headers()["content-security-policy"]).toContain("sandbox");
    }

    await expectDownload(producer, html, names[0]);
    await expectDownload(producer, svg, names[1]);
  });

  test("HTML под видом картинки не выполняется, настоящая картинка открывается", async ({ browser }) => {
    const producer = await pageAs(browser, "producer");
    const fake = await upload(producer, names[2], "image/png", HTML);
    await producer.goto(fake);
    expect(await producer.title()).not.toBe("ВЫПОЛНЕНО");
    await expect(producer.locator("script")).toHaveCount(0);

    const real = await upload(producer, names[3], "image/png", PNG);
    const res = await producer.request.get(real);
    expect(res.headers()["content-disposition"]).toMatch(/^inline/);
    expect(res.headers()["content-type"]).toBe("image/png");
  });

  test("SVG, загруженный как картинка объекта, не остаётся SVG", async ({ browser }) => {
    const producer = await pageAs(browser, "producer");
    const res = await producer.request.post(`/api/projects/${ctx.projectId}/uploads`, {
      headers: { origin: ORIGIN },
      multipart: { file: { name: "e2e.svg", mimeType: "image/svg+xml", buffer: Buffer.from(SVG) } },
    });
    expect(res.status()).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(/\.jpg$/);
    const served = await producer.request.get(url);
    expect(served.headers()["content-type"]).toBe("image/jpeg");
    expect(served.headers()["x-content-type-options"]).toBe("nosniff");
    await rm(path.join(UPLOADS_DISK, ctx.projectId, url.split("/").pop()!), { force: true });
  });
});

test.describe("просмотр в браузере", () => {
  const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");
  const names = [
    "e2e-просмотр.pdf",
    "e2e-просмотр.webm",
    "e2e-просмотр-звук.webm",
    "e2e-проба.webm",
    "e2e-части.webm",
    "e2e-перемотка.webm",
  ];

  /** Настоящее короткое видео: сам браузер записывает его с холста. */
  async function recordVideo(page: Page) {
    const base64 = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext("2d")!;
      const recorder = new MediaRecorder(canvas.captureStream(10), { mimeType: "video/webm" });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const stopped = new Promise((resolve) => (recorder.onstop = resolve));
      recorder.start(100);
      for (let i = 0; i < 12; i++) {
        context.fillStyle = i % 2 ? "red" : "blue";
        context.fillRect(0, 0, 64, 64);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      recorder.stop();
      await stopped;
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
      return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
    });
    return Buffer.from(base64, "base64");
  }

  async function upload(page: Page, route: string, name: string, mimeType: string, buffer: Buffer) {
    const res = await page.request.post(`/api/projects/${ctx.projectId}/uploads/${route}`, {
      headers: { origin: ORIGIN },
      multipart: { file: { name, mimeType, buffer } },
    });
    expect(res.status()).toBe(200);
    return (await res.json()) as { id: string; url: string };
  }

  async function expectPlays(page: Page) {
    const video = page.locator("video");
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
    expect(await video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(64);
    await video.evaluate((v: HTMLVideoElement) => {
      v.muted = true;
      return v.play();
    });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0);
  }

  test.afterAll(async () => {
    await db.projectFile.deleteMany({ where: { projectId: ctx.projectId, originalName: { in: names } } });
  });

  test("PDF, видео и аудио открываются во вкладке", async ({ browser }) => {
    const producer = await pageAs(browser, "producer");
    await producer.goto(projectPath(ctx));
    const webm = await recordVideo(producer);

    const pdf = await producer.request.get((await upload(producer, "file", names[0], "application/pdf", PDF)).url);
    expect(pdf.headers()["content-disposition"]).toMatch(/^inline/);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect(pdf.headers()["content-security-policy"]).toContain("sandbox");
    expect(pdf.headers()["x-content-type-options"]).toBe("nosniff");

    const audio = await producer.request.get((await upload(producer, "file", names[2], "audio/webm", webm)).url);
    expect(audio.headers()["content-disposition"]).toMatch(/^inline/);
    expect(audio.headers()["content-type"]).toBe("audio/webm");
    expect(audio.headers()["x-content-type-options"]).toBe("nosniff");
    expect(audio.headers()["content-security-policy"]).toContain("sandbox");

    const video = await upload(producer, "file", names[1], "video/webm", webm);
    const videoHeaders = (await producer.request.get(video.url)).headers();
    expect(videoHeaders["content-security-policy"]).toContain("sandbox");
    expect(videoHeaders["content-security-policy"]).not.toContain("allow-scripts");
    const tab = await pageAs(browser, "producer");
    await tab.goto(video.url);
    await expectPlays(tab);
  });

  async function openAudition(page: Page, videoFileId: string) {
    await db.audition.update({ where: { id: ctx.auditionId! }, data: { videoFileId } });
    await page.goto(projectPath(ctx, `/preproduction/auditions/${ctx.auditionId}`));
    await page.getByRole("button", { name: /Смотреть/ }).click();
  }

  test("проба играет в плеере", async ({ browser }) => {
    const producer = await pageAs(browser, "producer");
    await producer.goto(projectPath(ctx));
    const file = await upload(producer, "video", names[3], "video/webm", await recordVideo(producer));
    await openAudition(producer, file.id);
    await expectPlays(producer);
  });

  test("видео отдаётся частями", async ({ browser }) => {
    const producer = await pageAs(browser, "producer");
    await producer.goto(projectPath(ctx));
    const webm = await recordVideo(producer);
    const size = webm.length;
    const { url } = await upload(producer, "video", names[4], "video/webm", webm);
    const get = (range?: string) => producer.request.get(url, range ? { headers: { range } } : {});

    const whole = await get();
    expect(whole.status()).toBe(200);
    expect(whole.headers()["accept-ranges"]).toBe("bytes");
    expect(Buffer.compare(await whole.body(), webm)).toBe(0);

    // Первый запрос Safari и iPhone: без ответа 206 видео там не запускается.
    for (const [range, start, end] of [
      ["bytes=0-1", 0, 1],
      ["bytes=10-19", 10, 19],
      [`bytes=${size - 5}-`, size - 5, size - 1],
      ["bytes=-5", size - 5, size - 1],
      [`bytes=3-${size + 100}`, 3, size - 1],
    ] as const) {
      const part = await get(range);
      expect(part.status(), range).toBe(206);
      expect(part.headers()["content-range"], range).toBe(`bytes ${start}-${end}/${size}`);
      expect(part.headers()["content-length"], range).toBe(String(end - start + 1));
      expect(part.headers()["accept-ranges"], range).toBe("bytes");
      expect(part.headers()["x-content-type-options"], range).toBe("nosniff");
      expect(part.headers()["content-security-policy"], range).toContain("sandbox");
      expect(Buffer.compare(await part.body(), webm.subarray(start, end + 1)), range).toBe(0);
    }

    const head = await producer.request.head(url);
    expect(head.status()).toBe(200);
    expect(head.headers()["content-length"]).toBe(String(size));
    expect(head.headers()["accept-ranges"]).toBe("bytes");
    expect((await head.body()).length).toBe(0);

    const beyond = await get(`bytes=${size}-`);
    expect(beyond.status()).toBe(416);
    expect(beyond.headers()["content-range"]).toBe(`bytes */${size}`);

    // Несколько кусков сразу не поддерживаем: стандарт разрешает отдать файл целиком.
    expect((await get("bytes=0-1,3-4")).status()).toBe(200);
  });

  test("проба перематывается в плеере", async ({ browser }) => {
    const producer = await pageAs(browser, "producer");
    await producer.goto(projectPath(ctx));
    const file = await upload(producer, "video", names[5], "video/webm", await recordVideo(producer));

    const statuses: number[] = [];
    producer.on("response", (res) => {
      if (res.url().endsWith(file.url)) statuses.push(res.status());
    });
    await openAudition(producer, file.id);
    await expectPlays(producer);
    expect(statuses).toContain(206);

    const seeked = await producer.locator("video").evaluate(async (v: HTMLVideoElement) => {
      const seek = (time: number) =>
        new Promise<void>((resolve) => {
          v.addEventListener("seeked", () => resolve(), { once: true });
          v.currentTime = time;
        });
      v.pause();
      // У записи с холста длительность неизвестна: браузер узнаёт её, дойдя до конца файла.
      await seek(1e6);
      const end = v.currentTime;
      await seek(end / 2);
      return { end, middle: v.currentTime, ready: v.readyState };
    });
    expect(seeked.end).toBeGreaterThan(0);
    expect(seeked.middle).toBeCloseTo(seeked.end / 2, 0);
    expect(seeked.ready).toBeGreaterThanOrEqual(2);
  });
});

test.describe("картинки /uploads/", () => {
  let foreignProjectId = "";

  async function setCrewonlyStatus(status: MembershipStatus) {
    const user = await db.user.findFirstOrThrow({ where: { email: E2E_ROLES.crewonly.email } });
    await db.projectMembership.update({
      where: { projectId_userId: { projectId: ctx.projectId, userId: user.id } },
      data: { status },
    });
  }

  test.afterAll(async () => {
    await rm(path.join(UPLOADS_DISK, ctx.projectId), { recursive: true, force: true });
    if (foreignProjectId) {
      await rm(path.join(UPLOADS_DISK, foreignProjectId), { recursive: true, force: true });
      await db.project.delete({ where: { id: foreignProjectId } });
    }
    await setCrewonlyStatus(MembershipStatus.ACTIVE);
  });

  test("любой активный участник видит, остальным файла нет", async ({ browser }) => {
    const producer = await pageAs(browser, "producer");
    const crewonly = await pageAs(browser, "crewonly");
    const url = await uploadImage(producer);
    expect(url).toMatch(new RegExp(`^/uploads/${ctx.projectId}/[A-Za-z0-9_-]+\\.png$`));

    const name = url.split("/").pop()!;
    await stat(path.join(UPLOADS_DISK, ctx.projectId, name));
    await expect(stat(path.join(process.cwd(), "public", "uploads", ctx.projectId, name))).rejects.toThrow();

    const own = await crewonly.request.get(url);
    expect(own.status()).toBe(200);
    expect(own.headers()["content-type"]).toBe("image/png");
    expect(own.headers()["cache-control"]).toContain("private");
    expect(own.headers()["x-content-type-options"]).toBe("nosniff");
    expect(own.headers()["content-security-policy"]).toContain("sandbox");
    expect(Buffer.compare(await own.body(), PNG)).toBe(0);

    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const denied = await anonymous.request.get(`${ORIGIN}${url}`, { maxRedirects: 0 });
    expect(denied.status()).toBe(401);
    expect(denied.headers()["content-type"] ?? "").not.toContain("image");

    await setCrewonlyStatus(MembershipStatus.REMOVED);
    expect((await crewonly.request.get(url)).status()).toBe(404);
    await setCrewonlyStatus(MembershipStatus.ACTIVE);
  });

  test("чужой проект и подделанные имена закрыты", async ({ browser }) => {
    const producer = await pageAs(browser, "producer");
    const stranger = await db.user.upsert({
      where: { email: "e2e-file-stranger@pelena.test" },
      create: { email: "e2e-file-stranger@pelena.test", name: "E2E Посторонний", passwordHash: "-" },
      update: {},
      select: { id: true },
    });
    const foreign = await db.project.create({
      data: {
        name: "E2E чужой проект файлов",
        type: ProjectType.FEATURE,
        createdById: stranger.id,
        ownerUserId: stranger.id,
      },
      select: { id: true },
    });
    foreignProjectId = foreign.id;
    await mkdir(path.join(UPLOADS_DISK, foreign.id), { recursive: true });
    await writeFile(path.join(UPLOADS_DISK, foreign.id, "secret.png"), PNG);

    expect((await producer.request.get(`/uploads/${foreign.id}/secret.png`)).status()).toBe(404);

    // Эти файлы лежат на диске: отказ дают правила адреса, а не отсутствие файла.
    const ownDisk = path.join(UPLOADS_DISK, ctx.projectId);
    await mkdir(ownDisk, { recursive: true });
    await writeFile(path.join(ownDisk, "evil.svg"), PNG);
    await writeFile(path.join(ownDisk, "evil.png.html"), PNG);

    for (const bad of [
      "evil.svg",
      "evil.png.html",
      `..%2F${foreign.id}%2Fsecret.png`,
      `%2e%2e%2f${foreign.id}%2fsecret.png`,
    ]) {
      expect((await producer.request.get(`/uploads/${ctx.projectId}/${bad}`)).status(), bad).toBe(404);
    }
  });
});
