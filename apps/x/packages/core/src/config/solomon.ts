import { z } from "zod";
import { SolomonApiConfig } from "@x/shared/dist/solomon-account.js";
import { API_URL } from "./env.js";

let cached: z.infer<typeof SolomonApiConfig> | null = null;

export async function getSolomonConfig(): Promise<z.infer<typeof SolomonApiConfig>> {
  if (cached) {
    return cached;
  }
  const response = await fetch(`${API_URL}/v1/config`);
  const data = SolomonApiConfig.parse(await response.json());
  cached = data;
  return data;
}
