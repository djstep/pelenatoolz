"use client";

import { useState } from "react";
import {
  exportCallSheetPdfAction,
  exportCallSheetXlsxAction,
} from "@/features/day-docs/actions";
import { Button } from "@/shared/ui/button";
import { useActionToast } from "@/shared/ui/toast";

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBase64(
  base64: string,
  fileName: string,
  mimeType: string,
) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  downloadBlob(new Blob([bytes], { type: mimeType }), fileName);
}

export function CallSheetExportButtons({
  projectId,
  dayId,
}: {
  projectId: string;
  dayId: string;
}) {
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);
  const [message, setMessage] = useState<{ error?: string; success?: string }>(
    {},
  );

  useActionToast(message);

  async function handleExportXlsx() {
    setExporting("xlsx");
    try {
      const result = await exportCallSheetXlsxAction(projectId, dayId);
      if ("error" in result) {
        setMessage({ error: result.error });
        return;
      }
      downloadBase64(
        result.base64,
        result.fileName,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      setMessage({ success: "Файл Excel сохранён" });
    } finally {
      setExporting(null);
    }
  }

  async function handleExportPdf() {
    setExporting("pdf");
    try {
      const result = await exportCallSheetPdfAction(projectId, dayId);
      if ("error" in result) {
        setMessage({ error: result.error });
        return;
      }
      downloadBase64(result.base64, result.fileName, "application/pdf");
      setMessage({ success: "Файл PDF сохранён" });
    } finally {
      setExporting(null);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={exporting != null}
        onClick={() => void handleExportPdf()}
      >
        {exporting === "pdf" ? "PDF…" : "PDF"}
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={exporting != null}
        onClick={() => void handleExportXlsx()}
      >
        {exporting === "xlsx" ? "Excel…" : "Excel"}
      </Button>
    </>
  );
}
