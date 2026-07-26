"use client";

import DesktopIcon from "@mui/icons-material/DesktopWindowsOutlined";
import DownloadIcon from "@mui/icons-material/DownloadOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMoreOutlined";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type OperatingSystem = "linux" | "mac" | "windows";
type Architecture = "arm64" | "x64";

type Detection = {
  architecture: Architecture | null;
  operatingSystem: OperatingSystem | null;
};

type DownloadOption = {
  architecture: Architecture;
  detail: string;
  label: string;
  platform:
    | "linux-deb-arm64"
    | "linux-deb-x64"
    | "linux-rpm-arm64"
    | "linux-rpm-x64"
    | "mac-arm64"
    | "mac-x64"
    | "windows-x64";
  recommendedDefault?: boolean;
};

type DownloadGroup = {
  options: DownloadOption[];
  operatingSystem: OperatingSystem;
  title: string;
};

type NavigatorWithArchitecture = Navigator & {
  userAgentData?: {
    getHighEntropyValues(hints: string[]): Promise<{ architecture?: string }>;
  };
};

const downloadGroups: DownloadGroup[] = [
  {
    operatingSystem: "mac",
    title: "macOS",
    options: [
      {
        architecture: "arm64",
        detail: "M1 or newer · DMG",
        label: "Apple silicon",
        platform: "mac-arm64",
        recommendedDefault: true,
      },
      {
        architecture: "x64",
        detail: "Intel · DMG",
        label: "Intel Mac",
        platform: "mac-x64",
        recommendedDefault: true,
      },
    ],
  },
  {
    operatingSystem: "windows",
    title: "Windows",
    options: [
      {
        architecture: "x64",
        detail: "Installer · EXE",
        label: "Windows x64",
        platform: "windows-x64",
        recommendedDefault: true,
      },
    ],
  },
  {
    operatingSystem: "linux",
    title: "Linux",
    options: [
      {
        architecture: "x64",
        detail: "x64 · DEB",
        label: "Debian / Ubuntu",
        platform: "linux-deb-x64",
        recommendedDefault: true,
      },
      {
        architecture: "arm64",
        detail: "ARM64 · DEB",
        label: "Debian / Ubuntu",
        platform: "linux-deb-arm64",
        recommendedDefault: true,
      },
      {
        architecture: "x64",
        detail: "x64 · RPM",
        label: "Fedora / RHEL",
        platform: "linux-rpm-x64",
      },
      {
        architecture: "arm64",
        detail: "ARM64 · RPM",
        label: "Fedora / RHEL",
        platform: "linux-rpm-arm64",
      },
    ],
  },
];

function detectOperatingSystem(userAgent: string): OperatingSystem | null {
  const normalized = userAgent.toLowerCase();

  if (normalized.includes("macintosh") || normalized.includes("mac os")) {
    return "mac";
  }
  if (normalized.includes("windows")) {
    return "windows";
  }
  if (normalized.includes("linux") && !normalized.includes("android")) {
    return "linux";
  }
  return null;
}

function detectVisibleArchitecture(
  userAgent: string,
  operatingSystem: OperatingSystem | null,
): Architecture | null {
  const normalized = userAgent.toLowerCase();

  // macOS browsers intentionally report "Intel" on both architectures.
  if (operatingSystem === "mac") {
    return null;
  }
  if (normalized.includes("arm64") || normalized.includes("aarch64")) {
    return "arm64";
  }
  if (normalized.includes("x86_64") || normalized.includes("win64") || normalized.includes("x64")) {
    return "x64";
  }
  return null;
}

function architectureFromClientHint(value?: string): Architecture | null {
  const normalized = value?.toLowerCase() ?? "";

  if (normalized.includes("arm")) {
    return "arm64";
  }
  if (normalized.includes("x86")) {
    return "x64";
  }
  return null;
}

function detectionLabel(detection: Detection): string {
  if (detection.architecture === "arm64") {
    return "Detected · ARM64";
  }
  if (detection.architecture === "x64") {
    return "Detected · x64";
  }
  return "Detected";
}

