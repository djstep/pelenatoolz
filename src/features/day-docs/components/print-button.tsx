"use client";

import { Button } from "@/shared/ui/button";

export function PrintButton({ label = "Печать" }: { label?: string }) {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
