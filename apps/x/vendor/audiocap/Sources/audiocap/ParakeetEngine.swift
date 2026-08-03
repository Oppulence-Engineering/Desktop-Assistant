import AVFoundation
import FluidAudio
import Foundation

/// Parakeet TDT 0.6B via FluidAudio's Core ML port — the fast transcription engine.
///
/// Roughly an order of magnitude faster than whisper.cpp on the same machine (tens of
/// seconds per hour of audio rather than minutes), because the models run on the Neural
/// Engine. The trade is a one-time ~600 MB model download, which is why the host treats
/// this as opt-in and keeps whisper as the default and the fallback.
///
/// v3 is the default and is multilingual (28 European languages); v2 is English-only
/// with slightly higher recall on English. The host picks.
enum ParakeetEngine {
    static let engineName = "parakeet"

    enum EngineError: Error, CustomStringConvertible {
        case unreadableAudio(URL, String)
        case modelsUnavailable(String)

        var code: String {
            switch self {
            case .unreadableAudio: return "parakeet_unreadable_audio"
            case .modelsUnavailable: return "parakeet_models_unavailable"
            }
        }

        var description: String {
            switch self {
            case .unreadableAudio(let url, let detail):
                return "unreadable or empty audio \(url.lastPathComponent): \(detail)"
            case .modelsUnavailable(let detail):
                return "parakeet models unavailable: \(detail)"
            }
        }
    }

    static func version(named name: String) -> AsrModelVersion {
        // v2 is English-only; anything else gets the multilingual default.
        name == "v2" ? .v2 : .v3
    }

    static func modelName(for version: AsrModelVersion) -> String {
        version == .v2 ? "parakeet-tdt-0.6b-v2-coreml" : "parakeet-tdt-0.6b-v3-coreml"
    }

    /// True when the models are already on disk, so the host can tell "will transcribe
    /// now" from "will download 600 MB first" *before* a meeting rather than after.
    static func modelsReady(version: AsrModelVersion) -> Bool {
        let cache = AsrModels.defaultCacheDirectory(for: version)
        return AsrModels.modelsExist(at: cache, version: version)
    }

    /// Download the models if absent, reporting progress as NDJSON so the host can show
    /// it. Safe to call when they already exist — it becomes a no-op load.
    static func prepare(version: AsrModelVersion, emitProgress: Bool) async throws -> AsrModels {
        // Built as a typed local rather than inline: a ternary between a closure
        // literal and `nil` gives the closure no contextual type, and the type checker
        // gives up on the whole call with "failed to produce diagnostic".
        var handler: ProgressHandler?
        if emitProgress {
            handler = { progress in
                Event.modelProgress(
                    fraction: progress.fractionCompleted,
                    phase: "\(progress.phase)"
                ).emit()
            }
        }

        do {
            return try await AsrModels.downloadAndLoad(version: version, progressHandler: handler)
        } catch {
            throw EngineError.modelsUnavailable("\(error)")
        }
    }

    /// Transcribe one audio file into timed segments.
    ///
    /// `language` is a hint for the multilingual model; nil lets it decide.
    static func transcribe(
        _ audio: URL,
        version: AsrModelVersion,
        language: String?,
        emitProgress: Bool
    ) async throws -> [TranscriptSegment] {
        let models = try await prepare(version: version, emitProgress: emitProgress)
        let manager = AsrManager()
        try await manager.loadModels(models)
        defer { Task { await manager.cleanup() } }
        return try await transcribeLoaded(audio, manager: manager, language: language)
    }

