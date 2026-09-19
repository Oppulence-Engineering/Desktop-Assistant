"use client";

import "client-only";

import * as React from "react";
import type { Value } from "platejs";
import { Plate, PlateContent, createPlatePlugin, usePlateEditor } from "platejs/react";
import {
  ArrowsOut,
  ArrowClockwise,
  BookmarkSimple,
  CalendarBlank,
  CaretDown,
  DotsThree,
  Funnel,
  GridFour,
  Link,
  List,
  MagnifyingGlass,
  Minus,
  Note,
  NotePencil,
  Plus,
  Quotes,
  SlidersHorizontal,
  TextB,
  TextHOne,
  TextItalic,
  TextUnderline,
  Trash,
  User,
  X,
} from "@/lib/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  EmptyBlock,
  errMessage,
  ListSkeleton,
  WorkspaceEmptyState,
} from "@/components/revenue/shared";
import { Avatar, AvatarFallback } from "@oppulence/ui/components/avatar";
import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@oppulence/ui/components/card";
import { Checkbox } from "@oppulence/ui/components/checkbox";
import { Label } from "@oppulence/ui/components/label";
import { Spinner } from "@oppulence/ui/components/spinner";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@oppulence/ui/components/table";
import { Tabs, TabsList, TabsTrigger } from "@oppulence/ui/components/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@oppulence/ui/components/dialog";
import { Input } from "@oppulence/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@oppulence/ui/components/select";
import { Textarea } from "@oppulence/ui/components/textarea";
import { cn } from "@oppulence/ui/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@oppulence/ui/components/sheet";
import {
  collapseWorkspaceNotes,
  mapSettledWithConcurrency,
  plateText,
  type WorkspaceNote,
} from "@/lib/revenue-records";
import {
  createConsoleResource,
  deleteConsoleResource,
  listConsoleResources,
  patchConsoleResource,
} from "@/lib/console";
import { noteFavorites, noteTemplates, type NoteTemplateResource } from "@/lib/console-resources";
import {
  createRelationship,
  dismissAction,
  getPersonAttributes,
  getRelationshipTimeline,
  ingestRelationshipObservations,
  listActions,
  listPersons,
  listRelationships,
  relativeTime,
  safeResearchCitationURL,
} from "@/lib/revenue";
import type {
  RelationshipObservation,
  RelationshipPerson,
  RelationshipPersonAttribute,
  RevenueAction,
  RevenueRelationship,
} from "@/types/revenue";
import { TaskCreateDialog } from "@/components/features/revenue/task-create-dialog/task-create-dialog";

