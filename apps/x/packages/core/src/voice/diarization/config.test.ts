import { describe, expect, it } from "vitest";
import {
  diarizationActive,
  diarizationModeFor,
  parseEnvFlag,
  resolveDiarizationSettings,
} from "./config.js";
import { DEFAULT_DIARIZATION_SETTINGS } from "@x/shared/dist/diarization.js";

describe("parseEnvFlag", () => {
  it("parses truthy/falsy values and leaves unknown/unset as undefined", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on"]) expect(parseEnvFlag(v)).toBe(true);
    for (const v of ["0", "false", "no", "off"]) expect(parseEnvFlag(v)).toBe(false);
    expect(parseEnvFlag(undefined)).toBeUndefined();
    expect(parseEnvFlag("maybe")).toBeUndefined();
  });
});

describe("resolveDiarizationSettings", () => {
  it("defaults to off with no persisted config and no env", () => {
    const s = resolveDiarizationSettings(null, {});
    expect(s).toEqual(DEFAULT_DIARIZATION_SETTINGS);
    expect(s.enabled).toBe(false);
  });

  it("env flags override the persisted settings", () => {
    const s = resolveDiarizationSettings(
      { enabled: false, refinement: true },
      {
        LOCAL_DIARIZATION_ENABLED: "true",
        LOCAL_DIARIZATION_REFINEMENT: "false",
        LOCAL_DIARIZATION_FIXTURE_MODE: "1",
      },
    );
    expect(s.enabled).toBe(true);
    expect(s.refinement).toBe(false);
    expect(s.fixtureMode).toBe(true);
  });

  it("keeps persisted values when env is unset", () => {
    const s = resolveDiarizationSettings({ enabled: true, maxSpeakers: 4 }, {});
    expect(s.enabled).toBe(true);
    expect(s.maxSpeakers).toBe(4);
  });
});

describe("diarizationActive / diarizationModeFor", () => {
  const on = { ...DEFAULT_DIARIZATION_SETTINGS, enabled: true };
  const off = { ...DEFAULT_DIARIZATION_SETTINGS, enabled: false };

  it("is active only when enabled AND on-device", () => {
    expect(diarizationActive(on, "whisper-local")).toBe(true);
    expect(diarizationActive(on, "deepgram")).toBe(false);
    expect(diarizationActive(off, "whisper-local")).toBe(false);
  });

  it("maps to beta when active, off otherwise or on failure", () => {
    expect(diarizationModeFor(on, "whisper-local")).toBe("beta");
    expect(diarizationModeFor(on, "deepgram")).toBe("off");
    expect(diarizationModeFor(off, "whisper-local")).toBe("off");
    expect(diarizationModeFor(on, "whisper-local", false)).toBe("off");
  });
});
