import { createElement, type ImgHTMLAttributes } from "react";
import { vi } from "vitest";

// next/image relies on Next's runtime loader. Component tests only need the
// resulting accessible image contract, so render a native image deterministically.
vi.mock("next/image", () => ({
  default: ({
    src,
    ...props
  }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
    src: string | { src: string };
  }) => createElement("img", { ...props, src: typeof src === "string" ? src : src.src }),
}));
