"use client";

import * as React from "react";
import {
  AddressBook as PhAddressBook,
  Alarm as PhAlarm,
  ArrowClockwise as PhArrowClockwise,
  ArrowCounterClockwise as PhArrowCounterClockwise,
  ArrowDown as PhArrowDown,
  ArrowElbowDownLeft as PhArrowElbowDownLeft,
  ArrowLeft as PhArrowLeft,
  ArrowRight as PhArrowRight,
  ArrowSquareOut as PhArrowSquareOut,
  ArrowUUpLeft as PhArrowUUpLeft,
  ArrowUUpRight as PhArrowUUpRight,
  ArrowUp as PhArrowUp,
  ArrowsOut as PhArrowsOut,
  Bell as PhBell,
  Book as PhBook,
  BookOpen as PhBookOpen,
  BookmarkSimple as PhBookmarkSimple,
  Brain as PhBrain,
  Briefcase as PhBriefcase,
  Buildings as PhBuildings,
  CalendarBlank as PhCalendarBlank,
  CalendarDots as PhCalendarDots,
  CaretDown as PhCaretDown,
  CaretLeft as PhCaretLeft,
  CaretRight as PhCaretRight,
  CaretUpDown as PhCaretUpDown,
  ChartLine as PhChartLine,
  ChartLineUp as PhChartLineUp,
  ChatCircle as PhChatCircle,
  ChatsCircle as PhChatsCircle,
  Check as PhCheck,
  CheckCircle as PhCheckCircle,
  CheckSquare as PhCheckSquare,
  Circle as PhCircle,
  CircleNotch as PhCircleNotch,
  Clipboard as PhClipboard,
  Clock as PhClock,
  ClockCounterClockwise as PhClockCounterClockwise,
  Cloud as PhCloud,
  Code as PhCode,
  Copy as PhCopy,
  Cpu as PhCpu,
  CurrencyDollar as PhCurrencyDollar,
  DotsThree as PhDotsThree,
  DownloadSimple as PhDownloadSimple,
  Envelope as PhEnvelope,
  EnvelopeSimple as PhEnvelopeSimple,
  Export as PhExport,
  FilePlus as PhFilePlus,
  FileText as PhFileText,
  FlagBanner as PhFlagBanner,
  FloppyDisk as PhFloppyDisk,
  FlowArrow as PhFlowArrow,
  Folder as PhFolder,
  Funnel as PhFunnel,
  Gear as PhGear,
  GearSix as PhGearSix,
  Globe as PhGlobe,
  Graph as PhGraph,
  GridFour as PhGridFour,
  Handshake as PhHandshake,
  HardDrives as PhHardDrives,
  Headset as PhHeadset,
  Image as PhImage,
  Key as PhKey,
  Lightning as PhLightning,
  Link as PhLink,
  LinkSimple as PhLinkSimple,
  List as PhList,
  ListBullets as PhListBullets,
  ListChecks as PhListChecks,
  ListNumbers as PhListNumbers,
  LockSimple as PhLockSimple,
  MagnifyingGlass as PhMagnifyingGlass,
  Microphone as PhMicrophone,
  Minus as PhMinus,
  Monitor as PhMonitor,
  Moon as PhMoon,
  Network as PhNetwork,
  Note as PhNote,
  NotePencil as PhNotePencil,
  Palette as PhPalette,
  PaperPlaneTilt as PhPaperPlaneTilt,
  Paperclip as PhPaperclip,
  Path as PhPath,
  Pause as PhPause,
  PencilSimple as PhPencilSimple,
  Play as PhPlay,
  Plugs as PhPlugs,
  PlugsConnected as PhPlugsConnected,
  Plus as PhPlus,
  Prohibit as PhProhibit,
  Question as PhQuestion,
  Quotes as PhQuotes,
  Receipt as PhReceipt,
  Robot as PhRobot,
  Rocket as PhRocket,
  SealCheck as PhSealCheck,
  ShareNetwork as PhShareNetwork,
  ShieldCheck as PhShieldCheck,
  SidebarSimple as PhSidebarSimple,
  SignOut as PhSignOut,
  SlidersHorizontal as PhSlidersHorizontal,
  Sparkle as PhSparkle,
  SquaresFour as PhSquaresFour,
  Stack as PhStack,
  Stop as PhStop,
  Sun as PhSun,
  TextB as PhTextB,
  TextHOne as PhTextHOne,
  TextHThree as PhTextHThree,
  TextHTwo as PhTextHTwo,
  TextItalic as PhTextItalic,
  TextStrikethrough as PhTextStrikethrough,
  TextUnderline as PhTextUnderline,
  Trash as PhTrash,
  Tray as PhTray,
  User as PhUser,
  UserCircle as PhUserCircle,
  UserFocus as PhUserFocus,
  Wallet as PhWallet,
  Warning as PhWarning,
  WarningCircle as PhWarningCircle,
  WarningDiamond as PhWarningDiamond,
  Wrench as PhWrench,
  X as PhX,
  XCircle as PhXCircle,
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

export const AddressBook = styled(PhAddressBook, "AddressBook");
export const Alarm = styled(PhAlarm, "Alarm");
export const ArrowClockwise = styled(PhArrowClockwise, "ArrowClockwise");
export const ArrowCounterClockwise = styled(PhArrowCounterClockwise, "ArrowCounterClockwise");
export const ArrowDown = styled(PhArrowDown, "ArrowDown");
export const ArrowElbowDownLeft = styled(PhArrowElbowDownLeft, "ArrowElbowDownLeft");
export const ArrowLeft = styled(PhArrowLeft, "ArrowLeft");
export const ArrowRight = styled(PhArrowRight, "ArrowRight");
export const ArrowRightIcon = styled(PhArrowRight, "ArrowRightIcon");
export const ArrowSquareOut = styled(PhArrowSquareOut, "ArrowSquareOut");
export const ArrowUUpLeft = styled(PhArrowUUpLeft, "ArrowUUpLeft");
export const ArrowUUpRight = styled(PhArrowUUpRight, "ArrowUUpRight");
export const ArrowUp = styled(PhArrowUp, "ArrowUp");
export const ArrowsOut = styled(PhArrowsOut, "ArrowsOut");
export const Bell = styled(PhBell, "Bell");
export const Book = styled(PhBook, "Book");
export const BookOpen = styled(PhBookOpen, "BookOpen");
export const BookmarkSimple = styled(PhBookmarkSimple, "BookmarkSimple");
export const Brain = styled(PhBrain, "Brain");
export const BrainIcon = styled(PhBrain, "BrainIcon");
export const Briefcase = styled(PhBriefcase, "Briefcase");
export const BriefcaseIcon = styled(PhBriefcase, "BriefcaseIcon");
export const Buildings = styled(PhBuildings, "Buildings");
export const CalendarBlank = styled(PhCalendarBlank, "CalendarBlank");
export const CalendarDots = styled(PhCalendarDots, "CalendarDots");
export const CalendarDotsIcon = styled(PhCalendarDots, "CalendarDotsIcon");
export const CaretDown = styled(PhCaretDown, "CaretDown");
export const CaretLeft = styled(PhCaretLeft, "CaretLeft");
export const CaretRight = styled(PhCaretRight, "CaretRight");
export const CaretUpDown = styled(PhCaretUpDown, "CaretUpDown");
export const ChartLineIcon = styled(PhChartLine, "ChartLineIcon");
export const ChartLineUp = styled(PhChartLineUp, "ChartLineUp");
export const ChatCircle = styled(PhChatCircle, "ChatCircle");
export const ChatsCircle = styled(PhChatsCircle, "ChatsCircle");
export const Check = styled(PhCheck, "Check");
export const CheckCircle = styled(PhCheckCircle, "CheckCircle");
export const CheckCircleIcon = styled(PhCheckCircle, "CheckCircleIcon");
export const CheckSquare = styled(PhCheckSquare, "CheckSquare");
export const Circle = styled(PhCircle, "Circle");
export const CircleIcon = styled(PhCircle, "CircleIcon");
export const CircleNotch = styled(PhCircleNotch, "CircleNotch");
export const CircleNotchIcon = styled(PhCircleNotch, "CircleNotchIcon");
export const Clipboard = styled(PhClipboard, "Clipboard");
export const Clock = styled(PhClock, "Clock");
export const ClockCounterClockwise = styled(PhClockCounterClockwise, "ClockCounterClockwise");
export const Cloud = styled(PhCloud, "Cloud");
export const Code = styled(PhCode, "Code");
export const CodeIcon = styled(PhCode, "CodeIcon");
export const Copy = styled(PhCopy, "Copy");
export const Cpu = styled(PhCpu, "Cpu");
export const CurrencyDollar = styled(PhCurrencyDollar, "CurrencyDollar");
export const DotsThree = styled(PhDotsThree, "DotsThree");
export const DownloadSimple = styled(PhDownloadSimple, "DownloadSimple");
export const EnvelopeIcon = styled(PhEnvelope, "EnvelopeIcon");
export const EnvelopeSimple = styled(PhEnvelopeSimple, "EnvelopeSimple");
export const Export = styled(PhExport, "Export");
export const ExportIcon = styled(PhExport, "ExportIcon");
export const FilePlus = styled(PhFilePlus, "FilePlus");
export const FileText = styled(PhFileText, "FileText");
export const FileTextIcon = styled(PhFileText, "FileTextIcon");
export const FlagBanner = styled(PhFlagBanner, "FlagBanner");
export const FloppyDisk = styled(PhFloppyDisk, "FloppyDisk");
export const FlowArrow = styled(PhFlowArrow, "FlowArrow");
export const FlowArrowIcon = styled(PhFlowArrow, "FlowArrowIcon");
export const Folder = styled(PhFolder, "Folder");
export const Funnel = styled(PhFunnel, "Funnel");
export const Gear = styled(PhGear, "Gear");
export const GearSix = styled(PhGearSix, "GearSix");
export const Globe = styled(PhGlobe, "Globe");
export const GlobeIcon = styled(PhGlobe, "GlobeIcon");
export const Graph = styled(PhGraph, "Graph");
export const GridFour = styled(PhGridFour, "GridFour");
export const Handshake = styled(PhHandshake, "Handshake");
export const HardDrives = styled(PhHardDrives, "HardDrives");
export const HardDrivesIcon = styled(PhHardDrives, "HardDrivesIcon");
export const Headset = styled(PhHeadset, "Headset");
export const HeadsetIcon = styled(PhHeadset, "HeadsetIcon");
export const Image = styled(PhImage, "Image");
export const Key = styled(PhKey, "Key");
export const Lightning = styled(PhLightning, "Lightning");
export const Link = styled(PhLink, "Link");
export const LinkSimple = styled(PhLinkSimple, "LinkSimple");
export const List = styled(PhList, "List");
export const ListBullets = styled(PhListBullets, "ListBullets");
export const ListChecks = styled(PhListChecks, "ListChecks");
export const ListNumbers = styled(PhListNumbers, "ListNumbers");
export const LockSimple = styled(PhLockSimple, "LockSimple");
export const MagnifyingGlass = styled(PhMagnifyingGlass, "MagnifyingGlass");
export const MagnifyingGlassIcon = styled(PhMagnifyingGlass, "MagnifyingGlassIcon");
export const Microphone = styled(PhMicrophone, "Microphone");
export const Minus = styled(PhMinus, "Minus");
export const Monitor = styled(PhMonitor, "Monitor");
export const MonitorIcon = styled(PhMonitor, "MonitorIcon");
export const Moon = styled(PhMoon, "Moon");
export const NetworkIcon = styled(PhNetwork, "NetworkIcon");
export const Note = styled(PhNote, "Note");
export const NotePencil = styled(PhNotePencil, "NotePencil");
export const Palette = styled(PhPalette, "Palette");
export const PaperPlaneTilt = styled(PhPaperPlaneTilt, "PaperPlaneTilt");
export const Paperclip = styled(PhPaperclip, "Paperclip");
export const Path = styled(PhPath, "Path");
export const PathIcon = styled(PhPath, "PathIcon");
export const Pause = styled(PhPause, "Pause");
export const PencilSimple = styled(PhPencilSimple, "PencilSimple");
export const Play = styled(PhPlay, "Play");
export const Plugs = styled(PhPlugs, "Plugs");
export const PlugsConnected = styled(PhPlugsConnected, "PlugsConnected");
export const PlugsConnectedIcon = styled(PhPlugsConnected, "PlugsConnectedIcon");
export const PlugsIcon = styled(PhPlugs, "PlugsIcon");
export const Plus = styled(PhPlus, "Plus");
export const Prohibit = styled(PhProhibit, "Prohibit");
export const Question = styled(PhQuestion, "Question");
export const Quotes = styled(PhQuotes, "Quotes");
export const Receipt = styled(PhReceipt, "Receipt");
export const Robot = styled(PhRobot, "Robot");
export const Rocket = styled(PhRocket, "Rocket");
export const SealCheck = styled(PhSealCheck, "SealCheck");
export const SealCheckIcon = styled(PhSealCheck, "SealCheckIcon");
export const ShareNetwork = styled(PhShareNetwork, "ShareNetwork");
export const ShieldCheck = styled(PhShieldCheck, "ShieldCheck");
export const SidebarSimple = styled(PhSidebarSimple, "SidebarSimple");
export const SignOut = styled(PhSignOut, "SignOut");
export const SlidersHorizontal = styled(PhSlidersHorizontal, "SlidersHorizontal");
export const Sparkle = styled(PhSparkle, "Sparkle");
export const SparkleIcon = styled(PhSparkle, "SparkleIcon");
export const SquaresFour = styled(PhSquaresFour, "SquaresFour");
export const Stack = styled(PhStack, "Stack");
export const StackIcon = styled(PhStack, "StackIcon");
export const Stop = styled(PhStop, "Stop");
export const Sun = styled(PhSun, "Sun");
export const TextB = styled(PhTextB, "TextB");
export const TextHOne = styled(PhTextHOne, "TextHOne");
export const TextHThree = styled(PhTextHThree, "TextHThree");
export const TextHTwo = styled(PhTextHTwo, "TextHTwo");
export const TextItalic = styled(PhTextItalic, "TextItalic");
export const TextStrikethrough = styled(PhTextStrikethrough, "TextStrikethrough");
export const TextUnderline = styled(PhTextUnderline, "TextUnderline");
export const Trash = styled(PhTrash, "Trash");
export const Tray = styled(PhTray, "Tray");
export const TrayIcon = styled(PhTray, "TrayIcon");
export const User = styled(PhUser, "User");
export const UserCircle = styled(PhUserCircle, "UserCircle");
export const UserFocus = styled(PhUserFocus, "UserFocus");
export const Wallet = styled(PhWallet, "Wallet");
export const Warning = styled(PhWarning, "Warning");
export const WarningCircle = styled(PhWarningCircle, "WarningCircle");
export const WarningCircleIcon = styled(PhWarningCircle, "WarningCircleIcon");
export const WarningDiamond = styled(PhWarningDiamond, "WarningDiamond");
export const WarningIcon = styled(PhWarning, "WarningIcon");
export const Wrench = styled(PhWrench, "Wrench");
export const X = styled(PhX, "X");
export const XCircle = styled(PhXCircle, "XCircle");
