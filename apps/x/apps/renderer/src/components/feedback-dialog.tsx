"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "@/lib/icons";
import { toast } from "sonner";
import { feedbackSubmitted } from "@/lib/analytics";

const MAX_MESSAGE_LENGTH = 5000;

type FeedbackCategory = "bug" | "feature" | "question" | "other";

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: "bug", label: "Bug report" },
  { value: "feature", label: "Feature request" },
  { value: "question", label: "Question" },
  { value: "other", label: "Other feedback" },
];

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCategory("bug");
      setMessage("");
      setIsSubmitting(false);
      setError(null);
    }
  }, [open]);

  const trimmedMessage = message.trim();
  const isValid = trimmedMessage.length > 0 && trimmedMessage.length <= MAX_MESSAGE_LENGTH;

  const handleSubmit = async () => {
    if (!isValid || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await window.ipc.invoke("feedback:submit", {
        category,
        message: trimmedMessage,
      });
      if (result.success) {
        feedbackSubmitted(category);
        toast.success("Feedback sent — we'll reply by email.");
        onOpenChange(false);
        return;
      }
      setError(
        result.errorCode === "not_signed_in"
          ? "Sign in to send feedback."
          : "Couldn't send feedback. Please try again.",
      );
    } catch {
      setError("Couldn't send feedback. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(28rem,calc(100%-2rem))] max-w-md p-0 gap-0 overflow-hidden rounded-none">
        <div className="p-6 pb-0">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-lg font-semibold">Send feedback</DialogTitle>
            <DialogDescription className="text-sm">
              Tell us what's broken, missing, or confusing. Replies go to your account email.
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div>
            <label
              className="text-xs font-medium text-muted-foreground mb-1.5 block"
              htmlFor="feedback-category"
            >
              Category
            </label>
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as FeedbackCategory)}
            >
              <SelectTrigger id="feedback-category" className="rounded-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label
              className="text-xs font-medium text-muted-foreground mb-1.5 block"
              htmlFor="feedback-message"
            >
              Message
            </label>
            <Textarea
              id="feedback-message"
              rows={6}
              placeholder="What happened? What did you expect?"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={MAX_MESSAGE_LENGTH}
              className="rounded-none resize-none"
              autoFocus
            />
            <p className="mt-1 text-right text-[11px] text-muted-foreground tabular-nums">
              {message.length}/{MAX_MESSAGE_LENGTH}
            </p>
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t bg-muted/30">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!isValid || isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Sending…
              </>
            ) : (
              "Send feedback"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
