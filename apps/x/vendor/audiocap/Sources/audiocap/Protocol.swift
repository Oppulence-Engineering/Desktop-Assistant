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
    case level(peaks: [String: Float])
    /// Non-fatal: the session continues, degraded. Recorded into meta.json too.
    case warning(code: String, message: String)
    /// Fatal for the process; the host treats whatever is on disk as salvageable.
    case error(code: String, message: String)
    /// Final event: files are finalized and meta.json is written.
    case stopped(metaPath: String, durationSeconds: Int)
    /// Transcription-model download progress. The Parakeet models are ~600 MB, so the
    /// host needs something to show rather than appearing to hang on first use.
    case modelProgress(fraction: Double, phase: String)

    private var payload: [String: Any] {
        switch self {
        case .started(let tracks, let warnings, let standby):
            return [
                "type": "started", "tracks": tracks, "warnings": warnings, "standby": standby,
            ]
        case .recording(let recoveredSeconds):
            return ["type": "recording", "recoveredSeconds": recoveredSeconds]
        case .level(let peaks):
            return ["type": "level", "peaks": peaks]
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
