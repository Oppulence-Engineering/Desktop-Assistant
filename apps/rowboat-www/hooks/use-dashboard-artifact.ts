"use client";

import "client-only";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ARTIFACT_DETAIL_STALE_TIME, artifactKeys } from "@/hooks/queries/utils/artifact-keys";
import {
  loadDashboardArtifact,
  saveDashboardArtifact,
  type DashboardArtifact,
} from "@/lib/dashboard-artifacts";
import type { SelectedResource } from "@/lib/dashboard-resource";

function resourceKey(resource: SelectedResource): string {
  return `${resource.kind}:${resource.name}`;
}

export function useDashboardArtifact(resource: SelectedResource | null) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const key = resource ? resourceKey(resource) : "";
  const queryKey = useMemo(
    () => artifactKeys.detail(resource?.kind, resource?.name),
    [resource?.kind, resource?.name],
  );
  const query = useQuery({
    queryKey,
    queryFn: () => {
      if (!resource) throw new Error("Artifact query requires a selected resource");
      return loadDashboardArtifact(resource);
    },
    enabled: resource !== null,
    staleTime: ARTIFACT_DETAIL_STALE_TIME,
  });

  const artifact = query.data;
  const text = drafts[key] ?? artifact?.text ?? "";
  const original = artifact?.text ?? "";
  const onChange = useCallback(
    (nextText: string) => {
      if (!key) return;
      setDrafts((current) => ({ ...current, [key]: nextText }));
    },
    [key],
  );
  const onSave = useCallback(async () => {
    if (!resource || !artifact || artifact.readOnly || text === original) return;
    setSavingKey(key);
    setSaveErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    try {
      const normalized = await saveDashboardArtifact(resource, artifact.fileType, text, original);
      queryClient.setQueryData<DashboardArtifact>(queryKey, {
        ...artifact,
        text: normalized,
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    } catch (error) {
      setSaveErrors((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : "Failed to save changes",
      }));
    } finally {
      setSavingKey(null);
    }
  }, [artifact, key, original, queryClient, queryKey, resource, text]);

  if (!resource) return null;
  return {
    resource,
    title: artifact?.title ?? resource.name,
    subtitle: artifact?.subtitle ?? "",
    text,
    original,
    fileType: artifact?.fileType ?? "json",
    readOnly: artifact?.readOnly ?? false,
    loading: query.isLoading || savingKey === key,
    error: saveErrors[key] ?? (query.error instanceof Error ? query.error.message : null),
    onChange,
    onSave,
  };
}
