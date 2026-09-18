"use client";

import { CaretDown, DownloadSimple, Monitor } from "@/lib/icons";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import { ItemMedia } from "@oppulence/ui/components/item";
import { MarketingSpan, marketingSpanClass } from "./marketing-primitives";
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

/**
 * Installer picker for the two apps that ship binaries. `app` selects which
 * repository /api/download resolves against, so Voice never offers the
 * Desktop build (or the reverse).
 */
export function DesktopDownloadChooser({
  app = "desktop",
  name = "Oppulence Desktop",
  blurb = "Sign in once and continue with the same relationship state as the web app.",
  mode = "hero",
  defaultOpen = false,
  className,
}: {
  app?: "desktop" | "voice";
  name?: string;
  blurb?: string;
  /** `page` hides marketing extras and opens the installer panel by default on /download. */
  mode?: "hero" | "page";
  defaultOpen?: boolean;
  className?: string;
} = {}) {
  const [detection, setDetection] = useState<Detection>({
    architecture: null,
    operatingSystem: null,
  });
  const [isOpen, setIsOpen] = useState(defaultOpen);
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
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = downloadGroups.length - 1;
    const next =
      event.key === "ArrowLeft"
        ? (index || downloadGroups.length) - 1
        : event.key === "ArrowRight"
          ? (index + 1) % downloadGroups.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    const tab =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next];
    tab?.focus();
    tab?.click();
  };

  return (
    <div className={cn(mode === "page" ? "sim-download-chooser mt-0" : "mt-8", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Button
          aria-controls={panelId}
          aria-expanded={isOpen}
          className="desktop-download-trigger h-12 px-6 text-[14px] sm:w-[250px]"
          onClick={() => setIsOpen((current) => !current)}
          type="button"
        >
          Download {name === "Oppulence Desktop" ? "desktop app" : "Oppulence Voice"}
          <CaretDown
            aria-hidden="true"
            className="app-icon desktop-download-trigger-icon"
            weight="regular"
          />
        </Button>
        {mode === "hero" ? (
          <>
            <Button asChild className="h-12 w-full px-6 text-[14px] sm:w-auto" variant="outline">
              <Link href="/app">See account mission control</Link>
            </Button>
            <Button asChild className="h-12 px-5 text-[14px]" variant="ghost">
              <Link href="/product">
                How relationship intelligence works{" "}
                <Badge
                  aria-hidden="true"
                  className="ml-2 rounded-none border-0 bg-transparent p-0 font-normal text-foreground/40 shadow-none"
                  variant="ghost"
                >
                  →
                </Badge>
              </Link>
            </Button>
          </>
        ) : null}
      </div>
      {mode === "hero" ? (
        <p className="mt-3 font-mono text-xs text-[var(--linear-text-tertiary)]">
          macOS · Windows · Linux · choose the installer for your device
        </p>
      ) : null}

      <div className="desktop-download-collapse" hidden={!isOpen} id={panelId}>
        <section aria-label="Desktop app downloads" className="desktop-download-panel">
          <header className="desktop-download-panel-header">
            <p className="desktop-download-eyebrow">[{app} app · latest release]</p>
            <div className="desktop-download-panel-title">
              <DownloadSimple aria-hidden="true" className="app-icon" weight="regular" />
              <h2>Download {name}</h2>
            </div>
            <p>{blurb}</p>
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
                <Button
                  aria-controls={`${panelId}-${group.operatingSystem}-panel`}
                  aria-selected={isSelected}
                  className="desktop-download-tab h-auto justify-start gap-2 rounded-none px-3 py-2"
                  id={`${panelId}-${group.operatingSystem}-tab`}
                  key={group.operatingSystem}
                  onKeyDown={(event) => handleTabKeyDown(event, downloadGroups.indexOf(group))}
                  onClick={() => {
                    selectionChanged.current = true;
                    setSelectedOperatingSystem(group.operatingSystem);
                  }}
                  role="tab"
                  tabIndex={isSelected ? 0 : -1}
                  type="button"
                  variant={isSelected ? "secondary" : "ghost"}
                >
                  <Monitor aria-hidden="true" className="app-icon" weight="regular" />
                  <Badge
                    className="rounded-none border-0 bg-transparent p-0 text-xs font-medium shadow-none"
                    variant="ghost"
                  >
                    {group.title}
                  </Badge>
                  {isDetected ? <em>{detectionLabel(detection)}</em> : null}
                </Button>
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
              <Badge
                className="rounded-none border-0 bg-transparent p-0 font-mono text-[10px] uppercase shadow-none"
                variant="ghost"
              >
                Choose an installer
              </Badge>
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
                    aria-label={`Download ${name} for ${selectedGroup.title}: ${option.label}, ${option.detail}`}
                    className={cn("desktop-download-option", isRecommended && "is-recommended")}
                    href={`/api/download?app=${app}&platform=${option.platform}`}
                    key={option.platform}
                    prefetch={false}
                  >
                    <DownloadSimple aria-hidden="true" className="app-icon" weight="regular" />
                    <ItemMedia className="desktop-download-option-copy" variant="default">
                      <strong>{option.label}</strong>
                      <small>{option.detail}</small>
                    </ItemMedia>
                    {isRecommended ? (
                      <Badge className="desktop-download-device rounded-none" variant="outline">
                        Recommended
                      </Badge>
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
