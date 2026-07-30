import * as React from "react";
import {
  Archive as PhArchive,
  ArrowDown as PhArrowDown,
  ArrowElbowDownLeft as PhArrowElbowDownLeft,
  ArrowLeft as PhArrowLeft,
  ArrowRight as PhArrowRight,
  ArrowSquareOut as PhArrowSquareOut,
  ArrowUp as PhArrowUp,
  ArrowUpRight as PhArrowUpRight,
  ArrowUUpLeft as PhArrowUUpLeft,
  ArrowUUpRight as PhArrowUUpRight,
  ArrowsClockwise as PhArrowsClockwise,
  ArrowsCounterClockwise as PhArrowsCounterClockwise,
  Bell as PhBell,
  BookOpen as PhBookOpen,
  Broadcast as PhBroadcast,
  Bug as PhBug,
  Calendar as PhCalendar,
  CalendarDots as PhCalendarDots,
  CaretDoubleLeft as PhCaretDoubleLeft,
  CaretDoubleRight as PhCaretDoubleRight,
  CaretDown as PhCaretDown,
  CaretLeft as PhCaretLeft,
  CaretRight as PhCaretRight,
  CaretUp as PhCaretUp,
  ChartBar as PhChartBar,
  ChatCircle as PhChatCircle,
  ChatsCircle as PhChatsCircle,
  Check as PhCheck,
  CheckCircle as PhCheckCircle,
  Checks as PhChecks,
  Circle as PhCircle,
  CircleNotch as PhCircleNotch,
  Clock as PhClock,
  Cloud as PhCloud,
  CloudArrowUp as PhCloudArrowUp,
  Code as PhCode,
  CodeBlock as PhCodeBlock,
  Columns as PhColumns,
  Copy as PhCopy,
  Cpu as PhCpu,
  CreditCard as PhCreditCard,
  DotsThree as PhDotsThree,
  DownloadSimple as PhDownloadSimple,
  Envelope as PhEnvelope,
  Eye as PhEye,
  File as PhFile,
  FileArchive as PhFileArchive,
  FileAudio as PhFileAudio,
  FileCode as PhFileCode,
  FileCsv as PhFileCsv,
  FileImage as PhFileImage,
  FilePlus as PhFilePlus,
  FileText as PhFileText,
  FileVideo as PhFileVideo,
  FloppyDisk as PhFloppyDisk,
  FlowArrow as PhFlowArrow,
  Folder as PhFolder,
  FolderOpen as PhFolderOpen,
  FolderPlus as PhFolderPlus,
  Funnel as PhFunnel,
  GearSix as PhGearSix,
  GitBranch as PhGitBranch,
  Globe as PhGlobe,
  HardDrives as PhHardDrives,
  LockKey as PhLockKey,
  Headphones as PhHeadphones,
  House as PhHouse,
  Image as PhImage,
  Info as PhInfo,
  Key as PhKey,
  Laptop as PhLaptop,
  Lightbulb as PhLightbulb,
  Lightning as PhLightning,
  Link as PhLink,
  ListBullets as PhListBullets,
  ListChecks as PhListChecks,
  ListDashes as PhListDashes,
  ListNumbers as PhListNumbers,
  MagnifyingGlass as PhMagnifyingGlass,
  MapPin as PhMapPin,
  Microphone as PhMicrophone,
  Minus as PhMinus,
  Monitor as PhMonitor,
  Moon as PhMoon,
  MusicNote as PhMusicNote,
  NotePencil as PhNotePencil,
  Palette as PhPalette,
  PaperPlaneTilt as PhPaperPlaneTilt,
  Paperclip as PhPaperclip,
  Pause as PhPause,
  PencilSimple as PhPencilSimple,
  Play as PhPlay,
  Plugs as PhPlugs,
  Plus as PhPlus,
  PlusCircle as PhPlusCircle,
  PresentationChart as PhPresentationChart,
  Question as PhQuestion,
  Quotes as PhQuotes,
  RadioButton as PhRadioButton,
  Scan as PhScan,
  ShareNetwork as PhShareNetwork,
  ShieldCheck as PhShieldCheck,
  ShieldWarning as PhShieldWarning,
  SidebarSimple as PhSidebarSimple,
  SignOut as PhSignOut,
  Sparkle as PhSparkle,
  SpeakerHigh as PhSpeakerHigh,
  SquaresFour as PhSquaresFour,
  Stop as PhStop,
  Sun as PhSun,
  Table as PhTable,
  Tag as PhTag,
  Terminal as PhTerminal,
  TextB as PhTextB,
  TextHOne as PhTextHOne,
  TextHThree as PhTextHThree,
  TextHTwo as PhTextHTwo,
  TextItalic as PhTextItalic,
  TextStrikethrough as PhTextStrikethrough,
  Trash as PhTrash,
  User as PhUser,
  UserCircle as PhUserCircle,
  Users as PhUsers,
  VideoCamera as PhVideoCamera,
  Warning as PhWarning,
  WarningCircle as PhWarningCircle,
  Wrench as PhWrench,
  X as PhX,
  XCircle as PhXCircle,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * Centralized icon surface for the desktop app — backed by **Phosphor**
 * (https://phosphoricons.com, `@phosphor-icons/react`, regular weight), the
 * same set the web console uses, so desktop and dashboard share one icon
 * language. Import icons from here (`@/lib/icons`), never from a vendor
 * package directly.
 *
 * Every export keeps the icon name the app already used (Lucide-era names
 * preserved through the Heroicons migration), so call sites did not change
 * when we moved to Phosphor.
 */

export const ICON_STROKE_WIDTH = 1.5;
export const ICON_SIZE = 16;

/** Props every app icon accepts: standard SVG props + a Lucide-compatible numeric
 *  `size` (mapped to width/height) + legacy title/titleId. */
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

/** Wrap a Phosphor glyph so it carries `app-icon`, a default size, and a
 *  Lucide-compatible numeric `size` prop (translated to inline width/height,
 *  which wins over the default size class). */
function styled(Base: BaseIcon, displayName: string): IconComponent {
  const Wrapped = React.forwardRef<SVGSVGElement, AppIconProps>(function AppIcon(
    { className, size, style, title, titleId: _titleId, ...props },
    ref,
  ) {
    return (
      <Base
        ref={ref as React.Ref<SVGSVGElement>}
        aria-hidden={title ? undefined : "true"}
        aria-label={title}
        className={cn("app-icon size-6", className)}
        style={size != null ? { width: size, height: size, ...style } : style}
        {...props}
      />
    );
  });
  Wrapped.displayName = displayName;
  return Wrapped as unknown as IconComponent;
}

export const AlertCircle = styled(PhWarningCircle, "AlertCircle");
export const AlertCircleIcon = styled(PhWarningCircle, "AlertCircleIcon");
export const AlertTriangle = styled(PhWarning, "AlertTriangle");
export const AlertTriangleIcon = styled(PhWarning, "AlertTriangleIcon");
export const Archive = styled(PhArchive, "Archive");
export const Bell = styled(PhBell, "Bell");
export const ArrowDown = styled(PhArrowDown, "ArrowDown");
export const ArrowDownIcon = styled(PhArrowDown, "ArrowDownIcon");
export const ArrowLeft = styled(PhArrowLeft, "ArrowLeft");
export const ArrowRight = styled(PhArrowRight, "ArrowRight");
export const ArrowUp = styled(PhArrowUp, "ArrowUp");
export const ArrowUpIcon = styled(PhArrowUp, "ArrowUpIcon");
export const ArrowUpRight = styled(PhArrowUpRight, "ArrowUpRight");
export const AudioLines = styled(PhSpeakerHigh, "AudioLines");
export const BarChart3 = styled(PhChartBar, "BarChart3");
export const Bold = styled(PhTextB, "Bold");
export const BoldIcon = styled(PhTextB, "BoldIcon");
export const BookOpen = styled(PhBookOpen, "BookOpen");
export const BrainIcon = styled(PhCpu, "BrainIcon");
export const Bug = styled(PhBug, "Bug");
export const Calendar = styled(PhCalendar, "Calendar");
export const CalendarClock = styled(PhCalendarDots, "CalendarClock");
export const Check = styled(PhCheck, "Check");
export const CheckCheck = styled(PhChecks, "CheckCheck");
export const CheckCircle = styled(PhCheckCircle, "CheckCircle");
export const CheckCircle2 = styled(PhCheckCircle, "CheckCircle2");
export const CheckCircle2Icon = styled(PhCheckCircle, "CheckCircle2Icon");
export const CheckCircleIcon = styled(PhCheckCircle, "CheckCircleIcon");
export const CheckIcon = styled(PhCheck, "CheckIcon");
export const ChevronDown = styled(PhCaretDown, "ChevronDown");
export const ChevronDownIcon = styled(PhCaretDown, "ChevronDownIcon");
export const ChevronLeft = styled(PhCaretLeft, "ChevronLeft");
export const ChevronLeftIcon = styled(PhCaretLeft, "ChevronLeftIcon");
export const ChevronRight = styled(PhCaretRight, "ChevronRight");
export const ChevronRightIcon = styled(PhCaretRight, "ChevronRightIcon");
export const ChevronUpIcon = styled(PhCaretUp, "ChevronUpIcon");
export const Circle = styled(PhCircle, "Circle");
export const CircleCheck = styled(PhCheckCircle, "CircleCheck");
export const CircleCheckIcon = styled(PhCheckCircle, "CircleCheckIcon");
export const CircleDot = styled(PhRadioButton, "CircleDot");
export const CircleIcon = styled(PhCircle, "CircleIcon");
export const Clock = styled(PhClock, "Clock");
export const Cloud = styled(PhCloud, "Cloud");
export const CodeIcon = styled(PhCode, "CodeIcon");
export const CodeSquareIcon = styled(PhCodeBlock, "CodeSquareIcon");
export const Copy = styled(PhCopy, "Copy");
export const CornerDownLeftIcon = styled(PhArrowElbowDownLeft, "CornerDownLeftIcon");
export const CreditCard = styled(PhCreditCard, "CreditCard");
export const Download = styled(PhDownloadSimple, "Download");
export const DownloadIcon = styled(PhDownloadSimple, "DownloadIcon");
export const ExternalLink = styled(PhArrowSquareOut, "ExternalLink");
export const ExternalLinkIcon = styled(PhArrowSquareOut, "ExternalLinkIcon");
export const Eye = styled(PhEye, "Eye");
export const File = styled(PhFile, "File");
export const FileArchive = styled(PhFileArchive, "FileArchive");
export const FileAudioIcon = styled(PhFileAudio, "FileAudioIcon");
export const FileCode2 = styled(PhFileCode, "FileCode2");
export const FileIcon = styled(PhFile, "FileIcon");
export const FileImageIcon = styled(PhFileImage, "FileImageIcon");
export const FilePlus = styled(PhFilePlus, "FilePlus");
export const FileSpreadsheet = styled(PhFileCsv, "FileSpreadsheet");
export const FileText = styled(PhFileText, "FileText");
export const FileTextIcon = styled(PhFileText, "FileTextIcon");
export const FileTypeIcon = styled(PhFile, "FileTypeIcon");
export const FileVideo = styled(PhFileVideo, "FileVideo");
export const FileVideoIcon = styled(PhFileVideo, "FileVideoIcon");
export const Filter = styled(PhFunnel, "Filter");
export const FilterIcon = styled(PhFunnel, "FilterIcon");
export const Folder = styled(PhFolder, "Folder");
export const FolderCheck = styled(PhFolder, "FolderCheck");
export const FolderClock = styled(PhFolder, "FolderClock");
export const FolderCog = styled(PhFolder, "FolderCog");
export const FolderOpen = styled(PhFolderOpen, "FolderOpen");
export const FolderPlus = styled(PhFolderPlus, "FolderPlus");
export const Forward = styled(PhArrowUUpRight, "Forward");
export const GitBranch = styled(PhGitBranch, "GitBranch");
export const Globe = styled(PhGlobe, "Globe");
export const GlobeIcon = styled(PhGlobe, "GlobeIcon");
export const Heading1Icon = styled(PhTextHOne, "Heading1Icon");
export const Heading2Icon = styled(PhTextHTwo, "Heading2Icon");
export const Heading3Icon = styled(PhTextHThree, "Heading3Icon");
export const Headphones = styled(PhHeadphones, "Headphones");
export const HelpCircle = styled(PhQuestion, "HelpCircle");
export const HistoryIcon = styled(PhClock, "HistoryIcon");
export const Home = styled(PhHouse, "Home");
export const Image = styled(PhImage, "Image");
export const ImageIcon = styled(PhImage, "ImageIcon");
export const ImagePlus = styled(PhImage, "ImagePlus");
export const InfoIcon = styled(PhInfo, "InfoIcon");
export const Italic = styled(PhTextItalic, "Italic");
export const ItalicIcon = styled(PhTextItalic, "ItalicIcon");
export const Key = styled(PhKey, "Key");
export const KeyRound = styled(PhKey, "KeyRound");
export const Laptop = styled(PhLaptop, "Laptop");
export const LayoutGridIcon = styled(PhSquaresFour, "LayoutGridIcon");
export const Lightbulb = styled(PhLightbulb, "Lightbulb");
export const Link = styled(PhLink, "Link");
export const Link2 = styled(PhLink, "Link2");
export const Link2Icon = styled(PhLink, "Link2Icon");
export const LinkIcon = styled(PhLink, "LinkIcon");
export const List = styled(PhListBullets, "List");
export const ListChecks = styled(PhListChecks, "ListChecks");
export const ListFilter = styled(PhFunnel, "ListFilter");
export const ListIcon = styled(PhListBullets, "ListIcon");
export const ListOrdered = styled(PhListNumbers, "ListOrdered");
export const ListOrderedIcon = styled(PhListNumbers, "ListOrderedIcon");
export const ListTodoIcon = styled(PhListDashes, "ListTodoIcon");
export const Loader = styled(PhCircleNotch, "Loader");
export const Loader2 = styled(PhCircleNotch, "Loader2");
export const Loader2Icon = styled(PhCircleNotch, "Loader2Icon");
export const LoaderIcon = styled(PhCircleNotch, "LoaderIcon");
export const LogOut = styled(PhSignOut, "LogOut");
export const Mail = styled(PhEnvelope, "Mail");
export const MapPin = styled(PhMapPin, "MapPin");
export const MessageCircle = styled(PhChatCircle, "MessageCircle");
export const MessageCircleIcon = styled(PhChatCircle, "MessageCircleIcon");
export const MessageSquare = styled(PhChatsCircle, "MessageSquare");
export const MessageSquareIcon = styled(PhChatsCircle, "MessageSquareIcon");
export const Mic = styled(PhMicrophone, "Mic");
export const MicIcon = styled(PhMicrophone, "MicIcon");
export const MinusIcon = styled(PhMinus, "MinusIcon");
export const Monitor = styled(PhMonitor, "Monitor");
export const Moon = styled(PhMoon, "Moon");
export const MoreHorizontal = styled(PhDotsThree, "MoreHorizontal");
export const Music = styled(PhMusicNote, "Music");
export const Network = styled(PhShareNetwork, "Network");
export const NetworkIcon = styled(PhShareNetwork, "NetworkIcon");
export const NotebookPen = styled(PhNotePencil, "NotebookPen");
export const OctagonXIcon = styled(PhXCircle, "OctagonXIcon");
export const Palette = styled(PhPalette, "Palette");
export const PanelLeftIcon = styled(PhSidebarSimple, "PanelLeftIcon");
export const PanelRight = styled(PhColumns, "PanelRight");
export const PanelRightClose = styled(PhCaretDoubleRight, "PanelRightClose");
export const PanelRightOpen = styled(PhCaretDoubleLeft, "PanelRightOpen");
export const Paperclip = styled(PhPaperclip, "Paperclip");
export const PaperclipIcon = styled(PhPaperclip, "PaperclipIcon");
export const Pause = styled(PhPause, "Pause");
export const Pencil = styled(PhPencilSimple, "Pencil");
export const Play = styled(PhPlay, "Play");
export const Plug = styled(PhPlugs, "Plug");
export const Plus = styled(PhPlus, "Plus");
export const PlusCircleIcon = styled(PhPlusCircle, "PlusCircleIcon");
export const PlusIcon = styled(PhPlus, "PlusIcon");
export const Presentation = styled(PhPresentationChart, "Presentation");
export const Quote = styled(PhQuotes, "Quote");
export const QuoteIcon = styled(PhQuotes, "QuoteIcon");
export const Radio = styled(PhBroadcast, "Radio");
export const RefreshCw = styled(PhArrowsClockwise, "RefreshCw");
export const RefreshCwIcon = styled(PhArrowsClockwise, "RefreshCwIcon");
export const Repeat = styled(PhArrowsClockwise, "Repeat");
export const Reply = styled(PhArrowUUpLeft, "Reply");
export const ReplyAll = styled(PhArrowUUpLeft, "ReplyAll");
export const RotateCcw = styled(PhArrowsCounterClockwise, "RotateCcw");
export const RotateCw = styled(PhArrowsClockwise, "RotateCw");
export const Save = styled(PhFloppyDisk, "Save");
export const ScanSearch = styled(PhScan, "ScanSearch");
export const Search = styled(PhMagnifyingGlass, "Search");
export const SearchIcon = styled(PhMagnifyingGlass, "SearchIcon");
export const Send = styled(PhPaperPlaneTilt, "Send");
export const HardDrive = styled(PhHardDrives, "HardDrive");
export const Lock = styled(PhLockKey, "Lock");
export const Server = styled(PhHardDrives, "Server");
export const Settings = styled(PhGearSix, "Settings");
export const Shield = styled(PhShieldCheck, "Shield");
export const ShieldAlertIcon = styled(PhShieldWarning, "ShieldAlertIcon");
export const ShieldCheck = styled(PhShieldCheck, "ShieldCheck");
export const ShieldCheckIcon = styled(PhShieldCheck, "ShieldCheckIcon");
export const ShieldQuestion = styled(PhShieldWarning, "ShieldQuestion");
export const Sparkles = styled(PhSparkle, "Sparkles");
export const Square = styled(PhStop, "Square");
export const SquareIcon = styled(PhStop, "SquareIcon");
export const SquarePen = styled(PhNotePencil, "SquarePen");
export const Strikethrough = styled(PhTextStrikethrough, "Strikethrough");
export const StrikethroughIcon = styled(PhTextStrikethrough, "StrikethroughIcon");
export const Sun = styled(PhSun, "Sun");
export const Table2 = styled(PhTable, "Table2");
export const Tags = styled(PhTag, "Tags");
export const Terminal = styled(PhTerminal, "Terminal");
export const Trash2 = styled(PhTrash, "Trash2");
export const Trash2Icon = styled(PhTrash, "Trash2Icon");
export const TriangleAlertIcon = styled(PhWarning, "TriangleAlertIcon");
export const UploadCloud = styled(PhCloudArrowUp, "UploadCloud");
export const User = styled(PhUser, "User");
export const UserRound = styled(PhUserCircle, "UserRound");
export const UsersRound = styled(PhUsers, "UsersRound");
export const Video = styled(PhVideoCamera, "Video");
export const Waypoints = styled(PhShareNetwork, "Waypoints");
export const Workflow = styled(PhFlowArrow, "Workflow");
export const Wrench = styled(PhWrench, "Wrench");
export const X = styled(PhX, "X");
export const XCircleIcon = styled(PhXCircle, "XCircleIcon");
export const XIcon = styled(PhX, "XIcon");
export const Zap = styled(PhLightning, "Zap");

export interface IconProps extends AppIconProps {
  /** The icon component to render. */
  icon: IconComponent;
}

/** Render an icon passed as data (e.g. nav configs): `<Icon icon={Settings} />`. */
export function Icon({ icon: IconCmp, className, ...props }: IconProps) {
  return <IconCmp className={cn("size-4 shrink-0", className)} {...props} />;
}
