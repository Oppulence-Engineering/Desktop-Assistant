"use client";

import "client-only";

import * as React from "react";
import type { Value } from "platejs";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import {
  ArrowsOut,
  ArrowClockwise,
  CalendarBlank,
  CaretDown,
  CheckSquare,
  CircleNotch,
  DotsThree,
  Funnel,
  GridFour,
  Link,
  List,
  ListChecks,
  MagnifyingGlass,
  Minus,
  Note,
  NotePencil,
  Plus,
  SlidersHorizontal,
  SquaresFour,
  User,
  X,
} from "@phosphor-icons/react";

import { EmptyBlock, errMessage, ListSkeleton } from "@/components/revenue/shared";
import { Button } from "@oppulence/ui/components/button";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@oppulence/ui/components/sheet";
import { collapseWorkspaceNotes, plateText, type WorkspaceNote } from "@/lib/revenue-records";
import {
  createAction,
  createRelationship,
  dismissAction,
  getPersonAttributes,
  getRelationshipTimeline,
  ingestRelationshipObservations,
  listActions,
  listPersons,
  listRelationships,
  relativeTime,
} from "@/lib/revenue";
import type {
  RelationshipPerson,
  RelationshipPersonAttribute,
  RevenueAction,
  RevenueRelationship,
} from "@/types/revenue";

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
      <div className="flex h-8 items-center gap-2 border border-border bg-background px-3 text-[13px] font-medium text-primary">
        {icon} {label} <span className="text-primary/40">{count}</span>
      </div>
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
        <span className="text-[12px] text-primary/45">Sorted by last interaction</span>
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
          icon={<User className="size-6" />}
          title="No people yet"
          body="Connect Gmail or add a person to build a relationship-aware contact record."
        >
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> Add person
          </Button>
        </EmptyBlock>
      ) : (
        <div className="min-w-0 flex-1 overflow-auto">
          <table
            className="w-full min-w-[900px] table-fixed border-collapse text-left"
            aria-label="People"
          >
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="h-10 border-b border-border text-[12px] font-medium text-primary/55">
                <th className="w-10 border-r border-border px-3">
                  <input
                    aria-label="Select all people"
                    className="size-4 accent-[#3478f6]"
                    type="checkbox"
                  />
                </th>
                <th className="w-[250px] border-r border-border px-3">Person</th>
                <th className="w-[210px] border-r border-border px-3">Company</th>
                <th className="w-36 border-r border-border px-3">Role</th>
                <th className="w-36 border-r border-border px-3">Last interaction</th>
                <th className="w-28 border-r border-border px-3 text-center">Relationships</th>
                <th className="px-3">Enrichment</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr
                  key={person.id}
                  className="h-11 border-b border-border hover:bg-background-100/70"
                >
                  <td className="border-r border-border px-3">
                    <input
                      aria-label={`Select ${person.displayName}`}
                      className="size-4 accent-[#3478f6]"
                      type="checkbox"
                    />
                  </td>
                  <td className="border-r border-border px-3">
                    <button
                      aria-label={`Open ${person.displayName}`}
                      className="flex w-full items-center gap-2 text-left"
                      type="button"
                      onClick={() => void openPerson(person)}
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center border border-border bg-background-100 text-[10px] font-semibold text-primary/60">
                        {initials(person.displayName)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-primary">
                          {person.displayName}
                        </span>
                        <span className="block truncate text-[11px] text-primary/40">
                          {person.primaryEmail || "No email"}
                        </span>
                      </span>
                    </button>
                  </td>
                  <td className="truncate border-r border-border px-3 text-[12px] text-primary/60">
                    {person.orgName || person.orgDomain || "—"}
                  </td>
                  <td className="truncate border-r border-border px-3 text-[12px] text-primary/60">
                    {person.title || person.seniority || "—"}
                  </td>
                  <td className="border-r border-border px-3 text-[12px] text-primary/50">
                    {person.lastInteractionAt ? relativeTime(person.lastInteractionAt) : "—"}
                  </td>
                  <td className="border-r border-border px-3 text-center text-[12px] text-primary/60">
                    {person.relationshipCount}
                  </td>
                  <td className="truncate px-3 text-[12px] text-primary/50">
                    {person.location ||
                      (person.attributesVersion
                        ? `${person.attributesVersion} verified fields`
                        : "Not enriched")}
                  </td>
                </tr>
              ))}
            </tbody>
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
            {busy ? <CircleNotch className="animate-spin" /> : <Plus />} Create
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
              ["Location", person.location],
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
                    <span className="text-sm font-medium capitalize text-primary">
                      {attribute.dimension.replaceAll("_", " ")}
                    </span>
                    <span className="text-xs text-primary/40">
                      {Math.round(attribute.confidence * 100)}%
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-primary/65">{attribute.value}</p>
                  <p className="mt-1 text-[11px] text-primary/40">
                    {attribute.source} · {relativeTime(attribute.observedAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

async function listWorkspaceNotes(): Promise<{
  notes: WorkspaceNote[];
  relationships: RevenueRelationship[];
}> {
  const relationships = (await listRelationships()).filter(
    (relationship) => relationship.kind !== "person",
  );
  // ponytail: timeline fan-out is sufficient for the current 200-record beta; add a global notes endpoint when this becomes measurably slow.
  const timelines = await Promise.all(
    relationships.map((relationship) => getRelationshipTimeline(relationship.id, 200)),
  );
  return {
    notes: collapseWorkspaceNotes(relationships, timelines),
    relationships,
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
  const [notes, setNotes] = React.useState<WorkspaceNote[]>([]);
  const [relationships, setRelationships] = React.useState<RevenueRelationship[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<WorkspaceNote | "new" | null>(null);
  const [tab, setTab] = React.useState<"notes" | "templates">("notes");
  const [layout, setLayout] = React.useState<"grid" | "list">("grid");
  const [newestFirst, setNewestFirst] = React.useState(true);
  const [showFavorites, setShowFavorites] = React.useState(true);
  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await listWorkspaceNotes();
      setNotes(result.notes);
      setRelationships(result.relationships);
    } catch (error) {
      onError(errMessage(error, "Could not load notes."));
    } finally {
      setLoading(false);
    }
  }, [onError]);
  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const visible = [...notes].sort((left, right) =>
    newestFirst
      ? right.occurredAt.localeCompare(left.occurredAt)
      : left.occurredAt.localeCompare(right.occurredAt),
  );
  return (
    <div className="flex min-h-full flex-col bg-background" data-slot="notes-view">
      <div className="flex h-11 shrink-0 items-end gap-1 border-b border-border px-3">
        <button
          type="button"
          className={`flex h-9 items-center gap-2 border px-3 text-[13px] ${tab === "notes" ? "border-border bg-background-100 text-primary" : "border-transparent text-primary/55"}`}
          onClick={() => setTab("notes")}
        >
          <Note className="size-4" /> Notes <span className="text-primary/40">{notes.length}</span>
        </button>
        <button
          type="button"
          className={`flex h-9 items-center gap-2 border px-3 text-[13px] ${tab === "templates" ? "border-border bg-background-100 text-primary" : "border-transparent text-primary/55"}`}
          onClick={() => setTab("templates")}
        >
          <NotePencil className="size-4" /> Templates <span className="text-primary/40">0</span>
        </button>
      </div>
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
        <button
          type="button"
          className="flex h-8 items-center gap-2 border border-border bg-background px-3 text-[13px] text-primary/60 hover:bg-background-100"
          onClick={() => setNewestFirst((value) => !value)}
        >
          <List className="size-4" /> Sorted by <span className="text-primary">Creation date</span>
          <CaretDown className={`size-3 transition-transform ${newestFirst ? "" : "rotate-180"}`} />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-8 border border-border bg-background p-0.5">
            <button
              aria-label="List view"
              type="button"
              className={`flex w-7 items-center justify-center ${layout === "list" ? "bg-background-200 text-primary" : "text-primary/45"}`}
              onClick={() => setLayout("list")}
            >
              <List className="size-4" />
            </button>
            <button
              aria-label="Grid view"
              type="button"
              className={`flex w-7 items-center justify-center ${layout === "grid" ? "bg-background-200 text-primary" : "text-primary/45"}`}
              onClick={() => setLayout("grid")}
            >
              <GridFour className="size-4" />
            </button>
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
                <input
                  id="notes-show-favorites"
                  aria-label="Show favorites"
                  type="checkbox"
                  checked={showFavorites}
                  onChange={(event) => setShowFavorites(event.target.checked)}
                />
              </label>
            </div>
          </details>
          <Button
            className="h-8 bg-[#3478f6] px-3 text-white hover:bg-[#2f6fe6]"
            size="sm"
            onClick={() => setEditing("new")}
          >
            <Plus /> New note
          </Button>
        </div>
      </div>
      {loading ? (
        <div className="p-4">
          <ListSkeleton />
        </div>
      ) : tab === "templates" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <NotePencil className="size-9 text-primary/25" />
          <div>
            <p className="text-[17px] font-semibold text-primary">Templates</p>
            <p className="mt-1 text-[13px] text-primary/45">
              Create reusable structures for your team&apos;s notes.
            </p>
          </div>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus /> Create new template
          </Button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {showFavorites ? (
            <section className="px-4 pt-3">
              <p className="mb-3 text-[12px] text-primary/45">Favorites</p>
              <div className="flex h-44 items-center justify-center border border-dashed border-border text-center">
                <div>
                  <p className="text-[16px] font-semibold text-primary/70">Favorites</p>
                  <p className="mt-2 text-[13px] text-primary/45">
                    Notes that you favorite will appear here
                  </p>
                </div>
              </div>
            </section>
          ) : null}
          <div className="mt-3 border-t border-border px-4 py-3">
            <p className="mb-3 text-[12px] text-primary/55">
              Created today{" "}
              <span className="ml-1 border border-border px-1 text-[10px]">{visible.length}</span>
            </p>
            {visible.length ? (
              <div
                className={
                  layout === "grid"
                    ? "grid grid-cols-[repeat(auto-fill,minmax(300px,368px))] gap-3"
                    : "space-y-2"
                }
              >
                {visible.map((note) => (
                  <button
                    key={note.externalId}
                    aria-label={`Open ${note.title || "Untitled note"}`}
                    type="button"
                    className={`${layout === "grid" ? "h-52 max-w-[368px]" : "h-24 w-full"} flex flex-col border border-border bg-background text-left hover:bg-background-100`}
                    onClick={() => setEditing(note)}
                  >
                    <span className="flex flex-1 flex-col p-4">
                      <span className="flex items-center gap-2 text-[12px] text-primary/65">
                        <Note className="size-3.5" />
                        <span className="underline">{note.relationshipName}</span>
                      </span>
                      <span className="mt-3 text-[15px] font-semibold text-primary">
                        {note.title || "Untitled note"}
                      </span>
                      <span className="mt-1 line-clamp-2 text-[13px] text-primary/45">
                        {note.body || "This note has no content."}
                      </span>
                    </span>
                    <span className="flex h-10 shrink-0 items-center justify-between border-t border-border px-4 text-[12px] text-primary/50">
                      <span className="flex items-center gap-2">
                        <span className="flex size-4 items-center justify-center bg-cyan-600 text-[9px] text-white">
                          Y
                        </span>
                        You
                      </span>
                      <span>{relativeTime(note.occurredAt)}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <button
                type="button"
                className="flex h-36 w-full items-center justify-center border border-dashed border-border text-[13px] text-primary/45 hover:bg-background-100"
                onClick={() => setEditing("new")}
              >
                <Plus className="mr-2 size-4" /> Create your first note
              </button>
            )}
          </div>
        </div>
      )}
      {editing ? (
        <NoteDialog
          key={editing === "new" ? "new" : editing.externalId}
          note={editing === "new" ? undefined : editing}
          relationships={relationships}
          onClose={() => setEditing(null)}
          onError={onError}
          onSaved={() => void load()}
          onNotice={onNotice}
        />
      ) : null}
    </div>
  );
}

function NoteDialog({
  note,
  relationships,
  onClose,
  onSaved,
  onError,
  onNotice,
}: {
  note?: WorkspaceNote;
  relationships: RevenueRelationship[];
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const noteId = React.useRef(note?.externalId || crypto.randomUUID()).current;
  const [title, setTitle] = React.useState(
    note?.title === "Untitled note" ? "" : note?.title || "",
  );
  const [relationshipId, setRelationshipId] = React.useState(
    note?.relationshipId || relationships[0]?.id || "",
  );
  const [content, setContent] = React.useState<Value>(() => plateValue(note));
  const [meetingLinked, setMeetingLinked] = React.useState(Boolean(note?.meetingLinked));
  const [maximized, setMaximized] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [saveState, setSaveState] = React.useState<"saved" | "saving" | "error">("saved");
  const lastSaved = React.useRef(
    note ? JSON.stringify([title, relationshipId, content, meetingLinked]) : "",
  );
  const editor = usePlateEditor({ value: content });
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
                ? { noteId, title: title.trim() || "Untitled note", body, content, meetingLinked }
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

  const closeEditor = async () => {
    if (snapshot !== lastSaved.current && !(await publish("note"))) return;
    onClose();
  };
  const selectedRelationship = relationships.find((item) => item.id === relationshipId);
  const bodyEmpty = !plateText(content).trim();
  return (
    <Dialog open onOpenChange={(open) => !open && void closeEditor()}>
      <DialogContent
        showCloseButton={false}
        className={`${maximized ? "h-screen w-screen" : "h-[min(588px,calc(100vh-32px))] w-[min(794px,calc(100vw-32px))]"} flex max-w-none translate-y-[-50%] flex-col gap-0 overflow-hidden border-border bg-[#17181a] p-0 shadow-2xl sm:max-w-none`}
      >
        <DialogTitle className="sr-only">{title || "Untitled note"}</DialogTitle>
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/8 px-5">
          <label
            htmlFor="note-relationship"
            className="flex min-w-0 items-center gap-2 text-[12px] text-white/80"
          >
            <Note className="size-3.5 text-white/45" />
            <select
              id="note-relationship"
              aria-label="Linked company"
              className="max-w-56 appearance-none bg-transparent text-[12px] text-white/85 underline outline-none"
              value={relationshipId}
              onChange={(event) => setRelationshipId(event.target.value)}
            >
              <option value="">Link a company</option>
              {relationships.map((relationship) => (
                <option value={relationship.id} key={relationship.id}>
                  {relationship.displayName}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2 text-white/45">
            <button
              aria-label="Minimize note"
              type="button"
              className="flex size-7 items-center justify-center hover:bg-white/5 hover:text-white"
              onClick={() => void closeEditor()}
            >
              <Minus className="size-3.5" />
            </button>
            <button
              aria-label={maximized ? "Restore note" : "Maximize note"}
              type="button"
              className="flex size-7 items-center justify-center hover:bg-white/5 hover:text-white"
              onClick={() => setMaximized((value) => !value)}
            >
              <ArrowsOut className="size-3.5" />
            </button>
            <button
              aria-label="Close note"
              type="button"
              className="flex size-7 items-center justify-center hover:bg-white/5 hover:text-white"
              onClick={() => void closeEditor()}
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1 overflow-auto px-[52px] pb-14 pt-[57px] text-white/80">
          <div className="absolute right-[18px] top-1 flex items-center gap-3 text-[13px] text-white/55">
            <span className="flex size-5 items-center justify-center bg-cyan-600 text-[10px] font-semibold text-white">
              Y
            </span>
            <button
              type="button"
              className="flex items-center gap-2 hover:text-white"
              onClick={async () => {
                await navigator.clipboard.writeText(
                  `${window.location.origin}${window.location.pathname}#note=${noteId}`,
                );
                onNotice("Note link copied.");
              }}
            >
              <Link className="size-3.5" /> Copy link
            </button>
            <div className="relative">
              <button
                aria-label="Note actions"
                type="button"
                className="flex size-7 items-center justify-center hover:bg-white/5 hover:text-white"
                onClick={() => setMenuOpen((value) => !value)}
              >
                <DotsThree className="size-4" />
              </button>
              {menuOpen ? (
                <div className="absolute right-0 top-8 z-10 w-36 border border-white/10 bg-[#202124] p-1 shadow-xl">
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-[12px] text-red-400 hover:bg-white/5"
                    onClick={async () => {
                      if (await publish("note_deleted")) onClose();
                    }}
                  >
                    Delete note
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <input
            aria-label="Note title"
            className="mt-8 w-full bg-transparent text-[32px] font-semibold leading-tight tracking-[-0.03em] text-white/85 outline-none placeholder:text-white/42"
            placeholder="Untitled note"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <div className="mt-3 flex items-center gap-4 text-[13px] text-white/55">
            <span className="flex items-center gap-2">
              <Note className="size-3.5" />
              <span className="text-white/80 underline">
                {selectedRelationship?.displayName || "Link a company"}
              </span>
            </span>
            <button
              type="button"
              className="flex items-center gap-2 hover:text-white"
              onClick={() => setMeetingLinked((value) => !value)}
            >
              <CalendarBlank className="size-4" />
              {meetingLinked ? "Meeting linked" : "Link a meeting"}
            </button>
          </div>
          <Plate editor={editor} onChange={({ value }) => setContent(value)}>
            <PlateContent
              aria-label="Note content"
              className="mt-8 min-h-24 text-[14px] leading-6 text-white/80 outline-none [&_[data-slate-placeholder]]:text-white/38"
              placeholder="Start typing your note"
            />
          </Plate>
          {bodyEmpty ? (
            <div className="mt-6 space-y-7 text-[13px] text-white/55">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-white/45">
                  Favorite templates
                </p>
                <p className="mt-2">Templates that you favorite will appear here</p>
              </div>
              <div className="space-y-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-white/45">
                  Actions
                </p>
                <button type="button" className="flex items-center gap-2 hover:text-white">
                  <Note className="size-4" /> View all templates
                </button>
                <button type="button" className="flex items-center gap-2 hover:text-white">
                  <Note className="size-4" /> Create new template
                </button>
              </div>
            </div>
          ) : null}
          {saveState !== "saved" ? (
            <span
              className={`absolute right-5 bottom-3 text-[11px] ${saveState === "error" ? "text-red-400" : "text-white/35"}`}
            >
              {saveState === "saving" ? "Saving…" : "Save failed"}
            </span>
          ) : null}
        </div>
        <button
          aria-label="Insert content"
          type="button"
          className="absolute bottom-3 left-4 flex size-5 items-center justify-center border border-white/10 text-white/55 hover:bg-white/5 hover:text-white"
        >
          <Plus className="size-3" />
        </button>
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
          <span className="flex h-8 items-center gap-2 border border-border bg-background px-3 text-[13px] text-primary/60">
            <List className="size-4" /> Sorted by <span className="text-primary">Due date</span>
          </span>
          <label
            htmlFor="task-filter"
            className="relative flex h-8 items-center gap-2 border border-border bg-background px-3 text-[13px] text-primary/55 hover:bg-background-100"
          >
            <Funnel className="size-4" />
            <select
              id="task-filter"
              aria-label="Filter tasks"
              className="appearance-none bg-transparent pr-4 outline-none"
              value={filter}
              onChange={(event) => setFilter(event.target.value as typeof filter)}
            >
              <option value="all">Filter</option>
              <option value="today">Due today</option>
              <option value="overdue">Overdue</option>
            </select>
            <CaretDown className="pointer-events-none absolute right-2 size-3" />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex h-8 items-center gap-2 border border-border bg-background px-3 text-[13px] text-primary hover:bg-background-100"
          >
            <SlidersHorizontal className="size-4" /> View settings
          </button>
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
        <div className="flex min-h-[560px] flex-1 flex-col justify-between px-16 py-14">
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="relative flex size-48 items-center justify-center border-x border-dashed border-border/60 before:absolute before:inset-x-[-30px] before:top-1/2 before:border-t before:border-dashed before:border-border/60">
              <ListChecks className="relative z-10 size-16 text-primary/25" weight="thin" />
            </div>
            <p className="mt-4 text-[22px] font-semibold text-primary">Tasks</p>
            <p className="mt-1 max-w-64 text-[14px] leading-5 text-primary/50">
              No tasks yet! Create your first
              <br />
              task to get started.
            </p>
            <Button
              className="mt-4 bg-[#3478f6] text-white hover:bg-[#2f6fe6]"
              size="sm"
              onClick={() => setCreating(true)}
            >
              <Plus /> New task
            </Button>
          </div>
          <div>
            <p className="mb-3 text-[12px] text-primary/45">Learn more</p>
            <div className="grid grid-cols-2 gap-3">
              {["Notes, Tasks, and Email sending", "Introduction to tasks"].map((label) => (
                <div
                  key={label}
                  className="flex h-20 items-center gap-4 border border-border px-4 text-[13px] text-primary"
                >
                  <span className="flex size-12 items-center justify-center border border-border">
                    <SquaresFour className="size-6 text-primary/45" />
                  </span>
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((task) => {
            const overdue = Boolean(task.dueAt && new Date(task.dueAt).getTime() < now);
            return (
              <li
                key={task.id}
                className="grid min-h-12 grid-cols-[36px_minmax(0,1fr)_220px_150px] items-center gap-3 px-3 hover:bg-background-100/70"
              >
                <button
                  aria-label={`Complete ${task.reason}`}
                  className="flex size-5 items-center justify-center border border-border text-primary/40 hover:border-[#3478f6] hover:text-[#3478f6]"
                  disabled={busy === task.id}
                  onClick={() => void complete(task)}
                  type="button"
                >
                  {busy === task.id ? <CircleNotch className="animate-spin" /> : null}
                </button>
                <span className="truncate text-[13px] font-medium text-primary">{task.reason}</span>
                <span className="truncate text-[12px] text-primary/55">
                  {names.get(task.relationshipId || "") || "Unlinked"}
                </span>
                <span
                  className={`text-right text-[12px] ${overdue ? "text-red-500" : "text-primary/45"}`}
                >
                  {task.dueAt
                    ? new Date(task.dueAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "No due date"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {creating ? (
        <TaskDialog
          relationships={relationships}
          onClose={() => setCreating(false)}
          onError={onError}
          onSaved={() => {
            onNotice("Task created.");
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function TaskDialog({
  relationships,
  onClose,
  onSaved,
  onError,
}: {
  relationships: RevenueRelationship[];
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = React.useState("");
  const [relationshipId, setRelationshipId] = React.useState("");
  const [dueDate, setDueDate] = React.useState(todayValue);
  const [createMore, setCreateMore] = React.useState(false);
  const [recordError, setRecordError] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    if (!title.trim()) return;
    if (!relationshipId) {
      setRecordError(true);
      return;
    }
    setBusy(true);
    try {
      await createAction({
        relationshipId,
        actionType: "follow_up_task",
        channel: "task",
        reason: title.trim(),
        dueAt: new Date(`${dueDate}T17:00:00`).toISOString(),
        priorityScore: 30,
      });
      onSaved();
      if (createMore) {
        setTitle("");
        setRecordError(false);
      } else onClose();
    } catch (error) {
      onError(errMessage(error, "Could not create the task."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="top-9 h-auto w-[min(804px,calc(100vw-32px))] max-w-none translate-y-0 gap-0 overflow-hidden border-border bg-[#17181a] p-0 text-white shadow-2xl sm:max-w-none"
      >
        <DialogTitle className="sr-only">Create task</DialogTitle>
        <div className="flex h-12 items-center justify-between border-b border-white/8 px-4">
          <span className="flex items-center gap-2 text-[14px] font-medium text-white/85">
            <CheckSquare className="size-4" /> Create task
          </span>
          <button
            aria-label="Close task"
            type="button"
            className="flex size-7 items-center justify-center text-white/45 hover:bg-white/5 hover:text-white"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
        <textarea
          aria-label="Task title"
          className="min-h-[50px] w-full resize-none bg-transparent px-5 py-4 text-[14px] text-white/85 outline-none placeholder:text-white/38"
          placeholder="Schedule a demo with @Contact"
          rows={1}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="flex min-h-11 items-center justify-between gap-3 border-t border-white/8 px-4 py-1.5">
          <div className="flex min-w-0 items-center gap-4 text-[13px] text-white/55">
            <label
              htmlFor="task-due-date"
              className="relative flex cursor-pointer items-center gap-2 hover:text-white"
            >
              <CalendarBlank className="size-4" />
              <span>
                {dueDate === todayValue()
                  ? "Today"
                  : new Date(`${dueDate}T12:00:00`).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
              </span>
              <input
                id="task-due-date"
                aria-label="Due date"
                className="absolute inset-0 cursor-pointer opacity-0"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </label>
            <span className="flex items-center gap-2">
              <User className="size-4" /> Assigned to You
            </span>
            <label
              htmlFor="task-relationship"
              className={`relative flex items-center gap-2 ${recordError ? "text-red-400" : "hover:text-white"}`}
            >
              <Link className="size-4" />
              <select
                id="task-relationship"
                aria-label="Linked company"
                className="max-w-44 appearance-none bg-transparent pr-4 outline-none"
                value={relationshipId}
                onChange={(event) => {
                  setRelationshipId(event.target.value);
                  setRecordError(false);
                }}
              >
                <option value="">{recordError ? "Add a record to save" : "Add record"}</option>
                {relationships.map((relationship) => (
                  <option value={relationship.id} key={relationship.id}>
                    {relationship.displayName}
                  </option>
                ))}
              </select>
              <CaretDown className="pointer-events-none absolute right-0 size-3" />
            </label>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-[13px]">
            <button
              type="button"
              role="switch"
              aria-checked={createMore}
              className="flex items-center gap-2 text-white/55 hover:text-white"
              onClick={() => setCreateMore((value) => !value)}
            >
              <span
                className={`relative h-4 w-7 border border-white/15 ${createMore ? "bg-[#3478f6]" : "bg-white/10"}`}
              >
                <span
                  className={`absolute top-[2px] size-2.5 bg-white transition-transform ${createMore ? "translate-x-3" : "translate-x-0.5"}`}
                />
              </span>
              Create more
            </button>
            <button
              type="button"
              className="flex h-8 items-center gap-1 px-2 text-white/80 hover:bg-white/5"
              onClick={onClose}
            >
              Cancel{" "}
              <kbd className="border border-white/10 px-1 text-[10px] text-white/35">ESC</kbd>
            </button>
            <button
              type="button"
              className="flex h-8 items-center gap-1 bg-[#3478f6] px-3 text-white hover:bg-[#2f6fe6]"
              disabled={busy || !title.trim() || !dueDate}
              onClick={() => void submit()}
            >
              {busy ? <CircleNotch className="animate-spin" /> : null}Save{" "}
              <kbd className="border border-white/15 px-1 text-[10px]">↵</kbd>
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
