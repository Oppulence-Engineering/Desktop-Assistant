export interface DictationMicrophoneDevice {
  deviceId: string;
  kind: string;
}

/**
 * Resolve the user's stable ranking against devices that are available right now.
 * Browser pseudo-devices (`default` / `communications`) are fallback routes rather
 * than physical inputs, so they never displace an explicitly ranked microphone.
 */
export function rankedAvailableMicrophoneIds(
  devices: DictationMicrophoneDevice[],
  priority: string[],
): string[] {
  const available = new Set(
    devices
      .filter(
        (device) =>
          device.kind === "audioinput" &&
          device.deviceId !== "default" &&
          device.deviceId !== "communications",
      )
      .map((device) => device.deviceId),
  );
  const seen = new Set<string>();
  return priority.filter((deviceId) => {
    if (!deviceId || seen.has(deviceId) || !available.has(deviceId)) return false;
    seen.add(deviceId);
    return true;
  });
}

export function uniqueMicrophonePriority(priority: string[]): string[] {
  const seen = new Set<string>();
  const normalizedPriority: string[] = [];
  for (const deviceId of priority) {
    const normalized = deviceId.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    normalizedPriority.push(normalized);
  }
  return normalizedPriority;
}
