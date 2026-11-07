import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { projectObjectSize, projectObjectStream, putProjectStream, UploadTooLargeError } from "./storage";

const KEY = "projects/p1/files/a.bin";
const DATA = Buffer.from(Array.from({ length: 700_000 }, (_, i) => i % 251));

const streamOf = (data: Buffer) => new Blob([new Uint8Array(data)]).stream();
const put = (key: string, data: Buffer, maxBytes = 1_000_000) => putProjectStream(key, streamOf(data), maxBytes);

async function readAll(stream: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

describe("файл потоком", () => {
  const start = process.cwd();
  let dir = "";

  before(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "pelena-storage-"));
    process.chdir(dir);
    await put(KEY, DATA);
  });

  after(() => {
    process.chdir(start);
    rmSync(dir, { recursive: true, force: true });
  });

  test("запись потоком возвращает настоящий размер", async () => {
    assert.equal(await put("projects/p1/files/b.bin", DATA), DATA.length);
    assert.equal(existsSync(path.join(dir, "storage", "projects/p1/files/b.bin.uploading")), false);
  });

  test("сверх предела — отказ, на диске ничего не остаётся", async () => {
    const key = "projects/p1/files/big.bin";
    await assert.rejects(put(key, DATA, 1000), UploadTooLargeError);
    assert.equal(await projectObjectSize(key), null);
    assert.equal(existsSync(path.join(dir, "storage", `${key}.uploading`)), false);
  });

  test("обрыв загрузки не оставляет файла", async () => {
    const key = "projects/p1/files/cut.bin";
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024));
        controller.error(new Error("обрыв"));
      },
    });
    await assert.rejects(putProjectStream(key, broken, 1_000_000), /обрыв/);
    assert.equal(await projectObjectSize(key), null);
    assert.equal(existsSync(path.join(dir, "storage", `${key}.uploading`)), false);
  });

  test("размер", async () => {
    assert.equal(await projectObjectSize(KEY), DATA.length);
    assert.equal(await projectObjectSize("projects/p1/files/нет.bin"), null);
  });

  test("целиком", async () => {
    assert.equal(Buffer.compare(await readAll(projectObjectStream(KEY)), DATA), 0);
  });

  test("кусок, включая границу блока чтения", async () => {
    for (const [from, to] of [[0, 1], [10, 19], [262_140, 262_150], [699_999, 699_999]] as const) {
      const part = await readAll(projectObjectStream(KEY, { start: from, end: to }));
      assert.equal(Buffer.compare(part, DATA.subarray(from, to + 1)), 0, `${from}-${to}`);
    }
  });

  test("файл не открывается, пока тело не читают", async () => {
    const stream = projectObjectStream("projects/p1/files/нет.bin");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await assert.rejects(readAll(stream), { code: "ENOENT" });
  });

  test("отмена после первого куска закрывает файл", async () => {
    const reader = projectObjectStream(KEY).getReader();
    assert.equal((await reader.read()).done, false);
    await reader.cancel();
    // На Windows открытый файл удалить нельзя: удаление доказывает, что он закрыт.
    rmSync(path.join(dir, "storage", KEY));
    await put(KEY, DATA);
  });
});
