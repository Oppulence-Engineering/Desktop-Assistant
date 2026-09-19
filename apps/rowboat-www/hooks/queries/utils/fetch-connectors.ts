import { ConnectorsResponseSchema } from "@/lib/api/connectors/schema";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";
import type { Connector } from "@/lib/api/generated/client/model";

const CONNECTORS_PATH = "/connectors";

export async function loadConnectors(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<Connector[]> {
  const body = await request({
    path: CONNECTORS_PATH,
    schema: ConnectorsResponseSchema,
    signal,
  });
  return body.connectors;
}

export function fetchConnectors(signal?: AbortSignal): Promise<Connector[]> {
  return loadConnectors(requestJson, signal);
}