type ViewProps = {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

const notePlugins = [
  createPlatePlugin({ key: "bold", node: { isLeaf: true }, render: { as: "strong" } }),
  createPlatePlugin({ key: "italic", node: { isLeaf: true }, render: { as: "em" } }),
  createPlatePlugin({ key: "underline", node: { isLeaf: true }, render: { as: "u" } }),
  createPlatePlugin({ key: "h2", node: { isElement: true, type: "h2" }, render: { as: "h2" } }),
  createPlatePlugin({
    key: "blockquote",
    node: { isElement: true, type: "blockquote" },
    render: { as: "blockquote" },
  }),
];

function SearchBar({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative min-w-[220px] max-w-sm flex-1">
      <MagnifyingGlass className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-primary/35" />
      <Input
        aria-label={label}
        className="h-8 border-border bg-background pl-8 text-[13px]"
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        value={value}
      />
    </div>
  );
}

function RecordHeader({
  icon,
  label,
  count,
  action,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  action: React.ReactNode;
}) {
  return (
    <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
      <Badge
        className="h-8 gap-2 border border-border bg-background px-3 text-[13px] font-medium text-primary"
        variant="outline"
      >
        {icon} {label}{" "}
        <Badge className="font-normal text-primary/40" variant="secondary">
          {count}
        </Badge>
      </Badge>
      {action}
    </div>
  );
}

export function PeopleView({ onError, onNotice }: ViewProps) {
  const [people, setPeople] = React.useState<RelationshipPerson[]>([]);
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [selected, setSelected] = React.useState<RelationshipPerson | null>(null);
  const [attributes, setAttributes] = React.useState<RelationshipPersonAttribute[]>([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setPeople(await listPersons(query));
    } catch (error) {
      onError(errMessage(error, "Could not load people."));
    } finally {
      setLoading(false);
    }
  }, [onError, query]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openPerson = async (person: RelationshipPerson) => {
    setSelected(person);
    setAttributes([]);
    try {
      setAttributes(await getPersonAttributes(person.id));
    } catch (error) {
      onError(errMessage(error, "Could not load profile evidence."));
    }
  };

  return (
    <div className="flex min-h-full flex-col" data-slot="people-view">
      <RecordHeader
        icon={<User />}
        label="Recently contacted people"
        count={people.length}
        action={
          <Button
            className="bg-[#3478f6] text-white hover:bg-[#2f6fe6]"
            size="sm"
            onClick={() => setCreating(true)}
          >
            <Plus /> New person
          </Button>
        }
      />
      <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <SearchBar label="Search people" value={query} onChange={setQuery} />
        <Label className="text-[12px] font-normal text-primary/45">
          Sorted by last interaction
        </Label>
        <Button
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={() => void load()}
          disabled={loading}
        >
          <ArrowClockwise className={loading ? "animate-spin" : ""} /> Refresh
        </Button>
      </div>
      {loading ? (
        <div className="p-4">
          <ListSkeleton />
        </div>
      ) : people.length === 0 ? (
        <EmptyBlock
          body="Connect Gmail or add a person to build a relationship-aware contact record."
          image="people"
          learnMore={[
            { label: "See who you are talking to" },
            { label: "Enrich profiles with evidence" },
          ]}
          title="People"
        >
          <Button
            className="bg-[#3478f6] text-white hover:bg-[#2f6fe6]"
            onClick={() => setCreating(true)}
            size="sm"
          >
            <Plus /> Add person
          </Button>
        </EmptyBlock>
      ) : (
        <div className="min-w-0 flex-1 overflow-auto">
          <table
            className="w-full min-w-[1180px] table-fixed border-collapse text-left"
            aria-label="People"
          >
            <TableHeader className="sticky top-0 z-10 bg-background [&_tr]:border-border">
              <TableRow className="h-10 border-b text-[12px] font-medium text-primary/55 hover:bg-transparent">
                <TableHead className="h-10 w-10 border-r px-3">
                  <Checkbox aria-label="Select all people" className="size-4" />
                </TableHead>
                <TableHead className="h-10 w-[250px] border-r px-3">Person</TableHead>
                <TableHead className="h-10 w-[210px] border-r px-3">Company</TableHead>
                <TableHead className="h-10 w-36 border-r px-3">Role</TableHead>
                <TableHead className="h-10 w-36 border-r px-3">Department</TableHead>
                <TableHead className="h-10 w-40 border-r px-3">Location</TableHead>
                <TableHead className="h-10 w-36 border-r px-3">Last interaction</TableHead>
                <TableHead className="h-10 w-28 border-r px-3 text-center">Relationships</TableHead>
                <TableHead className="h-10 w-28 border-r px-3">LinkedIn</TableHead>
                <TableHead className="h-10 px-3">Enrichment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((person) => (
                <TableRow key={person.id} className="h-11 border-border hover:bg-background-100/70">
                  <TableCell className="border-r px-3">
                    <Checkbox aria-label={`Select ${person.displayName}`} className="size-4" />
                  </TableCell>
                  <TableCell className="border-r px-3">
                    <Button
                      aria-label={`Open ${person.displayName}`}
                      className="flex h-auto w-full items-center justify-start gap-2 px-0 py-0 text-left font-normal hover:bg-transparent"
                      type="button"
                      variant="ghost"
                      onClick={() => void openPerson(person)}
                    >
                      <Avatar className="size-6 rounded-none" size="sm">
                        <AvatarFallback className="rounded-none border border-border bg-background-100 text-[10px] font-semibold text-primary/60">
                          {initials(person.displayName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <Label className="block truncate text-[13px] font-medium text-primary">
                          {person.displayName}
                        </Label>
                        <CardDescription className="block truncate text-[11px]">
                          {person.primaryEmail || "No email"}
                        </CardDescription>
                      </div>
                    </Button>
                  </TableCell>
                  <TableCell className="truncate border-r px-3 text-[12px] text-primary/60">
                    {person.orgName || person.orgDomain || "—"}
                  </TableCell>
                  <TableCell className="truncate border-r px-3 text-[12px] text-primary/60">
                    {person.title || person.seniority || "—"}
                  </TableCell>
                  <TableCell className="truncate border-r px-3 text-[12px] text-primary/60">
                    {person.department || "—"}
                  </TableCell>
                  <TableCell className="truncate border-r px-3 text-[12px] text-primary/60">
                    {person.location || "—"}
                  </TableCell>
                  <TableCell className="border-r px-3 text-[12px] text-primary/50">
                    {person.lastInteractionAt ? relativeTime(person.lastInteractionAt) : "—"}
                  </TableCell>
                  <TableCell className="border-r px-3 text-center text-[12px] text-primary/60">
                    {person.relationshipCount}
                  </TableCell>
                  <TableCell className="truncate border-r px-3 text-[12px]">
                    {person.linkedinUrl ? (
                      <a
                        className="text-primary/60 underline-offset-2 hover:text-primary hover:underline"
                        href={person.linkedinUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        View profile
                      </a>
                    ) : (
                      <Badge className="font-normal text-primary/35" variant="ghost">
                        —
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="truncate px-3 text-[12px] text-primary/50">
                    {person.location ||
                      (person.attributesVersion
                        ? `${person.attributesVersion} verified fields`
                        : "Not enriched")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      )}
      {creating ? (
        <CreatePersonDialog
          onClose={() => setCreating(false)}
          onError={onError}
          onCreated={() => {
            setCreating(false);
            onNotice("Person added.");
            void load();
          }}
        />
      ) : null}
      {selected ? (
        <PersonSheet person={selected} attributes={attributes} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}

function CreatePersonDialog({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const relationship = await createRelationship({
        kind: "person",
        displayName: name.trim(),
        primaryEmail: email.trim() || undefined,
        accountDomain: email.includes("@") ? email.split("@")[1] : undefined,
      });
      const now = new Date().toISOString();
      await ingestRelationshipObservations([
        {
          relationshipId: relationship.id,
          source: "user",
          externalId: crypto.randomUUID(),
          eventType: "person_added",
          occurredAt: now,
          summary: `${name.trim()} added by the user`,
          normalizedFacts: {},
          participants: [
            { displayName: name.trim(), email: email.trim() || undefined, role: "contact" },
          ],
        },
      ]);
      onCreated();
    } catch (error) {
      onError(errMessage(error, "Could not create the person."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New person</DialogTitle>
          <DialogDescription>
            Add a contact now; synced activity and enrichment will extend the profile.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Full name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            type="email"
            placeholder="Email address (optional)"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy || !name.trim()} onClick={() => void submit()}>
            {busy ? <Spinner className="size-4" /> : <Plus />} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PersonSheet({
  person,
  attributes,
  onClose,
}: {
  person: RelationshipPerson;
  attributes: RelationshipPersonAttribute[];
  onClose: () => void;
}) {
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border p-4">
          <SheetTitle>{person.displayName}</SheetTitle>
          <SheetDescription>{person.primaryEmail || "Relationship profile"}</SheetDescription>
        </SheetHeader>
        <div className="overflow-y-auto p-4">
          <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-3 text-sm">
            {[
              ["Company", person.orgName || person.orgDomain],
              ["Role", person.title],
              ["Seniority", person.seniority],
              ["Department", person.department],
              ["Location", person.location],
              ["LinkedIn", person.linkedinUrl],
              ["Timezone", person.timezone],
              [
                "Last interaction",
                person.lastInteractionAt ? relativeTime(person.lastInteractionAt) : undefined,
              ],
            ].map(([label, value]) => (
              <React.Fragment key={label}>
                <dt className="text-primary/40">{label}</dt>
                <dd className="text-primary/75">{value || "Not known"}</dd>
              </React.Fragment>
            ))}
          </dl>
          <h3 className="mt-8 border-b border-border pb-2 text-xs font-medium uppercase tracking-wide text-primary/45">
            Enrichment evidence
          </h3>
          {attributes.length === 0 ? (
            <p className="py-4 text-sm text-primary/45">No enriched fields yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {attributes.map((attribute) => (
                <li className="py-3" key={attribute.id}>
                  <div className="flex items-center justify-between gap-3">
                    <Label className="text-sm font-medium capitalize text-primary">
                      {attribute.dimension.replaceAll("_", " ")}
                    </Label>
                    <Badge className="rounded-none font-normal text-primary/40" variant="outline">
                      {Math.round(attribute.confidence * 100)}%
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-primary/65">{attribute.value}</p>
                  <p className="mt-1 text-[11px] text-primary/40">
                    {attribute.source} · {relativeTime(attribute.observedAt)}
                  </p>
                  {(attribute.citations ?? [])
                    .map((citation) => safeResearchCitationURL(citation.url))
                    .filter((url): url is string => Boolean(url))
                    .slice(0, 2)
                    .map((url, index) => (
                      <a
                        className="mr-3 mt-1 inline-block text-[11px] text-primary/55 underline-offset-2 hover:underline"
                        href={url}
                        key={url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Verify source {index + 1}
                      </a>
                    ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

async function listWorkspaceNotes(signal?: AbortSignal): Promise<{
  notes: WorkspaceNote[];
  relationships: RevenueRelationship[];
  failedTimelineCount: number;
}> {
  const relationships = (await listRelationships({}, signal)).filter(
    (relationship) => relationship.kind !== "person",
  );
  const results = await mapSettledWithConcurrency(relationships, 6, (relationship) =>
    getRelationshipTimeline(relationship.id, 200, signal),
  );
  const successfulRelationships: RevenueRelationship[] = [];
  const timelines: RelationshipObservation[][] = [];
  results.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    successfulRelationships.push(relationships[index]);
    timelines.push(result.value);
  });
  return {
    notes: collapseWorkspaceNotes(successfulRelationships, timelines),
    relationships,
    failedTimelineCount: results.length - successfulRelationships.length,
  };
}

const plateValue = (note?: WorkspaceNote): Value => {
  if (Array.isArray(note?.content)) return note.content as Value;
  return [{ type: "p", children: [{ text: note?.body || "" }] }];
};

const todayValue = () => {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export function NotesView({ onError, onNotice }: ViewProps) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = React.useState<WorkspaceNote[]>([]);
  const [relationships, setRelationships] = React.useState<RevenueRelationship[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<
    WorkspaceNote | { template?: NoteTemplateResource } | null
  >(null);
  const [editingTemplate, setEditingTemplate] = React.useState<NoteTemplateResource | "new" | null>(
    null,
  );
  const [tab, setTab] = React.useState<"notes" | "templates">("notes");
  const [layout, setLayout] = React.useState<"grid" | "list">("grid");
  const [newestFirst, setNewestFirst] = React.useState(true);
  const [showFavorites, setShowFavorites] = React.useState(true);
  const templatesQuery = useQuery({
    queryKey: ["console", "resources", "note_template"],
    queryFn: ({ signal }) => listConsoleResources("note_template", signal),
    select: noteTemplates,
  });
  const favoritesQuery = useQuery({
    queryKey: ["console", "resources", "note_favorite"],
    queryFn: ({ signal }) => listConsoleResources("note_favorite", signal),
    select: noteFavorites,
  });
  const favoriteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      const existing = favoritesQuery.data?.find((favorite) => favorite.payload.noteId === noteId);
      if (existing) return deleteConsoleResource(existing.id);
      return createConsoleResource({ kind: "note_favorite", payload: { noteId } });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["console", "resources", "note_favorite"] }),
    onError: (error) => onError(errMessage(error, "Could not update the favorite.")),
  });
  const load = React.useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const result = await listWorkspaceNotes(signal);
        setNotes(result.notes);
        setRelationships(result.relationships);
        if (result.failedTimelineCount > 0) {
          onNotice(
            `Loaded available notes, but ${String(result.failedTimelineCount)} relationship timeline${result.failedTimelineCount === 1 ? "" : "s"} could not be read.`,
          );
        }
      } catch (error) {
        if (signal?.aborted) return;
        onError(errMessage(error, "Could not load notes."));
      } finally {
        setLoading(false);
      }
    },
    [onError, onNotice],
  );
  React.useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [load]);
  const visible = [...notes].sort((left, right) =>
    newestFirst
      ? right.occurredAt.localeCompare(left.occurredAt)
      : left.occurredAt.localeCompare(right.occurredAt),
  );
  const favoriteIds = new Set(favoritesQuery.data?.map((item) => item.payload.noteId) ?? []);
  const favoriteNotes = visible.filter((note) => favoriteIds.has(note.externalId));
  return (
    <div className="flex min-h-full flex-col bg-background" data-slot="notes-view">
      <Tabs
        className="shrink-0 gap-0"
        onValueChange={(value) => setTab(value as "notes" | "templates")}
        value={tab}
      >
        <TabsList className="h-11 w-full justify-start rounded-none border-b border-border bg-transparent px-3">
          <TabsTrigger
            className="h-9 rounded-none border px-3 text-[13px] data-[state=active]:border-border data-[state=active]:bg-background-100"
            value="notes"
          >
            <Note className="size-4" /> Notes{" "}
            <Badge className="font-normal text-primary/40" variant="secondary">
              {notes.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            className="h-9 rounded-none border px-3 text-[13px] data-[state=active]:border-border data-[state=active]:bg-background-100"
            value="templates"
          >
            <NotePencil className="size-4" /> Templates{" "}
            <Badge className="font-normal text-primary/40" variant="secondary">
              {templatesQuery.data?.length ?? 0}
            </Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
        <Button
          type="button"
          className="h-8 rounded-none border border-border bg-background px-3 text-[13px] text-primary/60 hover:bg-background-100"
          variant="ghost"
          onClick={() => setNewestFirst((value) => !value)}
        >
          <List className="size-4" /> Sorted by{" "}
          <Label className="font-normal text-primary">Creation date</Label>
          <CaretDown className={cn("size-3 transition-transform", !newestFirst && "rotate-180")} />
        </Button>
        <div className="flex items-center gap-2">
          <div className="flex h-8 border border-border bg-background p-0.5">
            <Button
              aria-label="List view"
              type="button"
              className={cn(
                "size-7 rounded-none p-0",
                layout === "list" ? "bg-background-200 text-primary" : "text-primary/45",
              )}
              size="icon-xs"
              variant="ghost"
              onClick={() => setLayout("list")}
            >
              <List className="size-4" />
            </Button>
            <Button
              aria-label="Grid view"
              type="button"
              className={cn(
                "size-7 rounded-none p-0",
                layout === "grid" ? "bg-background-200 text-primary" : "text-primary/45",
              )}
              size="icon-xs"
              variant="ghost"
              onClick={() => setLayout("grid")}
            >
              <GridFour className="size-4" />
            </Button>
          </div>
          <details className="relative">
            <summary className="flex h-8 cursor-pointer list-none items-center gap-2 border border-border bg-background px-3 text-[13px] text-primary hover:bg-background-100">
              <SlidersHorizontal className="size-4" /> View settings
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-52 border border-border bg-background p-3 shadow-xl">
              <label
                htmlFor="notes-show-favorites"
                className="flex cursor-pointer items-center justify-between gap-4 text-[13px] text-primary/70"
              >
                Show favorites
                <Checkbox
                  id="notes-show-favorites"
                  aria-label="Show favorites"
                  checked={showFavorites}
                  onCheckedChange={(checked) => setShowFavorites(checked === true)}
                />
              </label>
            </div>
          </details>
          <Button
            className="h-8 bg-[#3478f6] px-3 text-white hover:bg-[#2f6fe6]"
            size="sm"
            onClick={() => setEditing({})}
          >
            <Plus /> New note
          </Button>
        </div>
      </div>
      {tab === "templates" && templatesQuery.isError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-destructive">Could not load note templates.</p>
          <Button size="sm" variant="outline" onClick={() => void templatesQuery.refetch()}>
            <ArrowClockwise /> Retry
          </Button>
        </div>
      ) : tab === "templates" && templatesQuery.isLoading ? (
        <div className="p-4">
          <ListSkeleton />
        </div>
      ) : tab === "templates" ? (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="mb-3 flex items-center justify-between">
            <Label className="text-sm font-medium">Reusable note templates</Label>
            <Button size="sm" onClick={() => setEditingTemplate("new")}>
              <Plus /> New template
            </Button>
          </div>
          {templatesQuery.data?.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
              {templatesQuery.data.map((template) => (
                <Card className="gap-3 p-4" key={template.id}>
                  <CardTitle>{template.payload.title}</CardTitle>
                  <CardDescription className="line-clamp-3">
                    {template.payload.body || "Empty template"}
                  </CardDescription>
                  <div className="mt-auto flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditing({ template });
                        setTab("notes");
                      }}
                    >
                      Apply
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingTemplate(template)}
                    >
                      Edit
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <WorkspaceEmptyState
              action={
                <Button size="sm" onClick={() => setEditingTemplate("new")}>
                  <Plus /> Create template
                </Button>
              }
              description="Create a reusable starting point for notes."
              image="notes"
              learnMore={[]}
              title="No templates yet"
            />
          )}
        </div>
      ) : loading ? (
        <div className="p-4">
          <ListSkeleton />
        </div>
      ) : visible.length === 0 ? (
        <WorkspaceEmptyState
          action={
            <Button
              className="bg-[#3478f6] text-white hover:bg-[#2f6fe6]"
              onClick={() => setEditing({})}
              size="sm"
            >
              <Plus /> New note
            </Button>
          }
          description={
            <>
              No notes yet! Create your first
              <br />
              note to get started.
            </>
          }
          image="notes"
          learnMore={[
            { label: "Link notes to accounts" },
            { label: "Turn notes into commitments" },
          ]}
          title="Notes"
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {showFavorites ? (
            <section className="px-4 pt-3">
              <Label className="mb-3 flex items-center gap-1 text-[12px] font-normal text-primary/45">
                Favorites
                <Badge className="text-[10px] font-normal" variant="outline">
                  {favoriteNotes.length}
                </Badge>
              </Label>
              {favoritesQuery.isError ? (
                <div className="flex items-center gap-3 border border-destructive/30 p-3">
                  <p className="text-xs text-destructive">Could not load favorites.</p>
                  <Button size="sm" variant="outline" onClick={() => void favoritesQuery.refetch()}>
                    Retry
                  </Button>
                </div>
              ) : favoriteNotes.length ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2">
                  {favoriteNotes.map((note) => (
                    <Button
                      className="h-auto justify-start border p-3 text-left"
                      key={note.externalId}
                      onClick={() => setEditing(note)}
                      variant="outline"
                    >
                      <BookmarkSimple weight="fill" />
                      <span className="truncate">{note.title || "Untitled note"}</span>
                    </Button>
                  ))}
                </div>
              ) : (
                <Card className="flex h-28 items-center justify-center border-dashed py-0 text-center">
                  <CardContent>
                    <CardDescription>Favorite a note to keep it here.</CardDescription>
                  </CardContent>
                </Card>
              )}
            </section>
          ) : null}
          <div className="mt-3 border-t border-border px-4 py-3">
            <Label className="mb-3 flex items-center gap-1 text-[12px] font-normal text-primary/55">
              Created today{" "}
              <Badge className="text-[10px] font-normal" variant="outline">
                {visible.length}
              </Badge>
            </Label>
            <div
              className={
                layout === "grid"
                  ? "grid grid-cols-[repeat(auto-fill,minmax(300px,368px))] gap-3"
                  : "space-y-2"
              }
            >
              {visible.map((note) => (
                <Card
                  className={cn(
                    "cursor-pointer gap-0 py-0 transition-colors hover:bg-background-100",
                    layout === "grid" ? "h-52 max-w-[368px]" : "h-24 w-full",
                  )}
                  key={note.externalId}
                  onClick={() => setEditing(note)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setEditing(note);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <CardHeader className="flex-1 gap-1 px-4 pb-0 pt-4">
                    <div className="flex items-center gap-2 text-[12px] text-primary/65">
                      <Note className="size-3.5" />
                      <Label className="font-normal underline">{note.relationshipName}</Label>
                    </div>
                    <CardTitle className="mt-3 text-[15px] text-primary">
                      {note.title || "Untitled note"}
                    </CardTitle>
                    <CardDescription className="line-clamp-2 text-[13px]">
                      {note.body || "This note has no content."}
                    </CardDescription>
                  </CardHeader>
                  <CardFooter className="flex h-10 items-center justify-between border-t px-4 text-[12px] text-primary/50">
                    <div className="flex items-center gap-2">
                      <Avatar className="size-4 rounded-none" size="sm">
                        <AvatarFallback className="rounded-none bg-cyan-600 text-[9px] text-white">
                          Y
                        </AvatarFallback>
                      </Avatar>
                      <Label className="font-normal">You</Label>
                    </div>
                    <Badge className="font-normal" variant="secondary">
                      {relativeTime(note.occurredAt)}
                    </Badge>
                    <Button
                      aria-label={
                        favoriteIds.has(note.externalId)
                          ? `Remove ${note.title} from favorites`
                          : `Add ${note.title} to favorites`
                      }
                      disabled={favoriteMutation.isPending}
                      onClick={(event) => {
                        event.stopPropagation();
                        favoriteMutation.mutate(note.externalId);
                      }}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <BookmarkSimple
                        weight={favoriteIds.has(note.externalId) ? "fill" : "regular"}
                      />
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}
      {editing ? (
        <NoteDialog
          key={"externalId" in editing ? editing.externalId : editing.template?.id || "new"}
          note={"externalId" in editing ? editing : undefined}
          template={"template" in editing ? editing.template : undefined}
          relationships={relationships}
          onClose={() => setEditing(null)}
          onError={onError}
          onSaved={() => void load()}
          onNotice={onNotice}
        />
      ) : null}
      {editingTemplate ? (
        <TemplateDialog
          key={editingTemplate === "new" ? "new" : editingTemplate.id}
          onClose={() => setEditingTemplate(null)}
          onError={onError}
          onNotice={onNotice}
          template={editingTemplate === "new" ? undefined : editingTemplate}
        />
      ) : null}
    </div>
  );
}

function TemplateDialog({
  template,
  onClose,
  onError,
  onNotice,
}: {
  template?: NoteTemplateResource;
  onClose: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = React.useState(template?.payload.title ?? "");
  const [body, setBody] = React.useState(template?.payload.body ?? "");
  const mutation = useMutation({
    mutationFn: async (action: "save" | "delete") => {
      if (action === "delete" && template) return deleteConsoleResource(template.id);
      const payload = { title: title.trim(), body };
      if (template) return patchConsoleResource(template.id, { name: title.trim(), payload });
      return createConsoleResource({
        kind: "note_template",
        name: title.trim(),
        payload,
      });
    },
    onSuccess: (_, action) => {
      void queryClient.invalidateQueries({
        queryKey: ["console", "resources", "note_template"],
      });
      onNotice(action === "delete" ? "Template deleted." : "Template saved.");
      onClose();
    },
    onError: (error, action) =>
      onError(errMessage(error, `Could not ${action} the note template.`)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{template ? "Edit note template" : "New note template"}</DialogTitle>
          <DialogDescription>
            Templates provide a reusable title and starting body for a new note.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            aria-label="Template title"
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Quarterly account review"
            value={title}
          />
          <Textarea
            aria-label="Template body"
            className="min-h-48"
            maxLength={65_536}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Add prompts or a reusable note structure…"
            value={body}
          />
          {mutation.isError ? (
            <p className="text-xs text-destructive" role="alert">
              The template change failed. You can retry without losing this draft.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          {template ? (
            <Button
              disabled={mutation.isPending}
              onClick={() => mutation.mutate("delete")}
              type="button"
              variant="destructive"
            >
              <Trash /> Delete
            </Button>
          ) : null}
          <Button disabled={mutation.isPending} onClick={onClose} type="button" variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={mutation.isPending || !title.trim()}
            onClick={() => mutation.mutate("save")}
            type="button"
          >
            {mutation.isPending ? <Spinner className="size-4" /> : null}
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoteDialog({
  note,
  template,
  relationships,
  onClose,
  onSaved,
  onError,
  onNotice,
}: {
  note?: WorkspaceNote;
  template?: NoteTemplateResource;
  relationships: RevenueRelationship[];
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const noteId = React.useRef(note?.externalId || crypto.randomUUID()).current;
  const [title, setTitle] = React.useState(
    note?.title === "Untitled note" ? "" : note?.title || template?.payload.title || "",
  );
  const [relationshipId, setRelationshipId] = React.useState(
    note?.relationshipId || relationships[0]?.id || "",
  );
  const [content, setContent] = React.useState<Value>(() => {
    if (template?.payload.content) return template.payload.content as Value;
    if (template?.payload.body) {
      return [{ type: "p", children: [{ text: template.payload.body }] }];
    }
    return plateValue(note);
  });
  const [meetingLinked, setMeetingLinked] = React.useState(Boolean(note?.meetingLinked));
  const [maximized, setMaximized] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [saveState, setSaveState] = React.useState<"saved" | "saving" | "error">("saved");
  const lastSaved = React.useRef(
    note ? JSON.stringify([title, relationshipId, content, meetingLinked]) : "",
  );
  const editor = usePlateEditor({ plugins: notePlugins, value: content });
  const snapshot = JSON.stringify([title, relationshipId, content, meetingLinked]);

  const publish = React.useCallback(
    async (eventType: "note" | "note_deleted") => {
      if (!relationshipId) return false;
      setSaveState("saving");
      try {
        const body = plateText(content);
        await ingestRelationshipObservations([
          {
            relationshipId,
            source: "desktop_note",
            externalId: crypto.randomUUID(),
            sourceVersion: "1",
            eventType,
            occurredAt: new Date().toISOString(),
            summary: title.trim() || "Untitled note",
            normalizedFacts:
              eventType === "note"
                ? {
                    noteId,
                    title: title.trim() || "Untitled note",
                    body,
                    content,
                    meetingLinked,
                  }
                : { noteId },
          },
        ]);
        lastSaved.current = snapshot;
        setSaveState("saved");
        onSaved();
        return true;
      } catch (error) {
        setSaveState("error");
        onError(errMessage(error, "Could not save the note."));
        return false;
      }
    },
    [content, meetingLinked, noteId, onError, onSaved, relationshipId, snapshot, title],
  );

  React.useEffect(() => {
    if (!relationshipId || snapshot === lastSaved.current) return;
    const timer = window.setTimeout(() => void publish("note"), 650);
    return () => window.clearTimeout(timer);
  }, [publish, relationshipId, snapshot]);

  const noteHasDraftContent = Boolean(title.trim() || plateText(content).trim());

  const closeEditor = async () => {
    const dirty = snapshot !== lastSaved.current;
    // Empty drafts and notes without a linked company should still dismiss on close.
    if (dirty && noteHasDraftContent && relationshipId) {
      if (!(await publish("note"))) return;
    }
    onClose();
  };
  const selectedRelationship = relationships.find((item) => item.id === relationshipId);
  const bodyEmpty = !plateText(content).trim();
  return (
    <Dialog open onOpenChange={(open) => !open && void closeEditor()}>
      <DialogContent
        showCloseButton={false}
        className={`${maximized ? "h-screen w-screen" : "h-[min(588px,calc(100vh-32px))] w-[min(794px,calc(100vw-32px))]"} flex max-w-none translate-y-[-50%] flex-col gap-0 overflow-hidden border-border bg-background p-0 shadow-2xl sm:max-w-none`}
      >
        <DialogTitle className="sr-only">{title || "Untitled note"}</DialogTitle>
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-5">
          <div className="flex min-w-0 items-center gap-2 text-[12px] text-primary/80">
            <Note className="size-3.5 text-primary/45" />
            <Select value={relationshipId || undefined} onValueChange={setRelationshipId}>
              <SelectTrigger
                id="note-relationship"
                aria-label="Linked company"
                className="h-auto max-w-56 border-0 bg-transparent p-0 text-[12px] text-primary underline shadow-none focus:ring-0"
              >
                <SelectValue placeholder="Link a company" />
              </SelectTrigger>
              <SelectContent className="app-shell rounded-none">
                {relationships.map((relationship) => (
                  <SelectItem key={relationship.id} value={relationship.id}>
                    {relationship.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 text-primary/45">
            <Button
              aria-label="Minimize note"
              type="button"
              className="size-7 rounded-none text-primary/45 hover:bg-background-100 hover:text-primary"
              size="icon-xs"
              variant="ghost"
              onClick={() => void closeEditor()}
            >
              <Minus className="size-3.5" />
            </Button>
            <Button
              aria-label={maximized ? "Restore note" : "Maximize note"}
              type="button"
              className="size-7 rounded-none text-primary/45 hover:bg-background-100 hover:text-primary"
              size="icon-xs"
              variant="ghost"
              onClick={() => setMaximized((value) => !value)}
            >
              <ArrowsOut className="size-3.5" />
            </Button>
            <Button
              aria-label="Close note"
              type="button"
              className="size-7 rounded-none text-primary/45 hover:bg-background-100 hover:text-primary"
              size="icon-xs"
              variant="ghost"
              onClick={() => void closeEditor()}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1 overflow-auto px-[52px] pb-14 pt-[57px] text-primary/80">
          <div className="absolute right-[18px] top-1 flex items-center gap-3 text-[13px] text-primary/55">
            <Avatar className="size-5 rounded-none">
              <AvatarFallback className="rounded-none border border-border bg-background-100 text-[10px] font-semibold text-primary/70">
                Y
              </AvatarFallback>
            </Avatar>
            <Button
              type="button"
              className="h-auto rounded-none px-0 py-0 text-[13px] text-primary/55 hover:bg-transparent hover:text-primary"
              variant="ghost"
              onClick={async () => {
                await navigator.clipboard.writeText(
                  `${window.location.origin}${window.location.pathname}#note=${noteId}`,
                );
                onNotice("Note link copied.");
              }}
            >
              <Link className="size-3.5" /> Copy link
            </Button>
            <div className="relative">
              <Button
                aria-label="Note actions"
                type="button"
                className="size-7 rounded-none text-primary/55 hover:bg-background-100 hover:text-primary"
                size="icon-xs"
                variant="ghost"
                onClick={() => setMenuOpen((value) => !value)}
              >
                <DotsThree className="size-4" />
              </Button>
              {menuOpen ? (
                <div className="absolute right-0 top-8 z-10 w-36 border border-border bg-background p-1 shadow-xl">
                  <Button
                    type="button"
                    className="h-auto w-full justify-start rounded-none px-3 py-2 text-[12px] text-destructive hover:bg-background-100"
                    variant="ghost"
                    onClick={async () => {
                      if (await publish("note_deleted")) onClose();
                    }}
                  >
                    Delete note
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
          <Input
            aria-label="Note title"
            className="mt-8 h-auto rounded-none border-0 bg-transparent px-0 text-[32px] font-semibold leading-tight tracking-[-0.03em] text-primary shadow-none placeholder:text-primary/45 focus-visible:ring-0"
            placeholder="Untitled note"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <div className="mt-3 flex items-center gap-4 text-[13px] text-primary/55">
            <Label
              className={cn(
                "flex items-center gap-2 font-normal text-primary/55",
                selectedRelationship && "text-primary underline",
              )}
            >
              <Note className="size-3.5" />
              {selectedRelationship?.displayName || "Link a company"}
            </Label>
            <Button
              type="button"
              className="h-auto rounded-none px-0 py-0 text-[13px] text-primary/55 hover:bg-transparent hover:text-primary"
              variant="ghost"
              onClick={() => setMeetingLinked((value) => !value)}
            >
              <CalendarBlank className="size-4" />
              {meetingLinked ? "Meeting linked" : "Link a meeting"}
            </Button>
          </div>
          <div className="mt-6 flex items-center gap-1 border-y border-border py-1">
            {[
              { label: "Bold", icon: TextB, run: () => editor.tf.toggleMark("bold") },
              { label: "Italic", icon: TextItalic, run: () => editor.tf.toggleMark("italic") },
              {
                label: "Underline",
                icon: TextUnderline,
                run: () => editor.tf.toggleMark("underline"),
              },
              { label: "Heading", icon: TextHOne, run: () => editor.tf.toggleBlock("h2") },
              { label: "Quote", icon: Quotes, run: () => editor.tf.toggleBlock("blockquote") },
            ].map(({ label, icon: Icon, run }) => (
              <Button
                aria-label={label}
                className="size-8 rounded-none text-primary/45 hover:bg-background-100 hover:text-primary"
                key={label}
                onMouseDown={(event) => {
                  event.preventDefault();
                  run();
                }}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <Icon className="size-4" />
              </Button>
            ))}
          </div>
          <Plate editor={editor} onChange={({ value }) => setContent(value)}>
            <PlateContent
              aria-label="Note content"
              className="mt-6 min-h-24 text-[14px] leading-6 text-primary/80 outline-none [&_.slate-blockquote]:my-3 [&_.slate-blockquote]:border-l-2 [&_.slate-blockquote]:border-primary/25 [&_.slate-blockquote]:pl-3 [&_.slate-blockquote]:text-primary/60 [&_.slate-h2]:my-3 [&_.slate-h2]:text-xl [&_.slate-h2]:font-semibold [&_[data-slate-placeholder]]:text-primary/45"
              placeholder="Start typing your note"
            />
          </Plate>
          {bodyEmpty ? (
            <div className="mt-6 space-y-7 text-[13px] text-primary/55">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-primary/45">
                  Favorite templates
                </p>
                <p className="mt-2">Templates that you favorite will appear here</p>
              </div>
              <div className="space-y-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-primary/45">
                  Actions
                </p>
                <Button
                  type="button"
                  className="h-auto justify-start rounded-none px-0 py-0 text-[13px] text-primary/55 hover:bg-transparent hover:text-primary"
                  variant="ghost"
                >
                  <Note className="size-4" /> View all templates
                </Button>
                <Button
                  type="button"
                  className="h-auto justify-start rounded-none px-0 py-0 text-[13px] text-primary/55 hover:bg-transparent hover:text-primary"
                  variant="ghost"
                >
                  <Note className="size-4" /> Create new template
                </Button>
              </div>
            </div>
          ) : null}
          {saveState !== "saved" ? (
            <Label
              className={`absolute right-5 bottom-3 text-[11px] font-normal ${saveState === "error" ? "text-destructive" : "text-primary/55"}`}
            >
              {saveState === "saving" ? "Saving…" : "Save failed"}
            </Label>
          ) : null}
        </div>
        <Button
          aria-label="Insert content"
          type="button"
          className="absolute bottom-3 left-4 size-5 rounded-none border border-border p-0 text-primary/55 hover:bg-background-100 hover:text-primary"
          size="icon-xs"
          variant="ghost"
        >
          <Plus className="size-3" />
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function TasksView({ onError, onNotice }: ViewProps) {
  const [tasks, setTasks] = React.useState<RevenueAction[]>([]);
  const [relationships, setRelationships] = React.useState<RevenueRelationship[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [filter, setFilter] = React.useState<"all" | "today" | "overdue">("all");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [now] = React.useState(() => Date.now());
  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [actions, records] = await Promise.all([listActions("open", 100), listRelationships()]);
      setTasks(
        actions
          .filter((action) => action.actionType === "follow_up_task" && action.channel === "task")
          .sort((left, right) => (left.dueAt || "9999").localeCompare(right.dueAt || "9999")),
      );
      setRelationships(records.filter((record) => record.kind !== "person"));
    } catch (error) {
      onError(errMessage(error, "Could not load tasks."));
    } finally {
      setLoading(false);
    }
  }, [onError]);
  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const names = new Map(
    relationships.map((relationship) => [relationship.id, relationship.displayName]),
  );
  const today = todayValue();
  const visible = tasks.filter((task) => {
    if (filter === "today") return task.dueAt?.slice(0, 10) === today;
    if (filter === "overdue") return Boolean(task.dueAt && new Date(task.dueAt).getTime() < now);
    return true;
  });
  const complete = async (task: RevenueAction) => {
    setBusy(task.id);
    try {
      await dismissAction(task.id, "Completed from Tasks");
      onNotice("Task completed.");
      await load();
    } catch (error) {
      onError(errMessage(error, "Could not complete the task."));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex min-h-full flex-col bg-background" data-slot="tasks-view">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <Badge
            className="h-8 gap-2 border border-border bg-background px-3 text-[13px] font-normal text-primary/60"
            variant="outline"
          >
            <List className="size-4" /> Sorted by{" "}
            <Label className="font-normal text-primary">Due date</Label>
          </Badge>
          <Select value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
            <SelectTrigger
              id="task-filter"
              aria-label="Filter tasks"
              className="h-8 w-auto gap-2 rounded-none border border-border bg-background px-3 text-[13px] text-primary/55 shadow-none hover:bg-background-100"
              size="sm"
            >
              <Funnel className="size-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="app-shell rounded-none">
              <SelectItem value="all">Filter</SelectItem>
              <SelectItem value="today">Due today</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            className="h-8 rounded-none border border-border bg-background px-3 text-[13px] text-primary hover:bg-background-100"
            variant="ghost"
          >
            <SlidersHorizontal className="size-4" /> View settings
          </Button>
          <Button
            className="h-8 bg-[#3478f6] px-3 text-white hover:bg-[#2f6fe6]"
            size="sm"
            onClick={() => setCreating(true)}
          >
            <Plus /> New task
          </Button>
        </div>
      </div>
      {loading ? (
        <div className="p-4">
          <ListSkeleton />
        </div>
      ) : visible.length === 0 ? (
        <WorkspaceEmptyState
          action={
            <Button
              className="bg-[#3478f6] text-white hover:bg-[#2f6fe6]"
              onClick={() => setCreating(true)}
              size="sm"
            >
              <Plus /> New task
            </Button>
          }
          description={
            <>
              No tasks yet! Create your first
              <br />
              task to get started.
            </>
          }
          image="tasks"
          title="Tasks"
        />
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((task) => {
            const overdue = Boolean(task.dueAt && new Date(task.dueAt).getTime() < now);
            return (
              <li
                key={task.id}
                className="grid min-h-12 grid-cols-[36px_minmax(0,1fr)_220px_150px] items-center gap-3 px-3 hover:bg-background-100/70"
              >
                <Button
                  aria-label={`Complete ${task.reason}`}
                  className="size-5 rounded-none border border-border p-0 text-primary/40 hover:border-[#3478f6] hover:bg-transparent hover:text-[#3478f6]"
                  disabled={busy === task.id}
                  onClick={() => void complete(task)}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  {busy === task.id ? <Spinner className="size-3" /> : null}
                </Button>
                <Label className="truncate text-[13px] font-medium text-primary">
                  {task.reason}
                </Label>
                <CardDescription className="truncate text-[12px]">
                  {names.get(task.relationshipId || "") || "Unlinked"}
                </CardDescription>
                <Badge
                  className={cn(
                    "ml-auto justify-end text-[12px] font-normal",
                    overdue ? "text-red-500" : "text-primary/45",
                  )}
                  variant="secondary"
                >
                  {task.dueAt
                    ? new Date(task.dueAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "No due date"}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
      {creating ? (
        <TaskCreateDialog
          open
          relationships={relationships}
          onError={onError}
          onOpenChange={setCreating}
          onSaved={() => {
            onNotice("Task created.");
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
