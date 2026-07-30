import AVFoundation
import Foundation

/// Compressing retained meeting audio, and decoding it back for re-transcription.
///
/// Capture writes uncompressed 16 kHz WAV because that is what makes a killed process
/// lose nothing and what the transcriber consumes directly. That is ~115 MB per hour
/// per track, which is fine while a session is being transcribed and wasteful if you
/// keep recordings. So compression happens *after* transcription, only for sessions
/// that are being kept: AAC in an .m4a container, roughly an eighth of the size and
/// playable in the app's audio viewer.
///
/// Decoding lives here too, because compressing away the WAV would otherwise cost the
/// ability to re-transcribe — which is the main reason to keep audio at all. Nothing
/// else in the repo can decode AAC.
enum Codec {
    enum CodecError: Error, CustomStringConvertible {
        case unreadable(URL, String)
        case unwritable(URL, String)
        case conversionFailed(String)

        var code: String {
            switch self {
            case .unreadable: return "codec_unreadable_input"
            case .unwritable: return "codec_unwritable_output"
            case .conversionFailed: return "codec_conversion_failed"
            }
        }

        var description: String {
            switch self {
            case .unreadable(let url, let detail):
                return "cannot read \(url.lastPathComponent): \(detail)"
            case .unwritable(let url, let detail):
                return "cannot write \(url.lastPathComponent): \(detail)"
            case .conversionFailed(let detail): return "conversion failed: \(detail)"
            }
        }
    }

    /// Speech at 16 kHz mono. 32 kbps is transparent enough for listening back to a
    /// meeting and lands around 14 MB/hour against the WAV's 115 MB.
    static let bitRate = 32_000

    static func compress(input: URL, output: URL) throws {
        try convert(
            input: input,
            output: output,
            settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: TrackWriter.sampleRate,
                AVNumberOfChannelsKey: Int(TrackWriter.channels),
                AVEncoderBitRateKey: bitRate,
            ])
    }

    /// Back to exactly what capture produced, so the transcription path cannot tell
    /// the difference between a fresh session and a re-transcribed one.
    static func decode(input: URL, output: URL) throws {
        try convert(
            input: input,
            output: output,
            settings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: TrackWriter.sampleRate,
                AVNumberOfChannelsKey: Int(TrackWriter.channels),
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsNonInterleaved: false,
            ])
    }

    // MARK: -

    private static func convert(input: URL, output: URL, settings: [String: Any]) throws {
        let source: AVAudioFile
        do {
            source = try AVAudioFile(forReading: input)
        } catch {
            throw CodecError.unreadable(input, "\(error)")
        }
        guard source.length > 0 else { throw CodecError.unreadable(input, "no frames") }

        let destination: AVAudioFile
        do {
            // Written directly, not via a temp file: the caller only deletes the source
            // once this returns successfully, and it removes a partial output on failure,
            // so a half-written file is never mistaken for a finished one.
            destination = try AVAudioFile(forWriting: output, settings: settings)
        } catch {
            throw CodecError.unwritable(output, "\(error)")
        }

        let readFormat = source.processingFormat
        guard
            let converter = AVAudioConverter(from: readFormat, to: destination.processingFormat),
            let inputBuffer = AVAudioPCMBuffer(pcmFormat: readFormat, frameCapacity: 16384)
        else {
            throw CodecError.conversionFailed("no converter for \(readFormat)")
        }

        let ratio = destination.processingFormat.sampleRate / readFormat.sampleRate
        // Bounded by the source length rather than reading until EOF: reading past the
        // end throws an opaque `nilError` *after* the conversion has already completed
        // successfully, which would look like a failure and silently disable
        // compression while the output file sat there, correct, next to it.
        var remaining = source.length
        while remaining > 0 {
            let wanted = AVAudioFrameCount(min(Int64(inputBuffer.frameCapacity), remaining))
            try source.read(into: inputBuffer, frameCount: wanted)
            if inputBuffer.frameLength == 0 { break }
            remaining -= Int64(inputBuffer.frameLength)

            let capacity = AVAudioFrameCount(Double(inputBuffer.frameLength) * ratio) + 1024
            guard
                let outputBuffer = AVAudioPCMBuffer(
                    pcmFormat: destination.processingFormat, frameCapacity: capacity)
            else { throw CodecError.conversionFailed("output buffer allocation failed") }

            var supplied = false
            var conversionError: NSError?
            let status = converter.convert(to: outputBuffer, error: &conversionError) {
                _, outStatus in
                if supplied {
                    outStatus.pointee = .noDataNow
                    return nil
                }
                supplied = true
                outStatus.pointee = .haveData
                return inputBuffer
            }
            if status == .error {
                throw CodecError.conversionFailed(conversionError?.description ?? "unknown")
            }
            if outputBuffer.frameLength > 0 {
                try destination.write(from: outputBuffer)
            }
        }
    }
}
