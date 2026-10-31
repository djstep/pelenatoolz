import { deflateRawSync } from "zlib";

/** Только для автотестов: собирает zip и docx в памяти, без пакетов. */

export type ZipFile = {
  name: string;
  data: Buffer | string;
  /** По умолчанию сжатие (8); 0 — без сжатия. */
  method?: 0 | 8;
  /** Подменить размер в каталоге архива («архив врёт о размере»). */
  declaredSize?: number;
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildZip(files: ZipFile[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, "utf8");
    const method = file.method ?? 8;
    const stored = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(file.name, "utf8");
    const crc = crc32(raw);
    const size = file.declaredSize ?? raw.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, stored);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += 30 + name.length + stored.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** Минимальный docx: тело `w:body`, при необходимости стили, нумерация и прочие файлы. */
export function buildDocx(options: {
  body: string;
  styles?: string;
  numbering?: string;
  extra?: ZipFile[];
}): Buffer {
  const files: ZipFile[] = [
    { name: "[Content_Types].xml", data: "<Types/>" },
    {
      name: "word/document.xml",
      data: `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${options.body}</w:body></w:document>`,
    },
  ];
  if (options.styles) {
    files.push({ name: "word/styles.xml", data: `<w:styles ${W}>${options.styles}</w:styles>` });
  }
  if (options.numbering) {
    files.push({
      name: "word/numbering.xml",
      data: `<w:numbering ${W}>${options.numbering}</w:numbering>`,
    });
  }
  return buildZip([...files, ...(options.extra ?? [])]);
}

/** Абзац со стилем (id) и текстом одного прогона. */
export function p(text: string, styleId?: string, pPrExtra = "") {
  const pPr = styleId || pPrExtra
    ? `<w:pPr>${styleId ? `<w:pStyle w:val="${styleId}"/>` : ""}${pPrExtra}</w:pPr>`
    : "";
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}