    /// Transcribe with models that are already resident. Used by the persistent
    /// desktop-dictation worker so only actual inference is on the release-to-paste path.
    static func transcribeLoaded(
        _ audio: URL,
        manager: AsrManager,
        language: String?
    ) async throws -> [TranscriptSegment] {
        // An empty or truncated file makes AVFoundation raise an Objective-C exception
        // deep inside the resampler, which Swift cannot catch — it would take the whole
        // process down. Check readability up front instead.
        let audioDuration: TimeInterval
        do {
            let probe = try AVAudioFile(forReading: audio)
            guard probe.length > 0 else {
                throw EngineError.unreadableAudio(audio, "no frames")
            }
            // Measured here rather than taken from the result: on the file path
            // `ASRResult.duration` comes back as 0, which would make the no-timings
            // fallback emit a zero-length segment.
            audioDuration = Double(probe.length) / probe.processingFormat.sampleRate
        } catch let error as EngineError {
            throw error
        } catch {
            throw EngineError.unreadableAudio(audio, "\(error)")
        }

        var state = try TdtDecoderState()
        let result = try await manager.transcribe(
            audio,
            decoderState: &state,
            language: language.flatMap(Language.init(rawValue:))
        )

        let timings = result.tokenTimings ?? []
        let words = wordTimings(from: timings)
        Log.info(
            "parakeet: \(timings.count) token timings → \(words.count) words over \(String(format: "%.1f", audioDuration))s"
        )
        guard !words.isEmpty else {
            // No timings (short clip, or a model build without them): fall back to one
            // segment spanning the file rather than dropping the text.
            let text = result.text.trimmingCharacters(in: .whitespacesAndNewlines)
            return text.isEmpty
                ? []
                : [TranscriptSegment(start: 0, end: audioDuration, text: text)]
        }
        return segments(from: words)
    }

    // MARK: -

    struct Word {
        let text: String
        let start: TimeInterval
        let end: TimeInterval
    }

    /// Parakeet emits sub-word tokens (`[ L] [eg] [al] [ st] [ill]`); joining them back
    /// into words is what makes the segment timings meaningful.
    ///
    /// Two conventions exist for marking a word boundary: the SentencePiece U+2581
    /// marker, and a literal leading space. v3 uses the latter, and handling only the
    /// former silently concatenates a whole meeting into one "word" — which still
    /// produces a readable transcript, just with every timestamp wrong, so it is worth
    /// accepting both.
    static func wordTimings(from timings: [TokenTiming]) -> [Word] {
        var words: [Word] = []
        var startNext = true
        for timing in timings {
            let normalized = timing.token.replacingOccurrences(of: "\u{2581}", with: " ")
            if normalized.hasPrefix(" ") { startNext = true }
            let text = normalized.trimmingCharacters(in: .whitespaces)
            // A whitespace-only token carries the boundary but no letters; remember the
            // boundary rather than dropping it along with the token.
            if text.isEmpty { continue }

            if startNext || words.isEmpty {
                words.append(Word(text: text, start: timing.startTime, end: timing.endTime))
                startNext = false
            } else {
                let last = words.removeLast()
                words.append(Word(text: last.text + text, start: last.start, end: timing.endTime))
            }
        }
        return words
    }

    /// Group words into readable segments: break on sentence-ending punctuation, on a
    /// silence gap, or at a hard word cap so a run-on speaker still wraps.
    static func segments(from words: [Word]) -> [TranscriptSegment] {
        var out: [TranscriptSegment] = []
        var current: [Word] = []

        func flush() {
            guard let first = current.first, let last = current.last else { return }
            out.append(
                TranscriptSegment(
                    start: first.start,
                    end: last.end,
                    text: current.map(\.text).joined(separator: " ")
                ))
            current = []
        }

        for word in words {
            if let last = current.last, word.start - last.end > 1.0 { flush() }
            current.append(word)
            let endsSentence =
                word.text.hasSuffix(".") || word.text.hasSuffix("?") || word.text.hasSuffix("!")
            if endsSentence || current.count >= 60 { flush() }
        }
        flush()
        return out
    }
}

/// One timed piece of transcript, in seconds — the shape the host consumes.
struct TranscriptSegment: Encodable {
    let start: TimeInterval
    let end: TimeInterval
    let text: String
}
