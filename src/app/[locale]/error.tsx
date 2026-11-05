"use client";

import { RouteError } from "@/shared/ui/route-error";

export default function Error(props: { error: unknown; retry: () => void }) {
  return <RouteError {...props} />;
}
