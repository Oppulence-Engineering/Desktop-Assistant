#!/usr/bin/env node
/**
 * Generates lib/icons.tsx — Phosphor re-exports with stable app-facing names.
 * Run after adding new icon imports so call sites stay on `@/lib/icons`.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, "../lib/icons.tsx");

/** App export name -> @phosphor-icons/react component name */
const MAP = {
  AddressBook: "AddressBook",
  Alarm: "Alarm",
  ArrowClockwise: "ArrowClockwise",
  ArrowCounterClockwise: "ArrowCounterClockwise",
  ArrowDown: "ArrowDown",
  ArrowElbowDownLeft: "ArrowElbowDownLeft",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  ArrowRightIcon: "ArrowRight",
  ArrowSquareOut: "ArrowSquareOut",
  ArrowUUpLeft: "ArrowUUpLeft",
  ArrowUUpRight: "ArrowUUpRight",
  ArrowUp: "ArrowUp",
  ArrowsOut: "ArrowsOut",
  Bell: "Bell",
  Book: "Book",
  BookOpen: "BookOpen",
  BookmarkSimple: "BookmarkSimple",
  Brain: "Brain",
  BrainIcon: "Brain",
  Briefcase: "Briefcase",
  BriefcaseIcon: "Briefcase",
  Buildings: "Buildings",
  CalendarBlank: "CalendarBlank",
  CalendarDots: "CalendarDots",
  CalendarDotsIcon: "CalendarDots",
  CaretDown: "CaretDown",
  CaretLeft: "CaretLeft",
  CaretRight: "CaretRight",
  CaretUpDown: "CaretUpDown",
  ChartLineIcon: "ChartLine",
  ChartLineUp: "ChartLineUp",
  ChatCircle: "ChatCircle",
  ChatsCircle: "ChatsCircle",
  Check: "Check",
  CheckCircle: "CheckCircle",
  CheckCircleIcon: "CheckCircle",
  CheckSquare: "CheckSquare",
  Circle: "Circle",
  CircleIcon: "Circle",
  CircleNotch: "CircleNotch",
  CircleNotchIcon: "CircleNotch",
  Clipboard: "Clipboard",
  Clock: "Clock",
  ClockCounterClockwise: "ClockCounterClockwise",
  Cloud: "Cloud",
  Code: "Code",
  CodeIcon: "Code",
  Copy: "Copy",
  Cpu: "Cpu",
  CurrencyDollar: "CurrencyDollar",
  DotsThree: "DotsThree",
  DownloadSimple: "DownloadSimple",
  EnvelopeIcon: "Envelope",
  EnvelopeSimple: "EnvelopeSimple",
  Export: "Export",
  ExportIcon: "Export",
  FilePlus: "FilePlus",
  FileText: "FileText",
  FileTextIcon: "FileText",
  FlagBanner: "FlagBanner",
  FloppyDisk: "FloppyDisk",
  FlowArrow: "FlowArrow",
  FlowArrowIcon: "FlowArrow",
  Folder: "Folder",
  Funnel: "Funnel",
  Gear: "Gear",
  GearSix: "GearSix",
  Globe: "Globe",
  GlobeIcon: "Globe",
  Graph: "Graph",
  GridFour: "GridFour",
  Handshake: "Handshake",
  HardDrives: "HardDrives",
  HardDrivesIcon: "HardDrives",
  Headset: "Headset",
  HeadsetIcon: "Headset",
  Image: "Image",
  Key: "Key",
  Lightning: "Lightning",
  Link: "Link",
  LinkSimple: "LinkSimple",
  List: "List",
  ListBullets: "ListBullets",
  ListChecks: "ListChecks",
  ListNumbers: "ListNumbers",
  LockSimple: "LockSimple",
  MagnifyingGlass: "MagnifyingGlass",
  MagnifyingGlassIcon: "MagnifyingGlass",
  Microphone: "Microphone",
  Minus: "Minus",
  Monitor: "Monitor",
  MonitorIcon: "Monitor",
  Moon: "Moon",
  NetworkIcon: "Network",
  Note: "Note",
  NotePencil: "NotePencil",
  Palette: "Palette",
  PaperPlaneTilt: "PaperPlaneTilt",
  Paperclip: "Paperclip",
  Path: "Path",
  PathIcon: "Path",
  Pause: "Pause",
  PencilSimple: "PencilSimple",
  Play: "Play",
  Plugs: "Plugs",
  PlugsConnected: "PlugsConnected",
  PlugsConnectedIcon: "PlugsConnected",
  PlugsIcon: "Plugs",
  Plus: "Plus",
  Prohibit: "Prohibit",
  Question: "Question",
  Quotes: "Quotes",
  Receipt: "Receipt",
  Robot: "Robot",
  Rocket: "Rocket",
  SealCheck: "SealCheck",
  SealCheckIcon: "SealCheck",
  ShareNetwork: "ShareNetwork",
  ShieldCheck: "ShieldCheck",
  SidebarSimple: "SidebarSimple",
  SignOut: "SignOut",
  SlidersHorizontal: "SlidersHorizontal",
  Sparkle: "Sparkle",
  SparkleIcon: "Sparkle",
  SquaresFour: "SquaresFour",
  Stack: "Stack",
  StackIcon: "Stack",
  Stop: "Stop",
  Sun: "Sun",
  TextB: "TextB",
  TextHOne: "TextHOne",
  TextHThree: "TextHThree",
  TextHTwo: "TextHTwo",
  TextItalic: "TextItalic",
  TextStrikethrough: "TextStrikethrough",
  TextUnderline: "TextUnderline",
  Trash: "Trash",
  Tray: "Tray",
  TrayIcon: "Tray",
  User: "User",
  UserCircle: "UserCircle",
  UserFocus: "UserFocus",
  Wallet: "Wallet",
  Warning: "Warning",
  WarningCircle: "WarningCircle",
  WarningCircleIcon: "WarningCircle",
  WarningDiamond: "WarningDiamond",
  WarningIcon: "Warning",
  Wrench: "Wrench",
  X: "X",
  XCircle: "XCircle",
};

