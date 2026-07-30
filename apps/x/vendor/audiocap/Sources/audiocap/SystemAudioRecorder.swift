import AVFoundation
import CoreAudio
import Foundation

/// Captures everything the Mac plays — the other side of the call — through a Core
/// Audio process tap (macOS 14.2+). No virtual device, no kernel extension: the tap
/// mixes every process's output to stereo and delivers it through a private
/// aggregate device. First use triggers the one-time "System Audio Recording" TCC
/// prompt and lights the recording indicator while active.
///
/// A global tap is genuinely global: notification sounds and music land in the
/// recording too. That is a product note, not a bug — the UI warns about it.
final class SystemAudioRecorder {
    enum RecorderError: Error, CustomStringConvertible {
        case tapCreationFailed(OSStatus)
        case tapFormatUnreadable(OSStatus)
        case aggregateCreationFailed(OSStatus)
        case ioProcCreationFailed(OSStatus)
        case deviceStartFailed(OSStatus)
        case writerFailed(Error)

        /// Stable machine code so the host can map a failure to a remediation
        /// without string-matching.
        var code: String {
            switch self {
            case .tapCreationFailed: return "system_tap_denied"
            case .tapFormatUnreadable: return "system_tap_format"
            case .aggregateCreationFailed: return "system_aggregate_failed"
            case .ioProcCreationFailed: return "system_ioproc_failed"
            case .deviceStartFailed: return "system_device_start_failed"
            case .writerFailed: return "system_writer_failed"
            }
        }

        var description: String {
            switch self {
            case .tapCreationFailed(let s):
                return
                    "process tap creation failed (OSStatus \(s)) — grant System Settings › Privacy & Security › Screen & System Audio Recording"
            case .tapFormatUnreadable(let s):
                return "could not read tap stream format (OSStatus \(s))"
            case .aggregateCreationFailed(let s):
                return "aggregate device creation failed (OSStatus \(s))"
            case .ioProcCreationFailed(let s): return "IO proc creation failed (OSStatus \(s))"
            case .deviceStartFailed(let s): return "aggregate device start failed (OSStatus \(s))"
            case .writerFailed(let e): return "output file failed: \(e)"
            }
        }
    }

    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private var writer: TrackWriter?
    private let queue = DispatchQueue(label: "co.solomon-ai.audiocap.system-tap")
    private(set) var isRecording = false

    var track: TrackWriter? { writer }

    func start(writingTo url: URL) throws {
        guard !isRecording else { return }

        let description = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        description.name = "Oppulence system audio tap"
        description.isPrivate = true
        // Do not mute what we capture — the user still needs to hear the meeting.
        description.muteBehavior = .unmuted

        var newTapID = AudioObjectID(kAudioObjectUnknown)
        let status = AudioHardwareCreateProcessTap(description, &newTapID)
        guard status == noErr else { throw RecorderError.tapCreationFailed(status) }
        tapID = newTapID

        do {
            let format = try tapStreamFormat()
            try createAggregateDevice(tapUUID: description.uuid)
            do {
                writer = try TrackWriter(url: url, inputFormat: format)
            } catch {
                throw RecorderError.writerFailed(error)
            }
            try installIOProc(format: format)
        } catch {
            cleanup()
            throw error
        }

        isRecording = true
        Log.info("system tap started → \(url.lastPathComponent)")
    }

    /// Stop capture and finalize the file. Idempotent.
    func stop() {
        guard isRecording else { return }
        isRecording = false
        if let procID, aggregateID != kAudioObjectUnknown {
            AudioDeviceStop(aggregateID, procID)
        }
        cleanup()
    }

    // MARK: -

    private func tapStreamFormat() throws -> AVAudioFormat {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var asbd = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        let status = AudioObjectGetPropertyData(tapID, &address, 0, nil, &size, &asbd)
        guard status == noErr, let format = AVAudioFormat(streamDescription: &asbd) else {
            throw RecorderError.tapFormatUnreadable(status)
        }
        return format
    }

    private func createAggregateDevice(tapUUID: UUID) throws {
        let desc: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Oppulence Capture",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            // Private so it never shows up as a selectable device for the user.
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [] as [[String: Any]],
            kAudioAggregateDeviceTapListKey: [
                [
                    kAudioSubTapUIDKey: tapUUID.uuidString,
                    // The tap and the aggregate run off different clocks; without
                    // drift compensation the track slowly desynchronizes from the
                    // mic over a long meeting.
                    kAudioSubTapDriftCompensationKey: true,
                ]
            ],
        ]
        var newAggregateID = AudioObjectID(kAudioObjectUnknown)
        let status = AudioHardwareCreateAggregateDevice(desc as CFDictionary, &newAggregateID)
        guard status == noErr else { throw RecorderError.aggregateCreationFailed(status) }
        aggregateID = newAggregateID
    }

    private func installIOProc(format: AVAudioFormat) throws {
        var status = AudioDeviceCreateIOProcIDWithBlock(&procID, aggregateID, queue) {
            [weak self] _, inInputData, _, _, _ in
            guard let self, let writer = self.writer else { return }
            guard
                let buffer = AVAudioPCMBuffer(
                    pcmFormat: format,
                    bufferListNoCopy: inInputData,
                    deallocator: nil
                )
            else { return }
            writer.append(buffer)
        }
        guard status == noErr, let procID else {
            throw RecorderError.ioProcCreationFailed(status)
        }

        status = AudioDeviceStart(aggregateID, procID)
        guard status == noErr else { throw RecorderError.deviceStartFailed(status) }
    }

    private func cleanup() {
        if let procID, aggregateID != kAudioObjectUnknown {
            AudioDeviceDestroyIOProcID(aggregateID, procID)
        }
        procID = nil
        if aggregateID != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = AudioObjectID(kAudioObjectUnknown)
        }
        if tapID != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = AudioObjectID(kAudioObjectUnknown)
        }
        writer?.finalize()
    }
}
