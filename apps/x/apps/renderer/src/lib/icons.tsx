import * as React from "react";
import {
  ArchiveBoxIcon as HiArchiveBoxIcon,
  ArrowDownIcon as HiArrowDownIcon,
  ArrowDownOnSquareIcon as HiArrowDownOnSquareIcon,
  ArrowDownTrayIcon as HiArrowDownTrayIcon,
  ArrowLeftIcon as HiArrowLeftIcon,
  ArrowPathIcon as HiArrowPathIcon,
  ArrowPathRoundedSquareIcon as HiArrowPathRoundedSquareIcon,
  ArrowRightIcon as HiArrowRightIcon,
  ArrowRightStartOnRectangleIcon as HiArrowRightStartOnRectangleIcon,
  ArrowTopRightOnSquareIcon as HiArrowTopRightOnSquareIcon,
  ArrowTurnDownLeftIcon as HiArrowTurnDownLeftIcon,
  ArrowUpIcon as HiArrowUpIcon,
  ArrowUpRightIcon as HiArrowUpRightIcon,
  ArrowUturnLeftIcon as HiArrowUturnLeftIcon,
  ArrowUturnRightIcon as HiArrowUturnRightIcon,
  Bars3Icon as HiBars3Icon,
  BoldIcon as HiBoldIcon,
  BoltIcon as HiBoltIcon,
  BookOpenIcon as HiBookOpenIcon,
  BugAntIcon as HiBugAntIcon,
  CalendarDaysIcon as HiCalendarDaysIcon,
  CalendarIcon as HiCalendarIcon,
  ChartBarIcon as HiChartBarIcon,
  ChatBubbleLeftRightIcon as HiChatBubbleLeftRightIcon,
  ChatBubbleOvalLeftIcon as HiChatBubbleOvalLeftIcon,
  CheckCircleIcon as HiCheckCircleIcon,
  CheckIcon as HiCheckIcon,
  ChevronDoubleLeftIcon as HiChevronDoubleLeftIcon,
  ChevronDoubleRightIcon as HiChevronDoubleRightIcon,
  ChevronDownIcon as HiChevronDownIcon,
  ChevronLeftIcon as HiChevronLeftIcon,
  ChevronRightIcon as HiChevronRightIcon,
  ChevronUpIcon as HiChevronUpIcon,
  ClipboardDocumentCheckIcon as HiClipboardDocumentCheckIcon,
  ClockIcon as HiClockIcon,
  CloudArrowUpIcon as HiCloudArrowUpIcon,
  CloudIcon as HiCloudIcon,
  CodeBracketIcon as HiCodeBracketIcon,
  CodeBracketSquareIcon as HiCodeBracketSquareIcon,
  Cog6ToothIcon as HiCog6ToothIcon,
  CommandLineIcon as HiCommandLineIcon,
  ComputerDesktopIcon as HiComputerDesktopIcon,
  CpuChipIcon as HiCpuChipIcon,
  CreditCardIcon as HiCreditCardIcon,
  DocumentIcon as HiDocumentIcon,
  DocumentPlusIcon as HiDocumentPlusIcon,
  DocumentTextIcon as HiDocumentTextIcon,
  EllipsisHorizontalIcon as HiEllipsisHorizontalIcon,
  EnvelopeIcon as HiEnvelopeIcon,
  ExclamationCircleIcon as HiExclamationCircleIcon,
  ExclamationTriangleIcon as HiExclamationTriangleIcon,
  EyeIcon as HiEyeIcon,
  FilmIcon as HiFilmIcon,
  FolderIcon as HiFolderIcon,
  FolderOpenIcon as HiFolderOpenIcon,
  FolderPlusIcon as HiFolderPlusIcon,
  FunnelIcon as HiFunnelIcon,
  GlobeAltIcon as HiGlobeAltIcon,
  H1Icon as HiH1Icon,
  H2Icon as HiH2Icon,
  H3Icon as HiH3Icon,
  HomeIcon as HiHomeIcon,
  InformationCircleIcon as HiInformationCircleIcon,
  ItalicIcon as HiItalicIcon,
  KeyIcon as HiKeyIcon,
  LightBulbIcon as HiLightBulbIcon,
  LinkIcon as HiLinkIcon,
  ListBulletIcon as HiListBulletIcon,
  MagnifyingGlassIcon as HiMagnifyingGlassIcon,
  MapPinIcon as HiMapPinIcon,
  MicrophoneIcon as HiMicrophoneIcon,
  MinusIcon as HiMinusIcon,
  MoonIcon as HiMoonIcon,
  MusicalNoteIcon as HiMusicalNoteIcon,
  NumberedListIcon as HiNumberedListIcon,
  PaperAirplaneIcon as HiPaperAirplaneIcon,
  PaperClipIcon as HiPaperClipIcon,
  PauseIcon as HiPauseIcon,
  PencilIcon as HiPencilIcon,
  PencilSquareIcon as HiPencilSquareIcon,
  PhotoIcon as HiPhotoIcon,
  PlayIcon as HiPlayIcon,
  PlusCircleIcon as HiPlusCircleIcon,
  PlusIcon as HiPlusIcon,
  PowerIcon as HiPowerIcon,
  PresentationChartBarIcon as HiPresentationChartBarIcon,
  QuestionMarkCircleIcon as HiQuestionMarkCircleIcon,
  QueueListIcon as HiQueueListIcon,
  ServerIcon as HiServerIcon,
  ShareIcon as HiShareIcon,
  ShieldCheckIcon as HiShieldCheckIcon,
  ShieldExclamationIcon as HiShieldExclamationIcon,
  SignalIcon as HiSignalIcon,
  SparklesIcon as HiSparklesIcon,
  SpeakerWaveIcon as HiSpeakerWaveIcon,
  Square2StackIcon as HiSquare2StackIcon,
  Squares2X2Icon as HiSquares2X2Icon,
  StopIcon as HiStopIcon,
  StrikethroughIcon as HiStrikethroughIcon,
  SunIcon as HiSunIcon,
  SwatchIcon as HiSwatchIcon,
  TableCellsIcon as HiTableCellsIcon,
  TagIcon as HiTagIcon,
  TrashIcon as HiTrashIcon,
  UserCircleIcon as HiUserCircleIcon,
  UserIcon as HiUserIcon,
  UsersIcon as HiUsersIcon,
  VideoCameraIcon as HiVideoCameraIcon,
  ViewColumnsIcon as HiViewColumnsIcon,
  ViewfinderCircleIcon as HiViewfinderCircleIcon,
  WrenchIcon as HiWrenchIcon,
  XCircleIcon as HiXCircleIcon,
  XMarkIcon as HiXMarkIcon,
} from "@heroicons/react/24/outline";
import { cn } from "@/lib/utils";