const phosphorImports = [...new Set(Object.values(MAP))].sort();
const phosphorImportBlock = phosphorImports.map((name) => `${name} as Ph${name}`).join(",\n  ");

const header = `import * as React from "react";
import {
  ${phosphorImportBlock},
} from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

export type IconWeight = "thin" | "light" | "regular" | "bold" | "fill" | "duotone";

export type IconProps = React.SVGProps<SVGSVGElement> & {
  size?: number | string;
  weight?: IconWeight;
  title?: string;
};

export type IconComponent = React.ForwardRefExoticComponent<
  IconProps & React.RefAttributes<SVGSVGElement>
>;

/** Icon component type used in nav/config props. */
export type Icon = IconComponent;

/** Back-compat aliases for code that still references Lucide types. */
export type LucideIcon = IconComponent;
export type LucideProps = IconProps;
/** @deprecated Use Icon */
export type PhosphorIcon = IconComponent;

type BaseIcon = React.ComponentType<IconProps>;

function styled(Base: BaseIcon, displayName: string): IconComponent {
  const Wrapped = React.forwardRef<SVGSVGElement, IconProps>(function AppIcon(
    { className, size, style, title, weight = "regular", ...props },
    ref,
  ) {
    return (
      <Base
        ref={ref}
        aria-hidden={title ? undefined : "true"}
        aria-label={title}
        className={cn("app-icon shrink-0", className)}
        style={size != null ? { width: size, height: size, ...style } : style}
        weight={weight}
        {...props}
      />
    );
  });
  Wrapped.displayName = displayName;
  return Wrapped as unknown as IconComponent;
}

`;

const exports = Object.entries(MAP)
  .map(([alias, phosphorName]) => `export const ${alias} = styled(Ph${phosphorName}, "${alias}");`)
  .join("\n");

writeFileSync(outPath, `${header}${exports}\n`, "utf8");
console.log(`Wrote ${outPath} (${Object.keys(MAP).length} icons)`);
