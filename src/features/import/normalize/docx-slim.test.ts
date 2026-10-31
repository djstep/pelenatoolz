import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { crc32, inflateRawSync } from "node:zlib";
import { readDocxParagraphs } from "@/features/import/normalize/docx-paragraphs";
import {
  DocxSlimError,
  SLIM_DOCX_PARTS,
  slimDocx,
} from "@/features/import/normalize/docx-slim";
import { buildDocx, buildZip, p } from "@/features/import/normalize/test-docx";

const FIXTURES = path.join(process.cwd(), "docs", "tasks", "fixtures", "scripts");
const fixtures = readdirSync(FIXTURES).filter((name) => name.toLowerCase().endsWith(".docx"));

/**
 * Файлы из разных программ — по имени: `…-word.docx`, `…-gdocs.docx`, `…-libreoffice.docx`.
 * Три исходных файла волны сделаны не в Word (ddct — без сведений о программе, draft —
 * библиотекой, v4 — WPS Office), поэтому файлы программ добавляются отдельно.
 */
const SOURCES = [
  { suffix: "-word.docx", label: "Microsoft Word" },
  { suffix: "-gdocs.docx", label: "Google Docs" },
  { suffix: "-libreoffice.docx", label: "LibreOffice" },
];

/**
 * Части архива: имя → распакованные данные; заодно проверка CRC и размеров каталога.
 * `slim` — облегчённый: размеры и CRC ещё и в локальных заголовках (у исходных файлов
 * Google Docs они после данных, бит 3).
 */
function unzipChecked(zip: Uint8Array, slim = true) {
  const buffer = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const total = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const parts = new Map<string, Buffer>();
  for (let i = 0; i < total; i++) {
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressed = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    // Локальный заголовок — с теми же размерами и CRC, без «размеров после данных».
    if (slim) {
      assert.equal(buffer.readUInt16LE(local + 6) & 0x8, 0, `${name}: бит 3`);
      assert.equal(buffer.readUInt32LE(local + 14), crc, `${name}: CRC в заголовке`);
      assert.equal(buffer.readUInt32LE(local + 18), compressed, `${name}: размер в заголовке`);
    }
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(start, start + compressed);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    assert.equal(data.length, size, `${name}: размер`);
    assert.equal(crc32(data), crc, `${name}: CRC`);
    parts.set(name, data);
    offset += 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  return parts;
}

describe("облегчённый docx: файлы", () => {
  for (const name of fixtures) {
    test(name, () => {
      const source = readFileSync(path.join(FIXTURES, name));
      const slim = slimDocx(source);
      const original = unzipChecked(source, false);
      const parts = unzipChecked(slim);

      // Только нужные части — все, что есть в исходном, данные те же.
      assert.deepEqual(
        [...parts.keys()],
        SLIM_DOCX_PARTS.filter((part) => original.has(part)),
      );
      for (const [part, data] of parts) assert.ok(data.equals(original.get(part)!), part);
      assert.ok(parts.has("_rels/.rels"), "связи пакета");
      assert.ok(parts.has("word/_rels/document.xml.rels"), "связи документа");

      // Разбор облегчённого — тот же, что исходного.
      assert.deepEqual(readDocxParagraphs(Buffer.from(slim)), readDocxParagraphs(source));
      // Одинаковый результат при повторе (хэш с предпросмотра совпадёт) и повторное облегчение.
      assert.deepEqual(slimDocx(source), slim);
      assert.deepEqual(slimDocx(slim), slim);
      assert.ok(slim.length <= source.length);
    });
  }

  for (const { suffix, label } of SOURCES) {
    const present = fixtures.filter((name) => name.endsWith(suffix));
    test(
      `есть файл из ${label}`,
      { skip: present.length === 0 ? `нет файла *${suffix} в docs/tasks/fixtures/scripts` : false },
      () => assert.ok(present.length > 0),
    );
  }
});

describe("облегчённый docx: устройство архива", () => {
  const body = p("1. ИНТ. КОМНАТА — ДЕНЬ") + p("Текст.");

  test("картинки и прочие части не уходят", () => {
    const picture = Buffer.alloc(200_000, 7);
    const source = buildDocx({
      body,
      styles: "<w:style/>",
      extra: [
        { name: "_rels/.rels", data: "<Relationships/>" },
        { name: "word/_rels/document.xml.rels", data: "<Relationships/>" },
        { name: "word/media/image1.png", data: picture, method: 0 },
        { name: "word/fontTable.xml", data: "<w:fonts/>" },
      ],
    });
    const slim = slimDocx(source);
    assert.deepEqual(
      [...unzipChecked(slim).keys()],
      [
        "[Content_Types].xml",
        "_rels/.rels",
        "word/_rels/document.xml.rels",
        "word/document.xml",
        "word/styles.xml",
      ],
    );
    assert.ok(slim.length < 2000);
  });

  test("размеры после данных (бит 3, потоковая запись архива) — переносятся в заголовок", () => {
    const source = Buffer.from(buildDocx({ body }));
    // Помечаем все части битом 3 и обнуляем размеры и CRC в локальных заголовках.
    let offset = 0;
    while (source.readUInt32LE(offset) === 0x04034b50) {
      const compressed = source.readUInt32LE(offset + 18);
      const next = offset + 30 + source.readUInt16LE(offset + 26) + compressed;
      source.writeUInt16LE(source.readUInt16LE(offset + 6) | 0x8, offset + 6);
      source.fill(0, offset + 14, offset + 26);
      offset = next;
    }
    const eocd = source.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    let central = source.readUInt32LE(eocd + 16);
    for (let i = 0; i < source.readUInt16LE(eocd + 10); i++) {
      source.writeUInt16LE(source.readUInt16LE(central + 8) | 0x8, central + 8);
      central += 46 + source.readUInt16LE(central + 28);
    }
    const slim = slimDocx(source);
    unzipChecked(slim);
    assert.deepEqual(readDocxParagraphs(Buffer.from(slim)), readDocxParagraphs(source));
  });

  test("не zip, не docx, шифрование — отказ", () => {
    const fails = (data: Uint8Array, code: DocxSlimError["code"]) =>
      assert.throws(() => slimDocx(data), (e) => e instanceof DocxSlimError && e.code === code);

    fails(Buffer.from("это просто текст, переименованный в .docx".repeat(5)), "not_zip");
    fails(buildZip([{ name: "word/document.xml", data: "<w:document/>" }]), "not_docx");
    fails(buildZip([{ name: "[Content_Types].xml", data: "<Types/>" }]), "not_docx");

    const encrypted = Buffer.from(buildDocx({ body }));
    const eocd = encrypted.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    let central = encrypted.readUInt32LE(eocd + 16);
    for (let i = 0; i < encrypted.readUInt16LE(eocd + 10); i++) {
      encrypted.writeUInt16LE(1, central + 8);
      central += 46 + encrypted.readUInt16LE(central + 28);
    }
    fails(encrypted, "unsupported");
  });
});
