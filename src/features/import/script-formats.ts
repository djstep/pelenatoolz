export type ScriptSourceFormat =
  | "docx"
  | "fdx"
  | "fountain"
  | "celtx"
  | "kitsp"
  | "text";

export const SCRIPT_ACCEPT =
  ".docx,.fdx,.fdxt,.fountain,.txt,.celtx,.kitsp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,application/xml,text/xml,application/octet-stream";

export const SCRIPT_FORMAT_HINT =
  "КИТ Сценарист (.kitsp), Word (.docx), Final Draft (.fdx), Fountain, Celtx, текст";

function extensionOf(fileName: string) {
  const m = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m?.[1] ?? "";
}

export function detectScriptFormat(
  fileName: string,
): ScriptSourceFormat | null {
  switch (extensionOf(fileName)) {
    case "docx":
      return "docx";
    case "fdx":
    case "fdxt":
      return "fdx";
    case "fountain":
    case "spmd":
      return "fountain";
    case "celtx":
      return "celtx";
    case "kitsp":
      return "kitsp";
    case "txt":
    case "text":
      return "text";
    default:
      return null;
  }
}

export function isScriptFile(file: File) {
  return detectScriptFormat(file.name) != null;
}

export function formatLabel(format: ScriptSourceFormat) {
  switch (format) {
    case "docx":
      return "Word";
    case "fdx":
      return "Final Draft";
    case "fountain":
      return "Fountain";
    case "celtx":
      return "Celtx";
    case "kitsp":
      return "КИТ Сценарист";
    case "text":
      return "Текст";
  }
}
