import mammoth from "mammoth";
import { inflateRawSync } from "zlib";
import {
  detectScriptFormat,
  type ScriptSourceFormat,
} from "@/features/import/script-formats";

export {
  SCRIPT_ACCEPT,
  detectScriptFormat,
  type ScriptSourceFormat,
} from "@/features/import/script-formats";

function decodeXmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) =>
      String.fromCharCode(parseInt(n, 16)),
    );
}

function readZipEntry(buffer: Buffer, entryName: string): string | null {
  let offset = 0;
  while (offset + 30 < buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer
      .subarray(offset + 30, offset + 30 + nameLen)
      .toString("utf8");
    const dataStart = offset + 30 + nameLen + extraLen;
    const data = buffer.subarray(dataStart, dataStart + compSize);
    offset = dataStart + compSize;

    if (name !== entryName && !name.endsWith(`/${entryName}`)) continue;

    let raw: Buffer;
    if (method === 0) raw = Buffer.from(data);
    else if (method === 8) raw = inflateRawSync(data);
    else continue;
    return raw.toString("utf8");
  }
  return null;
}

async function extractDocx(buffer: Buffer): Promise<string> {
  let text = "";
  try {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value ?? "";
  } catch {
    text = "";
  }

  const xml = readZipEntry(buffer, "word/document.xml");
  if (xml) {
    const paragraphs = xml.split(/<\/w:p>/i);
    const fallback = paragraphs
      .map((paragraph) => {
        const withBreaks = paragraph
          .replace(/<w:tab\s*\/>/gi, "\t")
          .replace(/<w:br\b[^>]*\/?>/gi, "\n");
        return [...withBreaks.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/gi)]
          .map((m) => decodeXmlEntities(m[1] ?? ""))
          .join("");
      })
      .join("\n");
    if (
      !text.trim() ||
      (fallback.trim().length > text.trim().length &&
        /(ИНТ|НАТ|INT|EXT)\./iu.test(fallback))
    ) {
      text = fallback;
    }
  }

  return text;
}

