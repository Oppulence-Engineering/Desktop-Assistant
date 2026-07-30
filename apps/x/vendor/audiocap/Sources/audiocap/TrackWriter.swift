import AVFoundation
import Foundation

/// Streams one capture source to a 16 kHz mono 16-bit WAV, converting on the way in.
///
/// Why this shape:
///  - **16 kHz mono** is what whisper.cpp consumes natively, so the host needs no
///    decoder — and there is none in the repo. Keeping a higher-fidelity archive
///    would buy nothing for re-transcription, since whisper resamples to 16 kHz
///    regardless.
///  - **Raw PCM appended to a pre-written header** means a killed process still
///    leaves every sample it wrote on disk. The two size fields in the header are
///    the only thing a crash loses, and `recoverWavHeader` on the host side rebuilds
///    them from the file length. This is the same "crash mid-meeting loses nothing"
///    property CAF gives, without an AAC decode step later.
///  - Writing from the audio callback is not strictly realtime-safe, but the buffers
///    are 4 KB and the target is a local file; the alternative (a ring buffer plus a
///    writer thread) adds a failure mode — dropped audio under memory pressure —
///    that is worse than an occasional long write.
final class TrackWriter {
    enum WriterError: Error, CustomStringConvertible {
        case cannotCreateFile(URL)
        case unsupportedFormat(AVAudioFormat)

        var description: String {
            switch self {
            case .cannotCreateFile(let url): return "cannot create \(url.lastPathComponent)"
            case .unsupportedFormat(let f): return "cannot convert from \(f)"
            }
        }
    }

    static let sampleRate: Double = 16000
    static let channels: UInt32 = 1
    static let bitsPerSample: UInt16 = 16
    private static let headerBytes = 44

    let url: URL
    private var handle: FileHandle?
    private let converter: AVAudioConverter
    private let outFormat: AVAudioFormat
    /// Guards the counters and the file handle between the audio thread and the
    /// main-thread `finalize()` / `takePeak()` calls.
    private let lock = NSLock()
    private var frames: Int64 = 0
    private var closed = false
    private var overallPeak: Float = 0
    private var windowPeak: Float = 0
    private var firstBuffer: Date?

    /// Standby holds converted audio in memory and writes nothing. Promoting to
    /// recording flushes what is held and continues straight to the file.
    ///
    /// This is what makes "start recording" able to include the thirty seconds before
    /// the click — the half of a call where someone says the thing you needed. The
    /// buffer lives here rather than in front of the recorders because by this point
    /// the audio is already converted to exactly what gets written, so a flush is a
    /// single contiguous copy and the recording path stays identical either way.
    private var standby: RingBuffer?
    private(set) var recording: Bool

    init(url: URL, inputFormat: AVAudioFormat, standbySeconds: Double = 0) throws {
        guard
            let outFormat = AVAudioFormat(
                commonFormat: .pcmFormatInt16,
                sampleRate: Self.sampleRate,
                channels: AVAudioChannelCount(Self.channels),
                interleaved: true
            ),
            let converter = AVAudioConverter(from: inputFormat, to: outFormat)
        else { throw WriterError.unsupportedFormat(inputFormat) }

        self.url = url
        self.outFormat = outFormat
        self.converter = converter
        self.recording = standbySeconds <= 0

        if standbySeconds > 0 {
            // Nothing touches the disk yet. A microphone that is live but writing
            // nothing is only defensible if it is genuinely writing nothing, and an
            // empty file appearing at standby time would make that unverifiable.
            self.standby = RingBuffer(capacity: Int(Self.sampleRate * standbySeconds))
        } else {
            try openFile()
        }
    }

