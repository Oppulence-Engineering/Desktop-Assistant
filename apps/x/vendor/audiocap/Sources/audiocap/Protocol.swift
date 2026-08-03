import Foundation

/// stdout is the machine channel and carries nothing but NDJSON events; stderr is
/// for humans. The host parses stdout line-by-line, so a stray `print()` anywhere
/// in this target would corrupt the stream — log to `Log.info` instead.
enum Event {
    /// Emitted once both recorders have been attached, listing the tracks that
    /// actually started. A track missing here never started; `warnings` says why.
    case started(tracks: [[String: Any]], warnings: [String], standby: Bool)
    /// Standby was promoted to a real recording. `recoveredSeconds` is how much audio
    /// from before the request was kept — the whole point of standing by.
    case recording(recoveredSeconds: Double)
    /// Per-track peak amplitude (0...1) over the last window. Also the liveness
    /// signal: a track reporting 0 for the whole meeting recorded digital silence.
    case level(peaks: [String: Float], frames: [String: Int64])
    /// Non-fatal: the session continues, degraded. Recorded into meta.json too.
    case warning(code: String, message: String)
    /// Fatal for the process; the host treats whatever is on disk as salvageable.
    case error(code: String, message: String)
    /// Final event: files are finalized and meta.json is written.
    case stopped(metaPath: String, durationSeconds: Int)
    /// Transcription-model download progress. The Parakeet models are ~600 MB, so the
    /// host needs something to show rather than appearing to hang on first use.
    case modelProgress(fraction: Double, phase: String)
    /// Modifier-only desktop dictation shortcut transition. The Electron host owns
    /// capture and transcription; this helper only supplies the key-up signal that
    /// Electron's globalShortcut API cannot observe.
    case hotkey(phase: String)
    /// Privacy-bounded focused-app context for local dictation formatting. Password
    /// fields are represented only by `sensitive: true`; their contents never emit.
    case desktopContext(
        appName: String, bundleIdentifier: String?, documentURL: String?, role: String?,
        sensitive: Bool, beforeText: String, selectedText: String, selectedTextLength: Int,
        afterText: String
    )
    /// Persistent Parakeet worker lifecycle and per-utterance responses. Keeping the
    /// Core ML models resident removes their fixed load cost from every dictation.
    case transcriptionReady(engine: String, model: String)
    case transcriptionResult(
        id: String, engine: String, model: String, text: String,
        segments: [TranscriptSegment], durationMs: Double, language: String?
    )
    case transcriptionError(id: String, code: String, message: String)

    private var payload: [String: Any] {
        switch self {
        case .started(let tracks, let warnings, let standby):
            return [
                "type": "started", "tracks": tracks, "warnings": warnings, "standby": standby,
            ]
        case .recording(let recoveredSeconds):
            return ["type": "recording", "recoveredSeconds": recoveredSeconds]
        case .level(let peaks, let frames):
            return ["type": "level", "peaks": peaks, "frames": frames]
        case .warning(let code, let message):
            return ["type": "warning", "code": code, "message": message]
        case .error(let code, let message):
            return ["type": "error", "code": code, "message": message]
        case .stopped(let metaPath, let durationSeconds):
            return [
                "type": "stopped", "metaPath": metaPath, "durationSeconds": durationSeconds,
            ]
        case .modelProgress(let fraction, let phase):
            return ["type": "modelProgress", "fraction": fraction, "phase": phase]
        case .hotkey(let phase):
            return ["type": "hotkey", "phase": phase]
        case .desktopContext(
            let appName, let bundleIdentifier, let documentURL, let role,
            let sensitive, let beforeText, let selectedText, let selectedTextLength, let afterText
        ):
            var value: [String: Any] = [
                "type": "desktopContext", "appName": appName, "sensitive": sensitive,
                "beforeText": beforeText, "selectedText": selectedText, "afterText": afterText,
                "selectedTextLength": selectedTextLength,
            ]
            if let bundleIdentifier { value["bundleIdentifier"] = bundleIdentifier }
            if let documentURL { value["documentURL"] = documentURL }
            if let role { value["role"] = role }
            return value
        case .transcriptionReady(let engine, let model):
            return ["type": "transcriptionReady", "engine": engine, "model": model]
        case .transcriptionResult(
            let id, let engine, let model, let text, let segments, let durationMs, let language
        ):
            var value: [String: Any] = [
                "type": "transcriptionResult", "id": id, "engine": engine, "model": model,
                "text": text,
                "segments": segments.map { ["start": $0.start, "end": $0.end, "text": $0.text] },
                "durationMs": durationMs,
            ]
            if let language { value["language"] = language }
            return value
        case .transcriptionError(let id, let code, let message):
            return ["type": "transcriptionError", "id": id, "code": code, "message": message]
        }
    }

    func emit() {
        Emitter.shared.write(payload)
    }
}

/// Serializes stdout writes — level events originate on a timer while warnings can
/// come off an audio thread, and a torn JSON line is an unparseable line.
private final class Emitter {
    static let shared = Emitter()
    private let lock = NSLock()

    func write(_ payload: [String: Any]) {
        guard
            let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        else { return }
        lock.lock()
        defer { lock.unlock() }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
}

enum Log {
    static func info(_ message: String) {
        FileHandle.standardError.write(Data("audiocap: \(message)\n".utf8))
    }
}

let iso8601: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()
