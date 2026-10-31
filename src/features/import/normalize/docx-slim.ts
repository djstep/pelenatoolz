/**
 * Облегчённый docx (решение владельца, шаг 7): браузер отправляет на сервер только части,
 * которые читает разбор, и связи пакета — картинки, шрифты и прочее не уходят.
 * Части копируются из архива как есть, без пересжатия: пакеты не нужны, CRC и размеры —
 * из центрального каталога. Работает и в браузере, и в Node (только `Uint8Array`).
 */

/** Что остаётся в облегчённом docx. Нет части в исходном — её нет и здесь. */
export const SLIM_DOCX_PARTS = [
  "[Content_Types].xml",
  "_rels/.rels",
  "word/_rels/document.xml.rels",
  "word/document.xml",
  "word/styles.xml",
  "word/numbering.xml",
] as const;

export type DocxSlimErrorCode = "not_zip" | "not_docx" | "unsupported";

export class DocxSlimError extends Error {
  constructor(public readonly code: DocxSlimErrorCode) {
    super(`docx slim: ${code}`);
    this.name = "DocxSlimError";
  }
}

export function isDocxSlimError(error: unknown): error is DocxSlimError {
  return error instanceof DocxSlimError;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** Бит 3: размеры и CRC — после данных; в новом архиве они в заголовке, бит снимаем. */
const DATA_DESCRIPTOR_FLAG = 0x8;

type Entry = {
  name: string;
  nameBytes: Uint8Array;
  versionNeeded: number;
  flags: number;
  method: number;
  time: number;
  date: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

function readEntries(bytes: Uint8Array): Entry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw new DocxSlimError("not_zip");
  let eocd = -1;
  const minOffset = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= minOffset; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new DocxSlimError("not_zip");

  const total = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (total === 0xffff || directoryOffset === 0xffffffff) throw new DocxSlimError("unsupported");

  const decoder = new TextDecoder();
  const entries: Entry[] = [];
  let offset = directoryOffset;
  for (let i = 0; i < total; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new DocxSlimError("not_zip");
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    entries.push({
      name: decoder.decode(nameBytes),
      nameBytes,
      versionNeeded: view.getUint16(offset + 6, true),
      flags: view.getUint16(offset + 8, true),
      method: view.getUint16(offset + 10, true),
      time: view.getUint16(offset + 12, true),
      date: view.getUint16(offset + 14, true),
      crc: view.getUint32(offset + 16, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function entryData(bytes: Uint8Array, entry: Entry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Бит 0 — шифрование; zip64 у части — не поддерживаем.
  if (entry.flags & 0x1) throw new DocxSlimError("unsupported");
  if (entry.compressedSize === 0xffffffff || entry.uncompressedSize === 0xffffffff) {
    throw new DocxSlimError("unsupported");
  }
  if (entry.method !== 0 && entry.method !== 8) throw new DocxSlimError("unsupported");
  const local = entry.localHeaderOffset;
  if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL_SIGNATURE) {
    throw new DocxSlimError("not_zip");
  }
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw new DocxSlimError("not_zip");
  return bytes.subarray(start, end);
}

/**
 * Облегчённый docx из исходного: только `SLIM_DOCX_PARTS`, в том же порядке, без лишних полей.
 * Один и тот же исходный файл даёт байт в байт один и тот же результат — от него хэш.
 * Без `[Content_Types].xml` или `word/document.xml` — не docx.
 */
export function slimDocx(source: Uint8Array) {
  const byName = new Map(readEntries(source).map((entry) => [entry.name, entry]));
  if (!byName.has("[Content_Types].xml") || !byName.has("word/document.xml")) {
    throw new DocxSlimError("not_docx");
  }
  const parts = SLIM_DOCX_PARTS.flatMap((name) => {
    const entry = byName.get(name);
    return entry ? [{ entry, data: entryData(source, entry) }] : [];
  });

  const size = parts.reduce(
    (sum, { entry, data }) => sum + 30 + 46 + entry.nameBytes.length * 2 + data.length,
    22,
  );
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let offset = 0;
  const offsets: number[] = [];

  for (const { entry, data } of parts) {
    offsets.push(offset);
    view.setUint32(offset, LOCAL_SIGNATURE, true);
    view.setUint16(offset + 4, entry.versionNeeded, true);
    view.setUint16(offset + 6, entry.flags & ~DATA_DESCRIPTOR_FLAG, true);
    view.setUint16(offset + 8, entry.method, true);
    view.setUint16(offset + 10, entry.time, true);
    view.setUint16(offset + 12, entry.date, true);
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, data.length, true);
    view.setUint32(offset + 22, entry.uncompressedSize, true);
    view.setUint16(offset + 26, entry.nameBytes.length, true);
    view.setUint16(offset + 28, 0, true);
    out.set(entry.nameBytes, offset + 30);
    out.set(data, offset + 30 + entry.nameBytes.length);
    offset += 30 + entry.nameBytes.length + data.length;
  }

  const directoryOffset = offset;
  parts.forEach(({ entry, data }, i) => {
    view.setUint32(offset, CENTRAL_SIGNATURE, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, entry.versionNeeded, true);
    view.setUint16(offset + 8, entry.flags & ~DATA_DESCRIPTOR_FLAG, true);
    view.setUint16(offset + 10, entry.method, true);
    view.setUint16(offset + 12, entry.time, true);
    view.setUint16(offset + 14, entry.date, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, data.length, true);
    view.setUint32(offset + 24, entry.uncompressedSize, true);
    view.setUint16(offset + 28, entry.nameBytes.length, true);
    // Дополнительные поля, комментарий, диск, атрибуты — нули.
    view.setUint32(offset + 42, offsets[i]!, true);
    out.set(entry.nameBytes, offset + 46);
    offset += 46 + entry.nameBytes.length;
  });

  view.setUint32(offset, EOCD_SIGNATURE, true);
  view.setUint16(offset + 8, parts.length, true);
  view.setUint16(offset + 10, parts.length, true);
  view.setUint32(offset + 12, offset - directoryOffset, true);
  view.setUint32(offset + 16, directoryOffset, true);
  return out;
}
