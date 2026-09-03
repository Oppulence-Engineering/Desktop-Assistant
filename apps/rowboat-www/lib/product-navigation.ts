export type ProductView = "chat" | "settings" | "revenue" | "workflows" | "agents";

export const PRODUCT_VIEW_PATHS: Record<ProductView, string> = {
  chat: "/app",
  agents: "/app/agents",
  workflows: "/app/workflows",
  revenue: "/app/revenue",
  settings: "/app/settings",
};

export function productViewForPathname(pathname: string): ProductView {
  return (
    (Object.entries(PRODUCT_VIEW_PATHS).find(
      ([view, path]) => view !== "chat" && pathname.startsWith(path),
    )?.[0] as ProductView | undefined) ?? "chat"
  );
}
