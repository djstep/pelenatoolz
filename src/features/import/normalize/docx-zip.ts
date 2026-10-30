import { inflateRawSync } from "zlib";

/** Лимиты распаковки docx (пункт 20 аудита): защита от zip-бомбы. */
export const DOCX_LIMITS = {
  /** Файлов в архиве. В обычном docx их десятки. */
  maxEntries: 1000,
  /** Сумма распакованных размеров всех файлов архива. */
  maxTotalUncompressed: 30 * 1024 * 1024,
  /** Распакованный `word/document.xml`. */
  maxDocumentXml: 20 * 1024 * 1024,
} as const;

export type DocxReadErrorCode =
  | "not_zip"
  | "not_docx"
  | "too_many_files"
  | "too_large"
  | "unsupported";

export class DocxReadError extends Error {
  constructor(public readonly code: DocxReadErrorCode) {
    super(`docx: ${code}`);
    this.name = "DocxReadError";
  }
}

export function isDocxReadError(error: unknown): error is DocxReadError {
  return error instanceof DocxReadError;
}

type ZipEntry = {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function findEndOfCentralDirectory(buffer: Buffer) {
  const minOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minOffset; offset--) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

/** Каталог архива по центральной записи (размеры из локальных заголовков не берём). */
function readCentralDirectory(buffer: Buffer): ZipEntry[] {
  if (buffer.length < 22) throw new DocxReadError("not_zip");
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) throw new DocxReadError("not_zip");

  const total = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  // Zip64 в docx до 3,5 МБ не нужен.
  if (total === 0xffff || directoryOffset === 0xffffffff) {
    throw new DocxReadError("unsupported");
  }
  if (total > DOCX_LIMITS.maxEntries) throw new DocxReadError("too_many_files");

  const entries: ZipEntry[] = [];
  let offset = directoryOffset;
  for (let i = 0; i < total; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new DocxReadError("not_zip");
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    entries.push({
      flags: buffer.readUInt16LE(offset + 8),
      method: buffer.readUInt16LE(offset + 10),
      compressedSize: buffer.readUInt32LE(offset + 20),
      uncompressedSize: buffer.readUInt32LE(offset + 24),
      localHeaderOffset: buffer.readUInt32LE(offset + 42),
      name: buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function inflateEntry(buffer: Buffer, entry: ZipEntry, maxBytes: number): Buffer {
  // Бит 0 — шифрование.
  if (entry.flags & 0x1) throw new DocxReadError("unsupported");
  const local = entry.localHeaderOffset;
  if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== LOCAL_SIGNATURE) {
    throw new DocxReadError("not_zip");
  }
  const dataStart =
    local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) throw new DocxReadError("not_zip");
  const data = buffer.subarray(dataStart, dataEnd);

  if (entry.method === 0) {
    if (data.length > maxBytes) throw new DocxReadError("too_large");
    return Buffer.from(data);
  }
  if (entry.method !== 8) throw new DocxReadError("unsupported");
  try {
    // Размер в каталоге может врать — останавливаем распаковку на лимите.
    return inflateRawSync(data, { maxOutputLength: maxBytes });
  } catch (error) {
    if (error instanceof RangeError) throw new DocxReadError("too_large");
    throw new DocxReadError("not_zip");
  }
}

export type DocxParts = {
  documentXml: string;
  stylesXml: string | null;
};

/**
 * Достаёт из docx `document.xml` и `styles.xml`.
 * docx определяется по содержимому (zip + `[Content_Types].xml` + `word/document.xml`), не по расширению.
 */
export function readDocxParts(buffer: Buffer): DocxParts {
  const entries = readCentralDirectory(buffer);

  const declaredTotal = entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  if (declaredTotal > DOCX_LIMITS.maxTotalUncompressed) {
    throw new DocxReadError("too_large");
  }

  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const document = byName.get("word/document.xml");
  if (!byName.has("[Content_Types].xml") || !document) {
    throw new DocxReadError("not_docx");
  }

  const documentXml = inflateEntry(buffer, document, DOCX_LIMITS.maxDocumentXml);
  const styles = byName.get("word/styles.xml");
  const stylesXml = styles
    ? inflateEntry(
        buffer,
        styles,
        DOCX_LIMITS.maxTotalUncompressed - documentXml.length,
      )
    : null;

  return {
    documentXml: documentXml.toString("utf8"),
    stylesXml: stylesXml?.toString("utf8") ?? null,
  };
}