/**
 * Centralized icon surface for the desktop app — backed by **Heroicons**
 * (https://heroicons.com, `@heroicons/react` 24/outline).
 *
 * Import icons from here (`@/lib/icons`), never from a vendor package directly.
 * Every export is a Heroicon (or a hand-drawn glyph for the few Heroicons lacks)
 * wrapped so it always carries the `app-icon` class — the hook the icon polish in
 * `App.css` targets (1.5 stroke, round caps, hover firm-up, press dip,
 * selected-state weight) — and a `size-6` (24px) default that callers override
 * via `size-*`/`w-*`/`h-*` classes or a numeric `size` prop. Export names mirror
 * the icon names the app already used, so call sites did not change when we moved
 * off Lucide.
 */

export const ICON_STROKE_WIDTH = 1.5;
export const ICON_SIZE = 16;

/** Props every app icon accepts: standard SVG props + a Lucide-compatible numeric
 *  `size` (mapped to width/height) + Heroicons' title/titleId. */
export type AppIconProps = Omit<React.SVGProps<SVGSVGElement>, "ref"> & {
  title?: string;
  titleId?: string;
  /** Square size in px (or any CSS length) — Lucide-compatible. */
  size?: number | string;
};

export type IconComponent = React.ForwardRefExoticComponent<
  AppIconProps & React.RefAttributes<SVGSVGElement>
>;

/** Back-compat aliases for code that still references the old Lucide types. */
export type LucideIcon = IconComponent;
export type LucideProps = AppIconProps;

type BaseIcon = React.ComponentType<React.SVGProps<SVGSVGElement>>;

/** Wrap a Heroicon/custom glyph so it carries `app-icon`, a default size, and a
 *  Lucide-compatible numeric `size` prop (translated to inline width/height,
 *  which wins over the default size class). */