    /// Create the file and lay down a zero-length header. Split out of `init` because
    /// standby defers it until the user actually asks to record.
    private func openFile() throws {
        let fm = FileManager.default
        // 0600: meeting audio is as sensitive as the transcript it becomes.
        guard
            fm.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600]),
            let opened = FileHandle(forWritingAtPath: url.path)
        else { throw WriterError.cannotCreateFile(url) }
        self.handle = opened
        opened.write(Self.wavHeader(dataBytes: 0))
    }

    /// Promote from standby: open the file, flush everything held, and keep going.
    /// Returns the seconds of audio recovered from before the call. Idempotent.
    func beginRecording() throws -> Double {
        lock.lock()
        defer { lock.unlock() }
        guard !closed, !recording else { return 0 }

        try openFile()
        let buffered = standby?.drain() ?? []
        standby = nil
        recording = true

        guard !buffered.isEmpty else { return 0 }
        buffered.withUnsafeBufferPointer { pointer in
            guard let base = pointer.baseAddress else { return }
            handle?.write(Data(bytes: base, count: pointer.count * 2))
        }
        frames = Int64(buffered.count)
        let seconds = Double(buffered.count) / Self.sampleRate
        // The retained audio starts where the ring starts, not where standby did —
        // anything older than the ring was overwritten. Backdating this is what keeps
        // `offset_ms` and the transcript clock honest about a retroactive recording.
        firstBuffer = Date().addingTimeInterval(-seconds)
        return seconds
    }

    /// Convert and append one captured buffer. Safe to call from an audio thread.
    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        defer { lock.unlock() }
        guard !closed else { return }
        if firstBuffer == nil { firstBuffer = Date() }
        guard buffer.frameLength > 0 else { return }

        // Rate conversion changes the frame count, so the block-based API is
        // required; `convert(to:from:)` only handles same-rate conversions. The
        // converter carries resampler state, hence one per track, touched only here.
        let ratio = Self.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: capacity) else {
            return
        }

        var supplied = false
        var conversionError: NSError?
        let status = converter.convert(to: out, error: &conversionError) { _, outStatus in
            if supplied {
                outStatus.pointee = .noDataNow
                return nil
            }
            supplied = true
            outStatus.pointee = .haveData
            return buffer
        }
        if status == .error {
            Log.info("\(url.lastPathComponent): convert failed: \(conversionError?.description ?? "unknown")")
            return
        }
        guard out.frameLength > 0, let samples = out.int16ChannelData?[0] else { return }

        let count = Int(out.frameLength)
        var peak: Float = 0
        for i in 0..<count {
            let magnitude = abs(Float(samples[i])) / 32768
            if magnitude > peak { peak = magnitude }
        }
        if peak > overallPeak { overallPeak = peak }
        if peak > windowPeak { windowPeak = peak }

        // Levels are still reported while standing by — the host has to be able to show
        // that the buffer is live, not merely claim it.
        if let ring = standby {
            ring.write(samples, count: count)
            return
        }

        handle?.write(Data(bytes: samples, count: count * 2))
        frames += Int64(count)
    }

    /// Peak since the last call — the level meter wants a decaying window, not a
    /// high-water mark that never comes back down.
    func takePeak() -> Float {
        lock.lock()
        defer { lock.unlock() }
        let peak = windowPeak
        windowPeak = 0
        return peak
    }

    /// Patch the header's two size fields and close. Idempotent.
    func finalize() {
        lock.lock()
        defer { lock.unlock() }
        guard !closed else { return }
        closed = true
        // Stopped while still standing by: the buffer is dropped and no file was ever
        // created. Discarding audio the user never asked to keep is the point.
        standby = nil
        guard let handle else { return }
        let dataBytes = frames * Int64(Self.channels) * 2
        // Rewrite the whole 44-byte header rather than seeking to the two size
        // fields separately — one write, no chance of a half-patched header.
        try? handle.seek(toOffset: 0)
        handle.write(Self.wavHeader(dataBytes: dataBytes))
        try? handle.close()
    }

    var summary: (frames: Int64, peak: Float, firstBufferAt: Date?) {
        lock.lock()
        defer { lock.unlock() }
        return (frames, overallPeak, firstBuffer)
    }

    // MARK: -

    private static func wavHeader(dataBytes: Int64) -> Data {
        let byteRate = UInt32(sampleRate) * channels * UInt32(bitsPerSample / 8)
        let blockAlign = UInt16(channels * UInt32(bitsPerSample / 8))
        var data = Data(capacity: headerBytes)

        func u32(_ value: UInt32) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
        func u16(_ value: UInt16) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
        func ascii(_ value: String) { data.append(contentsOf: Array(value.utf8)) }

        ascii("RIFF")
        u32(UInt32(clamping: 36 + dataBytes))
        ascii("WAVE")
        ascii("fmt ")
        u32(16)
        u16(1)  // PCM
        u16(UInt16(channels))
        u32(UInt32(sampleRate))
        u32(byteRate)
        u16(blockAlign)
        u16(bitsPerSample)
        ascii("data")
        u32(UInt32(clamping: dataBytes))
        return data
    }
}
