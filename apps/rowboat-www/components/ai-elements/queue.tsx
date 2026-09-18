"use client";

/* eslint-disable @next/next/no-img-element */
import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import { Label } from "@oppulence/ui/components/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@oppulence/ui/components/collapsible";
import { ScrollArea } from "@oppulence/ui/components/scroll-area";
import { cn } from "@/lib/utils";
import { CaretDown, Paperclip } from "@/lib/icons";
import type { ComponentProps } from "react";

export type QueueMessagePart = {
  type: string;
  text?: string;
  url?: string;
  filename?: string;
  mediaType?: string;
};

export type QueueMessage = {
  id: string;
  parts: QueueMessagePart[];
};

export type QueueTodo = {
  id: string;
  title: string;
  description?: string;
  status?: "pending" | "completed";
};

export type QueueItemProps = ComponentProps<"li">;

export const QueueItem = ({ className, ...props }: QueueItemProps) => (
  <li
    className={cn(
      "group flex flex-col gap-1 rounded-none px-3 py-1 text-sm transition-colors hover:bg-muted",
      className,
    )}
    {...props}
  />
);

export type QueueItemIndicatorProps = ComponentProps<"span"> & {
  completed?: boolean;
};

export const QueueItemIndicator = ({
  completed = false,
  className,
  ...props
}: QueueItemIndicatorProps) => (
  <Badge
    className={cn(
      "mt-0.5 inline-block size-2.5 rounded-full border-0 p-0",
      completed
        ? "border-muted-foreground/20 bg-muted-foreground/10"
        : "border border-muted-foreground/50 bg-transparent",
      className,
    )}
    variant="outline"
    {...props}
  />
);

export type QueueItemContentProps = ComponentProps<typeof Label> & {
  completed?: boolean;
};

export const QueueItemContent = ({
  completed = false,
  className,
  ...props
}: QueueItemContentProps) => (
  <Label
    className={cn(
      "line-clamp-1 grow break-words font-normal",
      completed ? "text-muted-foreground/50 line-through" : "text-muted-foreground",
      className,
    )}
    {...props}
  />
);

export type QueueItemDescriptionProps = ComponentProps<"div"> & {
  completed?: boolean;
};

export const QueueItemDescription = ({
  completed = false,
  className,
  ...props
}: QueueItemDescriptionProps) => (
  <div
    className={cn(
      "ml-6 text-xs",
      completed ? "text-muted-foreground/40 line-through" : "text-muted-foreground",
      className,
    )}
    {...props}
  />
);

export type QueueItemActionsProps = ComponentProps<"div">;

export const QueueItemActions = ({ className, ...props }: QueueItemActionsProps) => (
  <div className={cn("flex gap-1", className)} {...props} />
);

export type QueueItemActionProps = Omit<ComponentProps<typeof Button>, "variant" | "size">;

export const QueueItemAction = ({ className, ...props }: QueueItemActionProps) => (
  <Button
    className={cn(
      "size-auto rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted-foreground/10 hover:text-foreground group-hover:opacity-100",
      className,
    )}
    size="icon"
    type="button"
    variant="ghost"
    {...props}
  />
);

export type QueueItemAttachmentProps = ComponentProps<"div">;

export const QueueItemAttachment = ({ className, ...props }: QueueItemAttachmentProps) => (
  <div className={cn("mt-1 flex flex-wrap gap-2", className)} {...props} />
);

export type QueueItemImageProps = ComponentProps<"img">;

export const QueueItemImage = ({ className, ...props }: QueueItemImageProps) => (
  <img
    alt=""
    className={cn("h-8 w-8 rounded border object-cover", className)}
    height={32}
    width={32}
    {...props}
  />
);

export type QueueItemFileProps = ComponentProps<"span">;

export const QueueItemFile = ({ children, className, ...props }: QueueItemFileProps) => (
  <Badge
    className={cn(
      "flex items-center gap-1 rounded-none bg-muted px-2 py-1 text-xs font-normal",
      className,
    )}
    variant="outline"
    {...props}
  >
    <Paperclip size={12} />
    <Label className="max-w-[100px] truncate font-normal">{children}</Label>
  </Badge>
);

export type QueueListProps = ComponentProps<typeof ScrollArea>;

export const QueueList = ({ children, className, ...props }: QueueListProps) => (
  <ScrollArea className={cn("-mb-1 mt-2", className)} {...props}>
    <div className="max-h-40 pr-4">
      <ul>{children}</ul>
    </div>
  </ScrollArea>
);

// QueueSection - collapsible section container
export type QueueSectionProps = ComponentProps<typeof Collapsible>;

export const QueueSection = ({ className, defaultOpen = true, ...props }: QueueSectionProps) => (
  <Collapsible className={cn(className)} defaultOpen={defaultOpen} {...props} />
);

// QueueSectionTrigger - section header/trigger
export type QueueSectionTriggerProps = ComponentProps<typeof Button>;

export const QueueSectionTrigger = ({
  children,
  className,
  ...props
}: QueueSectionTriggerProps) => (
  <CollapsibleTrigger asChild>
    <Button
      className={cn(
        "group h-auto w-full justify-between rounded-none bg-muted/40 px-3 py-2 text-left font-medium text-muted-foreground text-sm hover:bg-muted",
        className,
      )}
      type="button"
      variant="ghost"
      {...props}
    >
      {children}
    </Button>
  </CollapsibleTrigger>
);

// QueueSectionLabel - label content with icon and count
export type QueueSectionLabelProps = ComponentProps<typeof Label> & {
  count?: number;
  label: string;
  icon?: React.ReactNode;
};

export const QueueSectionLabel = ({
  count,
  label,
  icon,
  className,
  ...props
}: QueueSectionLabelProps) => (
  <Label className={cn("flex items-center gap-2 font-normal", className)} {...props}>
    <CaretDown className="group-data-[state=closed]:-rotate-90 size-4 transition-transform" />
    {icon}
    {count} {label}
  </Label>
);

// QueueSectionContent - collapsible content area
export type QueueSectionContentProps = ComponentProps<typeof CollapsibleContent>;

export const QueueSectionContent = ({ className, ...props }: QueueSectionContentProps) => (
  <CollapsibleContent className={cn(className)} {...props} />
);

export type QueueProps = ComponentProps<"div">;

export const Queue = ({ className, ...props }: QueueProps) => (
  <div
    className={cn(
      "flex flex-col gap-2 rounded-none border border-border bg-background px-3 pt-2 pb-2 shadow-xs",
      className,
    )}
    {...props}
  />
);
