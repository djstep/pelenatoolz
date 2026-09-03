"use client";

import { useState } from "react";
import { CastListExportModal } from "@/features/casting/components/cast-list-export-modal";
import type { CastListExportBundleClient } from "@/features/casting/lib/cast-list-export-data";
import { Button } from "@/shared/ui/button";

export function CastListExportButton({
  projectId,
  locale,
  bundle,
}: {
  projectId: string;
  locale: string;
  bundle: CastListExportBundleClient;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Экспорт каст-листа
      </Button>
      <CastListExportModal
        projectId={projectId}
        locale={locale}
        bundle={bundle}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