/** Final Draft / Fade In / WriterDuet / Celtx FDX export */
function extractFdxStructured(xml: string): string {
  const paragraphs = [
    ...xml.matchAll(/<Paragraph\b([^>]*)>([\s\S]*?)<\/Paragraph>/gi),
  ];

  type Block = {
    heading: string;
    characters: string[];
    body: string[];
  };

  const scenes: Block[] = [];
  let current: Block | null = null;

  for (const match of paragraphs) {
    const attrs = match[1] ?? "";
    const inner = match[2] ?? "";
    const type = (
      attrs.match(/\bType="([^"]+)"/i)?.[1] ??
      attrs.match(/\bType='([^']+)'/i)?.[1] ??
      ""
    ).toLowerCase();
    const number =
      attrs.match(/\bNumber="([^"]+)"/i)?.[1] ??
      attrs.match(/\bNumber='([^']+)'/i)?.[1];

    const text = [...inner.matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/gi)]
      .map((m) => decodeXmlEntities(m[1]!.replace(/<[^>]+>/g, "")))
      .join("")
      .replace(/\s+/g, " ")
      .trim();

    if (type === "scene heading") {
      if (current) scenes.push(current);
      current = {
        heading: number ? `${number}. ${text}` : text,
        characters: [],
        body: [],
      };
      continue;
    }

    if (!current || !text) continue;

    if (type === "character") {
      const name = text.replace(/\s*\(.*\)\s*$/, "").trim().toUpperCase();
      if (name && !current.characters.includes(name)) {
        current.characters.push(name);
      }
      continue;
    }

    if (
      type === "action" ||
      type === "dialogue" ||
      type === "parenthetical" ||
      type === "general" ||
      type === "shot" ||
      type === "transition"
    ) {
      current.body.push(text);
    }
  }

  if (current) scenes.push(current);

  return scenes
    .map((s) =>
      [s.heading, s.characters.join(", "), ...s.body]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

function extractFountain(text: string): string {
  let body = text.replace(/^\uFEFF/, "");
  const titleMatch = body.match(/^(?:[\w .]+\s*:\s*.+\n)+(\n+)/);
  if (titleMatch && titleMatch.index === 0) {
    body = body.slice(titleMatch[0].length);
  }

  body = body.replace(/(^|\n)\.(\s*(?:INT|EXT|ИНТ|НАТ)\b)/giu, "$1$2");
  body = body.replace(
    /(^|\n)([^\n]*?)\s+#([A-Za-z0-9.]+)#\s*(?=\n|$)/g,
    (_, br, heading, num) => `${br}${num}. ${heading.trim()}`,
  );

  return body;
}

function extractCeltx(buffer: Buffer): string {
  const candidates = ["project.simplex", "script.xml", "project.xml"];

  for (const name of candidates) {
    const xml = readZipEntry(buffer, name);
    if (!xml) continue;
    if (/<Paragraph\b/i.test(xml) || /FinalDraft/i.test(xml)) {
      return extractFdxStructured(xml);
    }
    const texts = [...xml.matchAll(/>([^<]{2,})</g)]
      .map((m) => decodeXmlEntities(m[1]!.trim()))
      .filter((t) => t && !/^[\d.]+$/.test(t));
    if (texts.length > 20) return texts.join("\n");
  }

  let offset = 0;
  while (offset + 30 < buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer
      .subarray(offset + 30, offset + 30 + nameLen)
      .toString("utf8");
    const dataStart = offset + 30 + nameLen + extraLen;
    const data = buffer.subarray(dataStart, dataStart + compSize);
    offset = dataStart + compSize;

    if (!/\.(xml|simplex|html)$/i.test(name)) continue;
    let raw: Buffer;
    try {
      if (method === 0) raw = Buffer.from(data);
      else if (method === 8) raw = inflateRawSync(data);
      else continue;
    } catch {
      continue;
    }
    const xml = raw.toString("utf8");
    if (/Type="Scene Heading"/i.test(xml) || /ИНТ\.|INT\./i.test(xml)) {
      if (/<Paragraph\b/i.test(xml)) return extractFdxStructured(xml);
      return xml.replace(/<[^>]+>/g, "\n").replace(/\n{3,}/g, "\n\n");
    }
  }

  return "";
}

/**
 * KIT Scenarist (.kitsp) = SQLite DB.
 * Script lives in `scenario.text` as XML with blocks:
 * <scene_heading><v><![CDATA[...]]></v></scene_heading>
 * <scene_characters>...</scene_characters>
 */
async function extractKitsp(buffer: Buffer): Promise<string> {
  const initSqlJs = (await import("sql.js")).default;
  const fs = await import("fs");
  const path = await import("path");

  const wasmPath = path.join(
    process.cwd(),
    "node_modules",
    "sql.js",
    "dist",
    "sql-wasm.wasm",
  );
  const wasmFile = fs.readFileSync(wasmPath);
  const SQL = await initSqlJs({
    wasmBinary: wasmFile.buffer.slice(
      wasmFile.byteOffset,
      wasmFile.byteOffset + wasmFile.byteLength,
    ),
  });
  const db = new SQL.Database(new Uint8Array(buffer));

  try {
    const tables = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const tableNames = new Set(
      (tables[0]?.values ?? []).map((row: unknown[]) =>
        String(row[0] ?? "").toLowerCase(),
      ),
    );

    let xml = "";

    if (tableNames.has("scenario")) {
      const draftCols = db.exec("PRAGMA table_info(scenario)");
      const colNames = (draftCols[0]?.values ?? []).map((r: unknown[]) =>
        String(r[1] ?? "").toLowerCase(),
      );
      const hasDraft = colNames.includes("is_draft");
      const hasText = colNames.includes("text");

      if (hasText) {
        const rows = db.exec(
          hasDraft
            ? "SELECT text, is_draft FROM scenario ORDER BY is_draft ASC, id ASC"
            : "SELECT text FROM scenario ORDER BY id ASC",
        );
        const values = rows[0]?.values ?? [];
        // Prefer non-draft (is_draft=0), else first
        const preferred =
          values.find((row: unknown[]) => Number(row[1] ?? 0) === 0) ??
          values[0];
        xml = String(preferred?.[0] ?? "");
      }
    }

    // Starc / newer variants sometimes use different table names
    if (!xml && tableNames.has("screenplay_text")) {
      const rows = db.exec(
        "SELECT text FROM screenplay_text ORDER BY id ASC LIMIT 1",
      );
      xml = String(rows[0]?.values?.[0]?.[0] ?? "");
    }

    if (!xml) {
      // Fallback: find largest text-ish blob containing scene_heading
      for (const table of tableNames) {
        if (!/^[a-zA-Z0-9_]+$/.test(table)) continue;
        try {
          const info = db.exec(`PRAGMA table_info("${table}")`);
          const cols = (info[0]?.values ?? []).map((r: unknown[]) =>
            String(r[1]),
          );
          for (const col of cols) {
            if (!/^[a-zA-Z0-9_]+$/.test(col)) continue;
            const rows = db.exec(`SELECT "${col}" FROM "${table}" LIMIT 20`);
            for (const row of rows[0]?.values ?? []) {
              const cell = String(row[0] ?? "");
              if (cell.includes("scene_heading") && cell.length > xml.length) {
                xml = cell;
              }
            }
          }
        } catch {
          // skip unreadable tables
        }
      }
    }

    if (!xml) return "";
    return kitspXmlToText(xml);
  } finally {
    db.close();
  }
}

function kitspBlockText(blockXml: string): string {
  const cdata = [...blockXml.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map(
    (m) => m[1] ?? "",
  );
  if (cdata.length) return cdata.join("").trim();

  const vTags = [...blockXml.matchAll(/<v\b[^>]*>([\s\S]*?)<\/v>/gi)].map((m) =>
    (m[1] ?? "").replace(/<[^>]+>/g, ""),
  );
  if (vTags.length) return vTags.join("").trim();

  return blockXml.replace(/<[^>]+>/g, "").trim();
}

function kitspXmlToText(xml: string): string {
  const blocks = [
    ...xml.matchAll(
      /<(scene_heading|scene_characters|action|character|dialog|dialogue|parenthetical|transition|note|lyrics|title|scene_description|time_and_place|folder_header|folder_footer|noprintable_text)\b[^>]*>([\s\S]*?)<\/\1>/gi,
    ),
  ];

  type Scene = { heading: string; characters: string[]; body: string[] };
  const scenes: Scene[] = [];
  let current: Scene | null = null;
  let sceneIndex = 0;

  for (const match of blocks) {
    const type = (match[1] ?? "").toLowerCase();
    const text = kitspBlockText(match[2] ?? "");
    if (!text && type !== "scene_heading") continue;

    if (type === "scene_heading") {
      if (current) scenes.push(current);
      sceneIndex += 1;
      // If heading already starts with a number, keep it; else prefix
      const numbered = /^\d+[A-Za-zА-Яа-я]?[.\)]?\s+/.test(text)
        ? text
        : `${sceneIndex}. ${text}`;
      current = { heading: numbered, characters: [], body: [] };
      continue;
    }

    if (!current) continue;

    if (type === "scene_characters") {
      const names = text
        .split(/[,;]/)
        .map((n) => n.trim())
        .filter(Boolean);
      for (const name of names) {
        const upper = name.toUpperCase();
        if (!current.characters.includes(upper)) current.characters.push(upper);
      }
      continue;
    }

    if (type === "character") {
      const name = text.replace(/\s*\(.*\)\s*$/, "").trim().toUpperCase();
      if (name && !current.characters.includes(name)) {
        current.characters.push(name);
      }
      continue;
    }

    if (
      type === "action" ||
      type === "dialog" ||
      type === "dialogue" ||
      type === "parenthetical" ||
      type === "transition" ||
      type === "note" ||
      type === "lyrics" ||
      type === "scene_description" ||
      type === "time_and_place"
    ) {
      current.body.push(text);
    }
  }

  if (current) scenes.push(current);

  return scenes
    .map((s) =>
      [s.heading, s.characters.join(", "), ...s.body].filter(Boolean).join("\n"),
    )
    .join("\n\n");
}

export async function extractScriptText(
  file: File,
): Promise<{ text: string; format: ScriptSourceFormat }> {
  const format = detectScriptFormat(file.name);
  if (!format) {
    throw new Error("unsupported");
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (format === "docx") {
    return { text: (await extractDocx(buffer)).trim(), format };
  }

  if (format === "fdx") {
    return { text: extractFdxStructured(buffer.toString("utf8")).trim(), format };
  }

  if (format === "fountain" || format === "text") {
    return {
      text: extractFountain(buffer.toString("utf8")).trim(),
      format,
    };
  }

  if (format === "celtx") {
    return { text: extractCeltx(buffer).trim(), format };
  }

  if (format === "kitsp") {
    return { text: (await extractKitsp(buffer)).trim(), format };
  }

  return { text: "", format };
}
