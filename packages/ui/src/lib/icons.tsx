"use client";

import * as React from "react";
import {
  ArrowDown as PhArrowDown,
  ArrowLeft as PhArrowLeft,
  ArrowRight as PhArrowRight,
  CalendarDots as PhCalendarDots,
  CaretDown as PhCaretDown,
  CaretLeft as PhCaretLeft,
  CaretRight as PhCaretRight,
  CaretUp as PhCaretUp,
  Check as PhCheck,
  CheckCircle as PhCheckCircle,
  Circle as PhCircle,
  CircleNotch as PhCircleNotch,
  DotsSixVertical as PhDotsSixVertical,
  DotsThree as PhDotsThree,
  Info as PhInfo,
  MagnifyingGlass as PhMagnifyingGlass,
  Minus as PhMinus,
  SidebarSimple as PhSidebarSimple,
  Warning as PhWarning,
  X as PhX,
  XCircle as PhXCircle,
} from "@phosphor-icons/react";

import { cn } from "#lib/utils";

export type IconWeight = "thin" | "light" | "regular" | "bold" | "fill" | "duotone";

export type AppIconProps = Omit<React.SVGProps<SVGSVGElement>, "ref"> & {
  title?: string;
  size?: number | string;
  weight?: IconWeight;
};

export type IconComponent = React.ForwardRefExoticComponent<
  AppIconProps & React.RefAttributes<SVGSVGElement>
>;

type BaseIcon = React.ForwardRefExoticComponent<AppIconProps & React.RefAttributes<SVGSVGElement>>;

function styled(Base: BaseIcon, displayName: string): IconComponent {
  const Wrapped = React.forwardRef<SVGSVGElement, AppIconProps>(function AppIcon(
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

export const ArrowDownIcon = styled(PhArrowDown, "ArrowDownIcon");
export const ArrowLeft = styled(PhArrowLeft, "ArrowLeft");
export const ArrowRight = styled(PhArrowRight, "ArrowRight");
export const CalendarClockIcon = styled(PhCalendarDots, "CalendarClockIcon");
export const CheckIcon = styled(PhCheck, "CheckIcon");
export const ChevronDownIcon = styled(PhCaretDown, "ChevronDownIcon");
export const ChevronLeftIcon = styled(PhCaretLeft, "ChevronLeftIcon");
export const ChevronRight = styled(PhCaretRight, "ChevronRight");
export const ChevronRightIcon = styled(PhCaretRight, "ChevronRightIcon");
export const ChevronUpIcon = styled(PhCaretUp, "ChevronUpIcon");
export const CircleCheckIcon = styled(PhCheckCircle, "CircleCheckIcon");
export const CircleIcon = styled(PhCircle, "CircleIcon");
export const GripVerticalIcon = styled(PhDotsSixVertical, "GripVerticalIcon");
export const InfoIcon = styled(PhInfo, "InfoIcon");
export const Loader2Icon = styled(PhCircleNotch, "Loader2Icon");
export const MinusIcon = styled(PhMinus, "MinusIcon");
export const MoreHorizontal = styled(PhDotsThree, "MoreHorizontal");
export const MoreHorizontalIcon = styled(PhDotsThree, "MoreHorizontalIcon");
export const OctagonXIcon = styled(PhXCircle, "OctagonXIcon");
export const PanelLeftIcon = styled(PhSidebarSimple, "PanelLeftIcon");
export const SearchIcon = styled(PhMagnifyingGlass, "SearchIcon");
export const TriangleAlertIcon = styled(PhWarning, "TriangleAlertIcon");
export const XIcon = styled(PhX, "XIcon");
