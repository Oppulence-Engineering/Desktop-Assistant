"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchStartRevenueLeakScan,
  type StartRevenueLeakScanInput,
} from "@/hooks/queries/utils/mutate-start-revenue-leak-scan";
import { startRevenueLeakScanKeys } from "@/hooks/queries/utils/start-revenue-leak-scan-keys";
import { revenueScanKeys } from "@/hooks/queries/utils/revenue-scan-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Start revenue leak scan. The transport stays in a non-client
 * module. Owned by `use-start-revenue-leak-scan.lit.ts`.
 */
export function useStartRevenueLeakScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: StartRevenueLeakScanInput) => fetchStartRevenueLeakScan(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: startRevenueLeakScanKeys.all });
      void queryClient.invalidateQueries({ queryKey: revenueScanKeys.all });
    },
  });
}
