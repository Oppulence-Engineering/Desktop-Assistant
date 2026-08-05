"use client";

// Replaces the root layout when it crashes, so it must render its own
// html/body. Kept dependency-free: the design system may be part of what
// failed.
export default function GlobalError(props: { error: Error; retry: () => void }) {
  return (
    <html>
      <body>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.75rem",
            padding: "4rem 1rem",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h2>Something went wrong</h2>
          <p>{props.error.message}</p>
          <button onClick={() => props.retry()}>Try again</button>
        </div>
      </body>
    </html>
  );
}
