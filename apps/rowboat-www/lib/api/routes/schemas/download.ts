import { z } from "zod";

export const DownloadAppSchema = z.enum(["desktop", "voice"]);
export const DownloadPlatformSchema = z.enum([
  "mac-arm64",
  "mac-x64",
  "windows-x64",
  "linux-deb-x64",
  "linux-deb-arm64",
  "linux-rpm-x64",
  "linux-rpm-arm64",
]);

export const DownloadQuerySchema = z.object({
  app: DownloadAppSchema.optional(),
  platform: DownloadPlatformSchema.optional(),
});
