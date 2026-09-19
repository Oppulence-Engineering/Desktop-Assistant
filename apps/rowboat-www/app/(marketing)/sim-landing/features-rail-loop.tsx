"use client";

import { Children, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/sim/cn";

import { EdgeFade } from "./edge-fade";

const RAIL_BLEED = "-mx-[calc(50cqw_-_50%)] px-[calc(50cqw_-_50%)]";
const RAIL_EDGE_SPAN =
  "pointer-events-none absolute inset-y-0 z-10 left-[calc(50%_-_50cqw)] right-[calc(50%_-_50cqw)]";
const SLOT_CLASS = "w-[min(78vw,420px)] shrink-0 max-sm:w-[84vw]";
const DRAG_THRESHOLD_PX = 6;
const FOLD_TOLERANCE = 1;

type Copy = "lead" | "home" | "tail";

/** Folds a scroll position back into the loop's home range (ported from sim.ai). */
export function foldScrollLeft(scrollLeft: number, setWidth: number): number {
  if (setWidth <= 0) return scrollLeft;
  const from = setWidth / 2;
  const offset = (((scrollLeft - from) % setWidth) + setWidth) % setWidth;
  return from + offset;
}

function Slots({ copy, cards }: { copy: Copy; cards: ReactNode[] }) {
  const clone = copy !== "home";
  return (
    <>
      {cards.map((card, index) => (
        <div
          aria-hidden={clone ? "true" : undefined}
          className={SLOT_CLASS}
          data-copy={copy}
          key={`${copy}-${index}`}
        >
          {card}
        </div>
      ))}
    </>
  );
}

interface SimFeaturesRailLoopProps {
  label: string;
  children: ReactNode;
}

/** Sim infinite horizontal product rail with native scroll and drag support. */
export function SimFeaturesRailLoop({ label, children }: SimFeaturesRailLoopProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const setWidthRef = useRef(0);
  const [looping, setLooping] = useState(false);
  const cards = Children.toArray(children);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    if (typeof IntersectionObserver === "undefined") {
      setLooping(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setLooping(true);
        observer.disconnect();
      },
      { rootMargin: "600px" },
    );
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!looping) return;
    const rail = railRef.current;
    if (!rail) return;

    const measure = () => {
      const lead = rail.querySelector<HTMLElement>('[data-copy="lead"]');
      const home = rail.querySelector<HTMLElement>('[data-copy="home"]');
      setWidthRef.current = lead && home ? home.offsetLeft - lead.offsetLeft : 0;
    };
    const fold = () => {
      const next = foldScrollLeft(rail.scrollLeft, setWidthRef.current);
      if (Math.abs(next - rail.scrollLeft) > FOLD_TOLERANCE) rail.scrollLeft = next;
    };

    for (const control of rail.querySelectorAll<HTMLElement>(
      ':is([data-copy="lead"], [data-copy="tail"]) :is(a, button, input, select, textarea, [tabindex])',
    )) {
      control.tabIndex = -1;
    }
    measure();
    rail.scrollLeft = foldScrollLeft(rail.scrollLeft + setWidthRef.current, setWidthRef.current);
    rail.addEventListener("scroll", fold, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => {
            measure();
            fold();
          });
    observer?.observe(rail);

    return () => {
      rail.removeEventListener("scroll", fold);
      observer?.disconnect();
    };
  }, [looping]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    let pointerId: number | null = null;
    let startX = 0;
    let lastX = 0;
    let dragged = false;
    let suppressNextClick = false;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      lastX = event.clientX;
      dragged = false;
      suppressNextClick = false;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      if (!dragged) {
        if (Math.abs(event.clientX - startX) < DRAG_THRESHOLD_PX) return;
        dragged = true;
        rail.dataset.dragging = "";
        rail.setPointerCapture?.(event.pointerId);
      }
      rail.scrollLeft -= event.clientX - lastX;
      lastX = event.clientX;
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      suppressNextClick = event.type === "pointerup" && dragged;
      dragged = false;
      delete rail.dataset.dragging;
      if (rail.hasPointerCapture?.(event.pointerId)) rail.releasePointerCapture(event.pointerId);
    };
    const onClick = (event: MouseEvent) => {
      const suppress = suppressNextClick && event.detail > 0;
      suppressNextClick = false;
      if (!suppress) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onDragStart = (event: DragEvent) => event.preventDefault();

    rail.addEventListener("pointerdown", onPointerDown);
    rail.addEventListener("pointermove", onPointerMove);
    rail.addEventListener("pointerup", onPointerEnd);
    rail.addEventListener("pointercancel", onPointerEnd);
    rail.addEventListener("click", onClick, true);
    rail.addEventListener("dragstart", onDragStart);
    return () => {
      rail.removeEventListener("pointerdown", onPointerDown);
      rail.removeEventListener("pointermove", onPointerMove);
      rail.removeEventListener("pointerup", onPointerEnd);
      rail.removeEventListener("pointercancel", onPointerEnd);
      rail.removeEventListener("click", onClick, true);
      rail.removeEventListener("dragstart", onDragStart);
    };
  }, []);

  return (
    <div className="relative">
      <div
        aria-label={label}
        className={cn(
          "flex gap-6 overflow-x-auto overscroll-x-contain pb-4 [overflow-anchor:none] [scrollbar-width:none] data-[dragging]:cursor-grabbing data-[dragging]:select-none [&::-webkit-scrollbar]:hidden",
          RAIL_BLEED,
        )}
        ref={railRef}
        role="region"
      >
        {looping && <Slots cards={cards} copy="lead" />}
        <Slots cards={cards} copy="home" />
        {looping && <Slots cards={cards} copy="tail" />}
      </div>
      <div className={RAIL_EDGE_SPAN}>
        <EdgeFade depth="bleed" edges={["left", "right"]} ground="canvas" />
      </div>
    </div>
  );
}
