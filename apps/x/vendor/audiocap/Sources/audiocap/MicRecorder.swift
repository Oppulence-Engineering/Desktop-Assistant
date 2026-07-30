import AVFoundation
import Foundation

/// Captures the default input device — your side of the call — through an
/// `AVAudioEngine` input tap.
///
/// Two paths:
///
///  - **raw** (default): tap at the device's native format and let `TrackWriter`
///    downmix and resample. On headphones there is no echo to cancel, so this is the
///    better capture.
///  - **voice processing**: Apple's echo canceller subtracts speaker playback from
///    the mic, so meeting audio coming out of the speakers is not transcribed twice
///    — once as them, once as you.
///
/// `VoiceProcessingIO` is a duplex unit, not an input effect. Enabling it and then
/// accepting `inputNode.outputFormat(forBus:)` as the client format is the classic
/// mistake: on a multichannel route that inherited format can be 9 channels, and the
/// unit delivers buffers of digital zeros — a file with correct duration and no
/// signal. The graph has to be completed explicitly: enable while stopped, choose
/// one mono client format, connect `mainMixerNode → outputNode` with it, and install
/// the tap with the same format. Even then some routes stay silent, so the first
/// second is checked for signal and capture restarts raw if it is flat.
final class MicRecorder {
    enum RecorderError: Error, CustomStringConvertible {
        case engineStartFailed(Error)
        case formatUnsupported(AVAudioFormat)
        case writerFailed(Error)

        var code: String {
            switch self {
            case .engineStartFailed: return "mic_engine_start_failed"
            case .formatUnsupported: return "mic_format_unsupported"
            case .writerFailed: return "mic_writer_failed"
            }
        }

        var description: String {
            switch self {
            case .engineStartFailed(let e):
                return
                    "mic engine start failed: \(e) — check System Settings › Privacy & Security › Microphone"
            case .formatUnsupported(let f): return "unsupported mic format \(f)"
            case .writerFailed(let e): return "output file failed: \(e)"
            }
        }
    }

    private var engine = AVAudioEngine()
    private var writer: TrackWriter?
    private var url: URL?
    private(set) var isRecording = false
    private(set) var usedVoiceProcessing = false
    /// True once we fell back, so meta.json can record that the AEC path failed here.
    private(set) var didFallBackToRaw = false

    /// Liveness state for the voice-processing path. Written from the tap callback,
    /// read on main when deciding to fall back.
    private var livenessFrames = 0
    private var livenessPeak: Float = 0
    private var livenessSettled = false

    var track: TrackWriter? { writer }

    /// Held rather than passed to `attach` because the raw-fallback path builds a second
    /// writer, and that one has to stand by too — falling back mid-standby must not
    /// quietly start writing to disk.
    private var standbySeconds: Double = 0

    func start(writingTo url: URL, voiceProcessing: Bool, standbySeconds: Double = 0) throws {
        guard !isRecording else { return }
        self.url = url
        self.standbySeconds = standbySeconds
        try attach(voiceProcessing: voiceProcessing)
        isRecording = true
    }

    /// Stop capture and finalize the file. Idempotent.
    func stop() {
        guard isRecording else { return }
        isRecording = false
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        writer?.finalize()
    }

    // MARK: -

    /// Build the graph, open the file, start capture. Called once at start and again
    /// with `voiceProcessing: false` if the liveness check trips.
    private func attach(voiceProcessing: Bool) throws {
        guard let url else { throw RecorderError.formatUnsupported(AVAudioFormat()) }
        engine = AVAudioEngine()
        let input = engine.inputNode

        var voice = voiceProcessing
        if voice {
            do {
                try input.setVoiceProcessingEnabled(true)
                // A live voice unit makes macOS treat the session like a call and duck
                // all other audio — meeting playback would drop in volume the moment
                // recording starts. `.min` is as low as this goes; it cannot be zeroed.
                input.voiceProcessingOtherAudioDuckingConfiguration = .init(
                    enableAdvancedDucking: false,
                    duckingLevel: .min
                )
            } catch {
                Event.warning(
                    code: "mic_voice_processing_unavailable",
                    message: "echo cancellation unavailable (\(error)) — recording raw mic"
                ).emit()
                voice = false
            }
        }

        let deviceFormat = input.outputFormat(forBus: 0)
        // One explicit mono client format. With voice processing this is the Voice I/O
        // boundary format on both sides of the duplex unit; never inherit the route's
        // channel count here. Speech models want one channel anyway.
        guard
            let monoFormat = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: deviceFormat.sampleRate,
                channels: 1,
                interleaved: false
            )
        else { throw RecorderError.formatUnsupported(deviceFormat) }

        let tapFormat = voice ? monoFormat : deviceFormat
        let trackWriter: TrackWriter
        do {
            trackWriter = try TrackWriter(
                url: url, inputFormat: tapFormat, standbySeconds: standbySeconds)
        } catch {
            throw RecorderError.writerFailed(error)
        }
        writer = trackWriter

        if voice {
            // Complete the duplex graph: VoiceProcessingIO must render to an output
            // device or the input side never produces audio. The mixer has no sources
            // — nothing is monitored or played back — the connection exists only to
            // give the unit a formatted output path.
            engine.connect(engine.mainMixerNode, to: engine.outputNode, format: monoFormat)
            livenessFrames = 0
            livenessPeak = 0
            livenessSettled = false
        }
        // The tap captures its writer rather than reading `self.writer`: the fallback
        // path swaps that property from the main thread while the audio thread is
        // reading it. A callback still in flight then writes to the old writer, which is
        // already finalized and ignores it, instead of racing on the reference.
        installTap(on: input, format: tapFormat, writer: trackWriter, checkLiveness: voice)

        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            writer?.finalize()
            writer = nil
            throw RecorderError.engineStartFailed(error)
        }

        usedVoiceProcessing = voice
        Log.info(
            "mic started → \(url.lastPathComponent) voiceProcessing=\(input.isVoiceProcessingEnabled) tap=\(tapFormat)"
        )
    }

    private func installTap(
        on input: AVAudioInputNode,
        format: AVAudioFormat,
        writer: TrackWriter,
        checkLiveness: Bool
    ) {
        let checkFrames = Int(format.sampleRate)  // one second
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            guard let self else { return }

            if checkLiveness && !self.livenessSettled {
                let frames = Int(buffer.frameLength)
                if let data = buffer.floatChannelData?[0] {
                    for i in 0..<frames {
                        self.livenessPeak = max(self.livenessPeak, abs(data[i]))
                    }
                }
                self.livenessFrames += frames
                if self.livenessFrames >= checkFrames {
                    self.livenessSettled = true
                    if self.livenessPeak == 0 {
                        DispatchQueue.main.async { self.fallBackToRaw() }
                        return
                    }
                }
            }

            writer.append(buffer)
        }
    }

    /// The voice-processing route delivered a full second of digital silence. Tear the
    /// engine down and restart raw, discarding the silent prefix so the track's
    /// timestamps begin at real audio.
    private func fallBackToRaw() {
        guard isRecording else { return }
        Event.warning(
            code: "mic_voice_processing_silent",
            message: "echo cancellation produced silence on this route — restarted mic raw"
        ).emit()
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        writer?.finalize()
        writer = nil
        if let url { try? FileManager.default.removeItem(at: url) }
        didFallBackToRaw = true
        do {
            try attach(voiceProcessing: false)
        } catch {
            Event.warning(
                code: "mic_raw_fallback_failed",
                message: "\(error) — session continues without a microphone track"
            ).emit()
            writer = nil
        }
    }
}
