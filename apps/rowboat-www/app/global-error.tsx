"use client";

/**
 * Root-layout errors replace the entire document. Next.js does not apply
 * app styles here, so the fallback is self-contained (see error.js docs).
 */
export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#111111",
          color: "#f5f5f5",
        }}
      >
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Something went wrong</h1>
          <p style={{ margin: "12px 0 20px", lineHeight: 1.5, opacity: 0.75 }}>
            The page failed to render. Try again, or reload if the problem continues.
          </p>
          <button
            onClick={() => retry()}
            style={{
              appearance: "none",
              border: "1px solid #444",
              background: "#1c1c1c",
              color: "inherit",
              padding: "8px 14px",
              borderRadius: 6,
              cursor: "pointer",
            }}
            type="button"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
