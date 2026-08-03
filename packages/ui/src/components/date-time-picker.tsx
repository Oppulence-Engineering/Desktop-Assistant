"use client"

import * as React from "react"
import { format } from "date-fns"
import { CalendarClockIcon, XIcon } from "lucide-react"

import { Button } from "#components/button"
import { Calendar } from "#components/calendar"
import { Input } from "#components/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#components/popover"
import { cn } from "#lib/utils"

type DateTimePickerProps = {
  value?: string
  onChange: (value: string) => void
  className?: string
  disabled?: boolean
  id?: string
  placeholder?: string
  clearable?: boolean
  "aria-label"?: string
}

function parseDateTime(value?: string) {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function toTimeValue(value?: Date) {
  if (!value) return ""
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`
}

function DateTimePicker({
  value,
  onChange,
  className,
  disabled,
  id,
  placeholder = "Choose date and time",
  clearable = true,
  "aria-label": ariaLabel,
}: DateTimePickerProps) {
  const selected = parseDateTime(value)
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return

    const closeWhenFocusLeaves = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target) || contentRef.current?.contains(target)) return
      setOpen(false)
    }

    document.addEventListener("focusin", closeWhenFocusLeaves)
    return () => document.removeEventListener("focusin", closeWhenFocusLeaves)
  }, [open])

  const emit = React.useCallback(
    (next: Date) => {
      if (!Number.isNaN(next.getTime())) onChange(next.toISOString())
    },
    [onChange]
  )

  const selectDate = (date?: Date) => {
    if (!date) return
    const next = new Date(date)
    next.setHours(selected?.getHours() ?? 9, selected?.getMinutes() ?? 0, 0, 0)
    emit(next)
  }

  const selectTime = (event: React.ChangeEvent<HTMLInputElement>) => {
    const [hours, minutes] = event.target.value.split(":").map(Number)
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return
    const next = selected ? new Date(selected) : new Date()
    next.setHours(hours, minutes, 0, 0)
    emit(next)
  }

  return (
    <div
      ref={rootRef}
      className={cn("flex min-w-0 items-center gap-2", className)}
      data-slot="date-time-picker"
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={ariaLabel ?? placeholder}
            className={cn(
              "min-w-0 flex-1 justify-start overflow-hidden px-3 text-left font-normal",
              !selected && "text-muted-foreground"
            )}
          >
            <CalendarClockIcon />
            <span className="truncate">
              {selected ? format(selected, "MMM d, yyyy 'at' h:mm a") : placeholder}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          ref={contentRef}
          align="start"
          className="w-auto rounded-[16px] p-0"
        >
          <Calendar mode="single" selected={selected} onSelect={selectDate} />
          <div className="flex items-center gap-2 border-t p-3">
            <Input
              type="time"
              value={toTimeValue(selected)}
              onChange={selectTime}
              aria-label="Time"
              disabled={disabled}
            />
            <Button type="button" variant="secondary" onClick={() => emit(new Date())} disabled={disabled}>
              Now
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {clearable && selected ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onChange("")}
          disabled={disabled}
          aria-label="Clear date and time"
        >
          <XIcon />
        </Button>
      ) : null}
    </div>
  )
}

export { DateTimePicker, type DateTimePickerProps }