function styled(Base: BaseIcon, displayName: string): IconComponent {
  const Wrapped = React.forwardRef<SVGSVGElement, AppIconProps>(function AppIcon(
    { className, size, style, ...props },
    ref,
  ) {
    return (
      <Base
        ref={ref as React.Ref<SVGSVGElement>}
        aria-hidden="true"
        className={cn("app-icon size-6", className)}
        style={size != null ? { width: size, height: size, ...style } : style}
        {...props}
      />
    );
  });
  Wrapped.displayName = displayName;
  return Wrapped as unknown as IconComponent;
}

/* Glyphs Heroicons doesn't ship — drawn in the 24x24 / 1.5-stroke Heroicons
   style so they sit consistently beside the rest of the set. */
const glyphProps: React.SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

const CircleGlyph = React.forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>(
  function CircleGlyph(props, ref) {
    return (
      <svg ref={ref} {...glyphProps} {...props}>
        <circle cx="12" cy="12" r="8.25" />
      </svg>
    );
  },
);

const CircleDotGlyph = React.forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>(
  function CircleDotGlyph(props, ref) {
    return (
      <svg ref={ref} {...glyphProps} {...props}>
        <circle cx="12" cy="12" r="8.25" />
        <circle cx="12" cy="12" r="2.25" fill="currentColor" stroke="none" />
      </svg>
    );
  },
);

const QuoteGlyph = React.forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>(
  function QuoteGlyph(props, ref) {
    return (
      <svg ref={ref} {...glyphProps} {...props}>
        <path d="M5.25 5.5v13" />
        <path d="M9.5 8h9.25" />
        <path d="M9.5 12h9.25" />
        <path d="M9.5 16h6" />
      </svg>
    );
  },
);

