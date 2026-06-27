import React, { useMemo } from "react";
import { processTerminalOutput, spanStyleToCSS } from "../lib/terminal-output";

// Cap the parser input to the tail of very long streams so each re-parse stays
// bounded (the parser is O(n) per call, so re-parsing the full buffer on every
// streamed chunk is O(n^2)). Older scrollback past the cap is dropped, but the
// cap is generous enough that normal command output is unaffected. // ... (ERRORS.md E38)
const MAX_PARSE_CHARS = 200_000;

export function TerminalOutput({ raw }: { raw: string }) {
  const lines = useMemo(() => {
    const capped = raw.length > MAX_PARSE_CHARS ? raw.slice(raw.length - MAX_PARSE_CHARS) : raw;
    return processTerminalOutput(capped);
  }, [raw]);

  return (
    <>
      {lines.map((line, lineIdx) => (
        <React.Fragment key={lineIdx}>
          {lineIdx > 0 && "\n"}
          {line.spans.map((span, spanIdx) => {
            const css = spanStyleToCSS(span.style);
            return css ? (
              <span key={spanIdx} style={css}>
                {span.text}
              </span>
            ) : (
              <React.Fragment key={spanIdx}>{span.text}</React.Fragment>
            );
          })}
        </React.Fragment>
      ))}
    </>
  );
}
