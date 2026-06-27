import { useCallback, useRef, useState } from "react";

export type TTSState = "idle" | "synthesizing" | "speaking";

interface SynthesizedAudio {
  dataUrl: string;
}

function synthesize(text: string): Promise<SynthesizedAudio> {
  return window.ipc
    .invoke("voice:synthesize", { text })
    .then((result: { audioBase64: string; mimeType: string }) => ({
      dataUrl: `data:${result.mimeType};base64,${result.audioBase64}`,
    }));
}

function playAudio(
  dataUrl: string,
  audioRef: React.MutableRefObject<HTMLAudioElement | null>,
  // ... (ERRORS.md E62) cancel() pauses the audio, which fires neither
  // onended nor onerror — so expose the resolver here, letting cancel settle
  // this promise and unwind the awaiting processQueue loop instead of leaking it.
  pendingResolveRef: React.MutableRefObject<(() => void) | null>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const audio = new Audio(dataUrl);
    audioRef.current = audio;
    pendingResolveRef.current = resolve;
    audio.onended = () => {
      console.log("[tts] audio ended");
      pendingResolveRef.current = null;
      resolve();
    };
    audio.onerror = (e) => {
      console.error("[tts] audio error:", e);
      pendingResolveRef.current = null;
      reject(new Error("Audio playback failed"));
    };
    audio
      .play()
      .then(() => {
        console.log("[tts] audio playing");
      })
      .catch((err) => {
        console.error("[tts] play() rejected:", err);
        pendingResolveRef.current = null;
        reject(err);
      });
  });
}

export function useVoiceTTS() {
  const [state, setState] = useState<TTSState>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]);
  const processingRef = useRef(false);
  // Pre-fetched audio ready to play immediately
  const prefetchedRef = useRef<Promise<SynthesizedAudio> | null>(null);
  // ... (ERRORS.md E62) Resolver for the in-flight playAudio promise so
  // cancel() can settle it; generation guard so a cancelled (or superseded)
  // loop unwinds without stomping the state of a fresh speak() run.
  const pendingResolveRef = useRef<(() => void) | null>(null);
  const generationRef = useRef(0);

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    const generation = ++generationRef.current;

    while (queueRef.current.length > 0) {
      const text = queueRef.current.shift()!;
      if (!text.trim()) continue;

      try {
        // Use pre-fetched result if available, otherwise synthesize now
        let audioPromise: Promise<SynthesizedAudio>;
        if (prefetchedRef.current) {
          console.log("[tts] using pre-fetched audio");
          audioPromise = prefetchedRef.current;
          prefetchedRef.current = null;
        } else {
          setState("synthesizing");
          console.log("[tts] synthesizing:", text.substring(0, 80));
          audioPromise = synthesize(text);
        }

        const audio = await audioPromise;
        if (generationRef.current !== generation) return;
        setState("speaking");

        // Kick off pre-fetch for next chunk while this one plays
        const nextText = queueRef.current[0];
        if (nextText?.trim()) {
          console.log("[tts] pre-fetching next:", nextText.substring(0, 80));
          prefetchedRef.current = synthesize(nextText);
        }

        await playAudio(audio.dataUrl, audioRef, pendingResolveRef);
      } catch (err) {
        console.error("[tts] error:", err);
        prefetchedRef.current = null;
      }
      // ... (ERRORS.md E62) Bail if cancel()/a newer run superseded us —
      // the owner of the current generation handles the reset.
      if (generationRef.current !== generation) return;
    }

    audioRef.current = null;
    prefetchedRef.current = null;
    processingRef.current = false;
    setState("idle");
  }, []);

  const speak = useCallback(
    (text: string) => {
      console.log("[tts] speak() called:", text.substring(0, 80));
      queueRef.current.push(text);
      processQueue();
    },
    [processQueue],
  );

  const cancel = useCallback(() => {
    // ... (ERRORS.md E62) Invalidate the running loop so its post-await
    // checks bail out instead of resetting a subsequent speak()'s state.
    generationRef.current++;
    queueRef.current = [];
    prefetchedRef.current = null;
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    // Settle the pending playAudio promise so the awaiting loop unwinds
    // (pause() fires neither onended nor onerror).
    if (pendingResolveRef.current) {
      pendingResolveRef.current();
      pendingResolveRef.current = null;
    }
    processingRef.current = false;
    setState("idle");
  }, []);

  return { state, speak, cancel };
}
