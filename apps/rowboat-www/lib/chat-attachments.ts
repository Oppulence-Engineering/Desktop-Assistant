export const WEB_CHAT_MAX_FILES = 3;
export const WEB_CHAT_MAX_FILE_BYTES = 256 * 1024;
export const WEB_CHAT_ACCEPT = "text/*,application/json";

type PromptAttachment = {
  filename?: string;
  mediaType?: string;
  url?: string;
};

function textFromDataURL(url: string): string {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 0) {
    throw new Error("Could not read attachment.");
  }
  const metadata = url.slice(5, comma);
  const data = url.slice(comma + 1);
  if (!metadata.endsWith(";base64")) return decodeURIComponent(data);

  const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function prepareWebChatInput(message: {
  text: string;
  files: PromptAttachment[];
}): Promise<{ display: string; input: string }> {
  if (message.files.length > WEB_CHAT_MAX_FILES) {
    throw new Error(`Attach at most ${WEB_CHAT_MAX_FILES} files.`);
  }

  const sections = await Promise.all(
    message.files.map(async (file, index) => {
      if (
        !file.url ||
        !(file.mediaType?.startsWith("text/") || file.mediaType === "application/json")
      ) {
        throw new Error("Web chat currently accepts text and JSON files only.");
      }
      const content = textFromDataURL(file.url);
      if (new TextEncoder().encode(content).length > WEB_CHAT_MAX_FILE_BYTES) {
        throw new Error(`Each attachment must be ${WEB_CHAT_MAX_FILE_BYTES / 1024} KB or smaller.`);
      }
      return `--- Attached file: ${file.filename || `file-${index + 1}`} ---\n${content}`;
    }),
  );

  const text = message.text.trim();
  const names = message.files.map((file, index) => file.filename || `file-${index + 1}`);
  return {
    input: [text, ...sections].filter(Boolean).join("\n\n"),
    display: [text, names.length ? `Attached: ${names.join(", ")}` : ""]
      .filter(Boolean)
      .join("\n\n"),
  };
}
