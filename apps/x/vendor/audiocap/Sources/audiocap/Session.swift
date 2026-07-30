import AVFoundation
import Foundation

/// One recording: two independent tracks in one directory, plus a `meta.json`
/// written on stop.
///
/// The tracks stay separate on purpose. mic-vs-system is free two-party
/// attribution — `me` versus `them` with no speaker-identification model — and
/// single-source audio transcribes better than a mix. It also means a person talking
/// over the other party is preserved on both tracks instead of one being gated out.
///
/// The host owns the directory name; this only fills it in.
final class Session {
    struct Track {
        let id: String
        let speaker: String
        let file: String
        let writer: TrackWriter
        let voiceProcessing: Bool
        let fellBackToRaw: Bool
    }

    let dir: URL
    /// The time the retained audio begins. Set at construction, then moved *backwards*
    /// when a standby buffer is flushed — the session genuinely started before the user
    /// pressed record, and `duration_seconds` and the note's timestamp must say so.
    private(set) var startedAt = Date()
    private(set) var standing = false
    private let mic = MicRecorder()
    private let system = SystemAudioRecorder()
    private var warnings: [String] = []
    private var levelTimer: DispatchSourceTimer?

    init(dir: URL) throws {
        self.dir = dir
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    /// Start both tracks. Either may fail on its own — a denied system-audio grant
    /// should still record your own voice, and a broken input device should still
    /// capture the meeting. Only losing *both* is fatal.
    /// `standbySeconds > 0` captures into memory and writes nothing until
    /// `beginRecording()` — see `TrackWriter`.
    func start(voiceProcessing: Bool, standbySeconds: Double = 0) throws {
        standing = standbySeconds > 0
        do {
            try system.start(
                writingTo: dir.appendingPathComponent("system.wav"),
                standbySeconds: standbySeconds
            )
        } catch let error as SystemAudioRecorder.RecorderError {
            record(warning: error.code, message: error.description)
        }
        do {
            try mic.start(
                writingTo: dir.appendingPathComponent("mic.wav"),
                voiceProcessing: voiceProcessing,
                standbySeconds: standbySeconds
            )
        } catch let error as MicRecorder.RecorderError {
            record(warning: error.code, message: error.description)
        }

        guard !tracks.isEmpty else {
            system.stop()
            mic.stop()
            throw SessionError.noTracks(warnings)
        }

        Event.started(
            tracks: tracks.map {
                ["id": $0.id, "speaker": $0.speaker, "file": $0.file]
            },
            warnings: warnings,
            standby: standing
        ).emit()
        startLevelTimer()
    }

    /// Promote a standby session to a real recording, keeping whatever the buffers hold.
    ///
    /// Every track flushes its own ring, so they can hold different amounts — the system
    /// tap may have opened later than the mic. The session start moves back by the
    /// *largest* of them, which is the earliest moment any retained audio exists.
    func beginRecording() {
        guard standing else { return }
        standing = false
        var recovered: Double = 0
        for track in tracks {
            do {
                recovered = max(recovered, try track.writer.beginRecording())
            } catch {
                record(warning: "standby_flush_failed", message: "\(error)")
            }
        }
        if recovered > 0 {
            startedAt = Date().addingTimeInterval(-recovered)
        }
        Event.recording(recoveredSeconds: recovered).emit()
    }

    /// Stop both tracks, finalize their headers, and write meta.json. Idempotent.
    func stop() {
        levelTimer?.cancel()
        levelTimer = nil
        // Never promoted: the buffers are dropped, no file was ever created, and there
        // is no session to report. Writing a meta.json here would leave the host a
        // zero-length recording to transcribe and show.
        if standing {
            mic.stop()
            system.stop()
            try? FileManager.default.removeItem(at: dir)
            Event.stopped(metaPath: "", durationSeconds: 0).emit()
            return
        }
        // Snapshot the tracks before stopping: finalize() is what makes the headers
        // valid, and the summaries have to be read from the same writers.
        let live = tracks
        mic.stop()
        system.stop()

        let ended = Date()
        let metaPath = writeMeta(tracks: live, ended: ended)
        Event.stopped(
            metaPath: metaPath.path,
            durationSeconds: Int(ended.timeIntervalSince(startedAt))
        ).emit()
    }

    // MARK: -

    enum SessionError: Error, CustomStringConvertible {
        case noTracks([String])

        var description: String {
            switch self {
            case .noTracks(let warnings):
                return
                    "no audio source could be opened — \(warnings.isEmpty ? "unknown cause" : warnings.joined(separator: "; "))"
            }
        }
    }

    private var tracks: [Track] {
        var out: [Track] = []
        if let writer = mic.track {
            out.append(
                Track(
                    id: "mic",
                    speaker: "me",
                    file: writer.url.lastPathComponent,
                    writer: writer,
                    voiceProcessing: mic.usedVoiceProcessing,
                    fellBackToRaw: mic.didFallBackToRaw
                ))
        }
        if let writer = system.track {
            out.append(
                Track(
                    id: "system",
                    speaker: "them",
                    file: writer.url.lastPathComponent,
                    writer: writer,
                    voiceProcessing: false,
                    fellBackToRaw: false
                ))
        }
        return out
    }

    private func record(warning code: String, message: String) {
        warnings.append("\(code): \(message)")
        Event.warning(code: code, message: message).emit()
    }

    /// Peaks every 200 ms. Doubles as proof of life: a track that reports 0 for a
    /// whole meeting recorded digital silence, which the host can surface while there
    /// is still time to fix it rather than after the meeting.
    private func startLevelTimer() {
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + .milliseconds(200), repeating: .milliseconds(200))
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            var peaks: [String: Float] = [:]
            for track in self.tracks { peaks[track.id] = track.writer.takePeak() }
            guard !peaks.isEmpty else { return }
            Event.level(peaks: peaks).emit()
        }
        timer.resume()
        levelTimer = timer
    }

    private func writeMeta(tracks: [Track], ended: Date) -> URL {
        // Tracks do not receive their first buffer at the same instant. Record how far
        // each one lags the earliest so both transcripts can be shifted onto one clock.
        let firstBuffers = tracks.compactMap { $0.writer.summary.firstBufferAt }
        let earliest = firstBuffers.min() ?? startedAt

        let trackMeta: [[String: Any]] = tracks.map { track in
            let summary = track.writer.summary
            let started = summary.firstBufferAt ?? earliest
            var entry: [String: Any] = [
                "id": track.id,
                "speaker": track.speaker,
                "file": track.file,
                "offset_ms": Int(started.timeIntervalSince(earliest) * 1000),
                "frames": summary.frames,
                "duration_ms": Int(Double(summary.frames) / TrackWriter.sampleRate * 1000),
                // A track that never saw a non-zero sample is the failure mode worth
                // naming explicitly: correct duration, no signal.
                "peak": summary.peak,
                "silent": summary.peak == 0,
            ]
            if track.id == "mic" {
                entry["voice_processing"] = track.voiceProcessing
                entry["voice_processing_fell_back"] = track.fellBackToRaw
            }
            return entry
        }

        let meta: [String: Any] = [
            "schema": 1,
            "sidecar_version": audiocapVersion,
            "started": iso8601.string(from: startedAt),
            "ended": iso8601.string(from: ended),
            "duration_seconds": Int(ended.timeIntervalSince(startedAt)),
            "audio": [
                "sample_rate": Int(TrackWriter.sampleRate),
                "channels": Int(TrackWriter.channels),
                "encoding": "pcm_s16le",
                "container": "wav",
            ],
            "tracks": trackMeta,
            "warnings": warnings,
        ]

        let url = dir.appendingPathComponent("meta.json")
        if let data = try? JSONSerialization.data(
            withJSONObject: meta,
            options: [.prettyPrinted, .sortedKeys]
        ) {
            // meta.json is the host's "this session finished cleanly" marker, so it is
            // written last and atomically — a half-written one would make the queue
            // treat an in-progress session as complete.
            try? data.write(to: url, options: .atomic)
        }
        return url
    }
}