export function DesktopDownloadChooser() {
  const [detection, setDetection] = useState<Detection>({
    architecture: null,
    operatingSystem: null,
  });
  const [isOpen, setIsOpen] = useState(false);
  const [selectedOperatingSystem, setSelectedOperatingSystem] = useState<OperatingSystem>("mac");
  const selectionChanged = useRef(false);
  const panelId = useId();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const operatingSystem = detectOperatingSystem(navigator.userAgent);
      let architecture = detectVisibleArchitecture(navigator.userAgent, operatingSystem);
      const userAgentData = (navigator as NavigatorWithArchitecture).userAgentData;

      if (userAgentData?.getHighEntropyValues) {
        try {
          const clientHints = await userAgentData.getHighEntropyValues(["architecture"]);
          architecture = architectureFromClientHint(clientHints.architecture) ?? architecture;
        } catch {
          // Explicit choices remain available when client hints are blocked.
        }
      }

      if (!cancelled) {
        setDetection({ architecture, operatingSystem });
        if (operatingSystem && !selectionChanged.current) {
          setSelectedOperatingSystem(operatingSystem);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedGroup =
    downloadGroups.find((group) => group.operatingSystem === selectedOperatingSystem) ??
    downloadGroups[0];

  return (
    <div className="mt-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          aria-controls={panelId}
          aria-expanded={isOpen}
          className="desktop-download-trigger linear-button-primary !h-12 !px-6 !text-[14px] sm:!w-[250px]"
          onClick={() => setIsOpen((current) => !current)}
          type="button"
        >
          Download desktop app
          <ExpandMoreIcon aria-hidden="true" className="desktop-download-trigger-icon" />
        </button>
        <Link
          className="linear-button-secondary !h-12 !w-full !px-6 !text-[14px] sm:!w-auto"
          href="/book-a-demo"
        >
          See account mission control
        </Link>
        <Link className="linear-button-ghost !h-12 !px-5 !text-[14px]" href="/product">
          How relationship intelligence works <span className="ml-2 text-foreground/40">→</span>
        </Link>
      </div>
      <p className="mt-3 font-mono text-xs text-[var(--linear-text-tertiary)]">
        macOS · Windows · Linux · choose the installer for your device
      </p>

      <div className="desktop-download-collapse" hidden={!isOpen} id={panelId}>
        <section aria-label="Desktop app downloads" className="desktop-download-panel">
          <header className="desktop-download-panel-header">
            <p className="desktop-download-eyebrow">[desktop app · latest release]</p>
            <div className="desktop-download-panel-title">
              <DownloadIcon aria-hidden="true" />
              <h2>Download Oppulence Desktop</h2>
            </div>
            <p>Sign in once and continue with the same relationship state as the web app.</p>
          </header>

          <div
            aria-label="Choose an operating system"
            className="desktop-download-tabs"
            role="tablist"
          >
            {downloadGroups.map((group) => {
              const isDetected = detection.operatingSystem === group.operatingSystem;
              const isSelected = selectedOperatingSystem === group.operatingSystem;

              return (
                <button
                  aria-controls={`${panelId}-${group.operatingSystem}-panel`}
                  aria-selected={isSelected}
                  className="desktop-download-tab"
                  id={`${panelId}-${group.operatingSystem}-tab`}
                  key={group.operatingSystem}
                  onClick={() => {
                    selectionChanged.current = true;
                    setSelectedOperatingSystem(group.operatingSystem);
                  }}
                  role="tab"
                  type="button"
                >
                  <DesktopIcon aria-hidden="true" />
                  <span>{group.title}</span>
                  {isDetected ? <em>{detectionLabel(detection)}</em> : null}
                </button>
              );
            })}
          </div>

          <div
            aria-labelledby={`${panelId}-${selectedGroup.operatingSystem}-tab`}
            className="desktop-download-platform"
            id={`${panelId}-${selectedGroup.operatingSystem}-panel`}
            role="tabpanel"
          >
            <div className="desktop-download-platform-heading">
              <span>Choose an installer</span>
              <strong>{selectedGroup.title}</strong>
            </div>

            <div
              className={cn(
                "desktop-download-options",
                selectedGroup.options.length > 2 && "is-dense",
              )}
            >
              {selectedGroup.options.map((option) => {
                const isRecommended =
                  detection.operatingSystem === selectedGroup.operatingSystem &&
                  detection.architecture === option.architecture &&
                  option.recommendedDefault;

                return (
                  <Link
                    aria-label={`Download Oppulence Desktop for ${selectedGroup.title}: ${option.label}, ${option.detail}`}
                    className={cn("desktop-download-option", isRecommended && "is-recommended")}
                    href={`/api/download?platform=${option.platform}`}
                    key={option.platform}
                    prefetch={false}
                  >
                    <DownloadIcon aria-hidden="true" />
                    <span className="desktop-download-option-copy">
                      <strong>{option.label}</strong>
                      <small>{option.detail}</small>
                    </span>
                    {isRecommended ? (
                      <span className="desktop-download-device">Recommended</span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
