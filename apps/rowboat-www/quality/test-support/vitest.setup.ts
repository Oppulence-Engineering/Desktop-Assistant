import React, { createElement, type ImgHTMLAttributes } from "react";
import { vi } from "vitest";

// @sim/emcn icons compile with the classic JSX transform and expect React in
// scope. Next supplies that at runtime; Vitest does not unless we hoist it.
globalThis.React = React;

// next/image relies on Next's runtime loader. Component tests only need the
// resulting accessible image contract, so render a native image deterministically.
vi.mock("next/image", () => ({
  default: (
    props: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
      src: string | { src: string };
      fill?: boolean;
      preload?: boolean;
      sizes?: string;
    },
  ) => {
    const { src, ...rest } = props;
    delete rest.fill;
    delete rest.preload;
    delete rest.sizes;
    return createElement("img", { ...rest, src: typeof src === "string" ? src : src.src });
  },
}));
