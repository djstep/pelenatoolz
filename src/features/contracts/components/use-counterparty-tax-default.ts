"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { taxDefaultFields } from "@/features/contracts/lib/tax-default";
import { counterpartyTaxDefaultAction } from "@/features/contracts/tax-default-actions";

type TaxFields = ReturnType<typeof taxDefaultFields>;

/**
 * Подставить налог по умолчанию по контрагенту (новый договор или акт). Ответ на устаревший
 * запрос (контрагента сменили, окно закрыли или открыли заново) отбрасывается — `cancel`.
 * Ошибка — поля не трогаются.
 */
export function useCounterpartyTaxDefault(projectId: string, apply: (fields: TaxFields) => void) {
  const lastRequest = useRef(0);
  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current = apply;
  });
  const request = useCallback(
    (counterpartyId: string) => {
      const current = ++lastRequest.current;
      if (!counterpartyId) {
        applyRef.current(taxDefaultFields({ mapped: false }));
        return;
      }
      void counterpartyTaxDefaultAction(projectId, counterpartyId)
        .then((result) => {
          if (current !== lastRequest.current || "error" in result) return;
          applyRef.current(taxDefaultFields(result.value));
        })
        .catch(() => {});
    },
    [projectId],
  );
  const cancel = useCallback(() => {
    lastRequest.current++;
  }, []);
  return useMemo(() => ({ request, cancel }), [request, cancel]);
}