// ---- App icon name -> styled(Heroicon | custom glyph) ----
export const AlertCircle = styled(HiExclamationCircleIcon, "AlertCircle");
export const AlertCircleIcon = styled(HiExclamationCircleIcon, "AlertCircleIcon");
export const AlertTriangle = styled(HiExclamationTriangleIcon, "AlertTriangle");
export const AlertTriangleIcon = styled(HiExclamationTriangleIcon, "AlertTriangleIcon");
export const Archive = styled(HiArchiveBoxIcon, "Archive");
export const ArrowDown = styled(HiArrowDownIcon, "ArrowDown");
export const ArrowDownIcon = styled(HiArrowDownIcon, "ArrowDownIcon");
export const ArrowLeft = styled(HiArrowLeftIcon, "ArrowLeft");
export const ArrowRight = styled(HiArrowRightIcon, "ArrowRight");
export const ArrowUp = styled(HiArrowUpIcon, "ArrowUp");
export const ArrowUpIcon = styled(HiArrowUpIcon, "ArrowUpIcon");
export const ArrowUpRight = styled(HiArrowUpRightIcon, "ArrowUpRight");
export const AudioLines = styled(HiSpeakerWaveIcon, "AudioLines");
export const BarChart3 = styled(HiChartBarIcon, "BarChart3");
export const Bold = styled(HiBoldIcon, "Bold");
export const BoldIcon = styled(HiBoldIcon, "BoldIcon");
export const BookOpen = styled(HiBookOpenIcon, "BookOpen");
export const BrainIcon = styled(HiCpuChipIcon, "BrainIcon");
export const Bug = styled(HiBugAntIcon, "Bug");
export const Calendar = styled(HiCalendarIcon, "Calendar");
export const CalendarClock = styled(HiCalendarDaysIcon, "CalendarClock");
export const Check = styled(HiCheckIcon, "Check");
export const CheckCheck = styled(HiCheckIcon, "CheckCheck");
export const CheckCircle = styled(HiCheckCircleIcon, "CheckCircle");
export const CheckCircle2 = styled(HiCheckCircleIcon, "CheckCircle2");
export const CheckCircle2Icon = styled(HiCheckCircleIcon, "CheckCircle2Icon");
export const CheckCircleIcon = styled(HiCheckCircleIcon, "CheckCircleIcon");
export const CheckIcon = styled(HiCheckIcon, "CheckIcon");
export const ChevronDown = styled(HiChevronDownIcon, "ChevronDown");
export const ChevronDownIcon = styled(HiChevronDownIcon, "ChevronDownIcon");
export const ChevronLeft = styled(HiChevronLeftIcon, "ChevronLeft");
export const ChevronLeftIcon = styled(HiChevronLeftIcon, "ChevronLeftIcon");
export const ChevronRight = styled(HiChevronRightIcon, "ChevronRight");
export const ChevronRightIcon = styled(HiChevronRightIcon, "ChevronRightIcon");
export const ChevronUpIcon = styled(HiChevronUpIcon, "ChevronUpIcon");
export const Circle = styled(CircleGlyph, "Circle");
export const CircleCheck = styled(HiCheckCircleIcon, "CircleCheck");
export const CircleCheckIcon = styled(HiCheckCircleIcon, "CircleCheckIcon");
export const CircleDot = styled(CircleDotGlyph, "CircleDot");
export const CircleIcon = styled(CircleGlyph, "CircleIcon");
export const Clock = styled(HiClockIcon, "Clock");
export const Cloud = styled(HiCloudIcon, "Cloud");
export const CodeIcon = styled(HiCodeBracketIcon, "CodeIcon");
export const CodeSquareIcon = styled(HiCodeBracketSquareIcon, "CodeSquareIcon");
export const Copy = styled(HiSquare2StackIcon, "Copy");
export const CornerDownLeftIcon = styled(HiArrowTurnDownLeftIcon, "CornerDownLeftIcon");
export const CreditCard = styled(HiCreditCardIcon, "CreditCard");
export const Download = styled(HiArrowDownTrayIcon, "Download");
export const DownloadIcon = styled(HiArrowDownTrayIcon, "DownloadIcon");
export const ExternalLink = styled(HiArrowTopRightOnSquareIcon, "ExternalLink");
export const ExternalLinkIcon = styled(HiArrowTopRightOnSquareIcon, "ExternalLinkIcon");
export const Eye = styled(HiEyeIcon, "Eye");
export const File = styled(HiDocumentIcon, "File");
export const FileArchive = styled(HiArchiveBoxIcon, "FileArchive");
export const FileAudioIcon = styled(HiMusicalNoteIcon, "FileAudioIcon");
export const FileCode2 = styled(HiCodeBracketIcon, "FileCode2");
export const FileIcon = styled(HiDocumentIcon, "FileIcon");
export const FileImageIcon = styled(HiPhotoIcon, "FileImageIcon");
export const FilePlus = styled(HiDocumentPlusIcon, "FilePlus");
export const FileSpreadsheet = styled(HiTableCellsIcon, "FileSpreadsheet");
export const FileText = styled(HiDocumentTextIcon, "FileText");
export const FileTextIcon = styled(HiDocumentTextIcon, "FileTextIcon");
export const FileTypeIcon = styled(HiDocumentIcon, "FileTypeIcon");
export const FileVideo = styled(HiFilmIcon, "FileVideo");
export const FileVideoIcon = styled(HiFilmIcon, "FileVideoIcon");
export const Filter = styled(HiFunnelIcon, "Filter");
export const FilterIcon = styled(HiFunnelIcon, "FilterIcon");
export const Folder = styled(HiFolderIcon, "Folder");
export const FolderCheck = styled(HiFolderIcon, "FolderCheck");
export const FolderClock = styled(HiFolderIcon, "FolderClock");
export const FolderCog = styled(HiFolderIcon, "FolderCog");
export const FolderOpen = styled(HiFolderOpenIcon, "FolderOpen");
export const FolderPlus = styled(HiFolderPlusIcon, "FolderPlus");
export const Forward = styled(HiArrowUturnRightIcon, "Forward");
export const GitBranch = styled(HiShareIcon, "GitBranch");
export const Globe = styled(HiGlobeAltIcon, "Globe");
export const GlobeIcon = styled(HiGlobeAltIcon, "GlobeIcon");
export const Heading1Icon = styled(HiH1Icon, "Heading1Icon");
export const Heading2Icon = styled(HiH2Icon, "Heading2Icon");
export const Heading3Icon = styled(HiH3Icon, "Heading3Icon");
export const Headphones = styled(HiSpeakerWaveIcon, "Headphones");
export const HelpCircle = styled(HiQuestionMarkCircleIcon, "HelpCircle");
export const HistoryIcon = styled(HiClockIcon, "HistoryIcon");
export const Home = styled(HiHomeIcon, "Home");
export const Image = styled(HiPhotoIcon, "Image");
export const ImageIcon = styled(HiPhotoIcon, "ImageIcon");
export const ImagePlus = styled(HiPhotoIcon, "ImagePlus");
export const InfoIcon = styled(HiInformationCircleIcon, "InfoIcon");
export const Italic = styled(HiItalicIcon, "Italic");
export const ItalicIcon = styled(HiItalicIcon, "ItalicIcon");
export const Key = styled(HiKeyIcon, "Key");
export const KeyRound = styled(HiKeyIcon, "KeyRound");
export const Laptop = styled(HiComputerDesktopIcon, "Laptop");
export const LayoutGridIcon = styled(HiSquares2X2Icon, "LayoutGridIcon");
export const Lightbulb = styled(HiLightBulbIcon, "Lightbulb");
export const Link = styled(HiLinkIcon, "Link");
export const Link2 = styled(HiLinkIcon, "Link2");
export const Link2Icon = styled(HiLinkIcon, "Link2Icon");
export const LinkIcon = styled(HiLinkIcon, "LinkIcon");
export const List = styled(HiListBulletIcon, "List");
export const ListChecks = styled(HiClipboardDocumentCheckIcon, "ListChecks");
export const ListFilter = styled(HiFunnelIcon, "ListFilter");
export const ListIcon = styled(HiListBulletIcon, "ListIcon");
export const ListOrdered = styled(HiNumberedListIcon, "ListOrdered");
export const ListOrderedIcon = styled(HiNumberedListIcon, "ListOrderedIcon");
export const ListTodoIcon = styled(HiQueueListIcon, "ListTodoIcon");
export const Loader = styled(HiArrowPathIcon, "Loader");
export const Loader2 = styled(HiArrowPathIcon, "Loader2");
export const Loader2Icon = styled(HiArrowPathIcon, "Loader2Icon");
export const LoaderIcon = styled(HiArrowPathIcon, "LoaderIcon");
export const LogOut = styled(HiArrowRightStartOnRectangleIcon, "LogOut");
export const Mail = styled(HiEnvelopeIcon, "Mail");
export const MapPin = styled(HiMapPinIcon, "MapPin");
export const MessageCircle = styled(HiChatBubbleOvalLeftIcon, "MessageCircle");
export const MessageCircleIcon = styled(HiChatBubbleOvalLeftIcon, "MessageCircleIcon");
export const MessageSquare = styled(HiChatBubbleLeftRightIcon, "MessageSquare");
export const MessageSquareIcon = styled(HiChatBubbleLeftRightIcon, "MessageSquareIcon");
export const Mic = styled(HiMicrophoneIcon, "Mic");
export const MicIcon = styled(HiMicrophoneIcon, "MicIcon");
export const MinusIcon = styled(HiMinusIcon, "MinusIcon");
export const Monitor = styled(HiComputerDesktopIcon, "Monitor");
export const Moon = styled(HiMoonIcon, "Moon");
export const MoreHorizontal = styled(HiEllipsisHorizontalIcon, "MoreHorizontal");
export const Music = styled(HiMusicalNoteIcon, "Music");
export const Network = styled(HiShareIcon, "Network");
export const NetworkIcon = styled(HiShareIcon, "NetworkIcon");
export const NotebookPen = styled(HiPencilSquareIcon, "NotebookPen");
export const OctagonXIcon = styled(HiXCircleIcon, "OctagonXIcon");
export const Palette = styled(HiSwatchIcon, "Palette");
export const PanelLeftIcon = styled(HiBars3Icon, "PanelLeftIcon");
export const PanelRight = styled(HiViewColumnsIcon, "PanelRight");
export const PanelRightClose = styled(HiChevronDoubleRightIcon, "PanelRightClose");
export const PanelRightOpen = styled(HiChevronDoubleLeftIcon, "PanelRightOpen");
export const Paperclip = styled(HiPaperClipIcon, "Paperclip");
export const PaperclipIcon = styled(HiPaperClipIcon, "PaperclipIcon");
export const Pause = styled(HiPauseIcon, "Pause");
export const Pencil = styled(HiPencilIcon, "Pencil");
export const Play = styled(HiPlayIcon, "Play");
export const Plug = styled(HiPowerIcon, "Plug");
export const Plus = styled(HiPlusIcon, "Plus");
export const PlusCircleIcon = styled(HiPlusCircleIcon, "PlusCircleIcon");
export const PlusIcon = styled(HiPlusIcon, "PlusIcon");
export const Presentation = styled(HiPresentationChartBarIcon, "Presentation");
export const Quote = styled(QuoteGlyph, "Quote");
export const QuoteIcon = styled(QuoteGlyph, "QuoteIcon");
export const Radio = styled(HiSignalIcon, "Radio");
export const RefreshCw = styled(HiArrowPathIcon, "RefreshCw");
export const RefreshCwIcon = styled(HiArrowPathIcon, "RefreshCwIcon");
export const Repeat = styled(HiArrowPathIcon, "Repeat");
export const Reply = styled(HiArrowUturnLeftIcon, "Reply");
export const ReplyAll = styled(HiArrowUturnLeftIcon, "ReplyAll");
export const RotateCcw = styled(HiArrowPathIcon, "RotateCcw");
export const RotateCw = styled(HiArrowPathIcon, "RotateCw");
export const Save = styled(HiArrowDownOnSquareIcon, "Save");
export const ScanSearch = styled(HiViewfinderCircleIcon, "ScanSearch");
export const Search = styled(HiMagnifyingGlassIcon, "Search");
export const SearchIcon = styled(HiMagnifyingGlassIcon, "SearchIcon");
export const Send = styled(HiPaperAirplaneIcon, "Send");
export const Server = styled(HiServerIcon, "Server");
export const Settings = styled(HiCog6ToothIcon, "Settings");
export const Shield = styled(HiShieldCheckIcon, "Shield");
export const ShieldAlertIcon = styled(HiShieldExclamationIcon, "ShieldAlertIcon");
export const ShieldCheck = styled(HiShieldCheckIcon, "ShieldCheck");
export const ShieldCheckIcon = styled(HiShieldCheckIcon, "ShieldCheckIcon");
export const ShieldQuestion = styled(HiShieldExclamationIcon, "ShieldQuestion");
export const Sparkles = styled(HiSparklesIcon, "Sparkles");
export const Square = styled(HiStopIcon, "Square");
export const SquareIcon = styled(HiStopIcon, "SquareIcon");
export const SquarePen = styled(HiPencilSquareIcon, "SquarePen");
export const Strikethrough = styled(HiStrikethroughIcon, "Strikethrough");
export const StrikethroughIcon = styled(HiStrikethroughIcon, "StrikethroughIcon");
export const Sun = styled(HiSunIcon, "Sun");
export const Table2 = styled(HiTableCellsIcon, "Table2");
export const Tags = styled(HiTagIcon, "Tags");
export const Terminal = styled(HiCommandLineIcon, "Terminal");
export const Trash2 = styled(HiTrashIcon, "Trash2");
export const Trash2Icon = styled(HiTrashIcon, "Trash2Icon");
export const TriangleAlertIcon = styled(HiExclamationTriangleIcon, "TriangleAlertIcon");
export const UploadCloud = styled(HiCloudArrowUpIcon, "UploadCloud");
export const User = styled(HiUserIcon, "User");
export const UserRound = styled(HiUserCircleIcon, "UserRound");
export const UsersRound = styled(HiUsersIcon, "UsersRound");
export const Video = styled(HiVideoCameraIcon, "Video");
export const Waypoints = styled(HiShareIcon, "Waypoints");
export const Workflow = styled(HiArrowPathRoundedSquareIcon, "Workflow");
export const Wrench = styled(HiWrenchIcon, "Wrench");
export const X = styled(HiXMarkIcon, "X");
export const XCircleIcon = styled(HiXCircleIcon, "XCircleIcon");
export const XIcon = styled(HiXMarkIcon, "XIcon");
export const Zap = styled(HiBoltIcon, "Zap");

export interface IconProps extends AppIconProps {
  /** The icon component to render. */
  icon: IconComponent;
}

/** Render an icon passed as data (e.g. nav configs): `<Icon icon={Settings} />`. */
export function Icon({ icon: IconCmp, className, ...props }: IconProps) {
  return <IconCmp className={cn("size-4 shrink-0", className)} {...props} />;
}
