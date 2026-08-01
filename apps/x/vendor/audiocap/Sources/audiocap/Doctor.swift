import AVFoundation
import CoreAudio
import Foundation

/// Preflight checks, so a permission problem surfaces before a meeting rather than
/// after it. Emitted as JSON for the host to render with remediation links.
enum Doctor {
    struct Check {
        let name: String
        let status: String  // ok | warn | fail
        let detail: String
        let remediation: String?
    }

    static func run(recordingsRoot: URL?, probeSystemAudio: Bool) -> [Check] {
        var checks = [microphone(), systemAudio(probe: probeSystemAudio), inputDevice()]
        if let recordingsRoot { checks.append(writable(recordingsRoot)) }
        return checks
    }

    static func microphone() -> Check {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            return Check(name: "microphone", status: "ok", detail: "granted", remediation: nil)
        case .notDetermined:
            return Check(
                name: "microphone",
                status: "warn",
                detail: "not yet requested — macOS will prompt on first recording",
                remediation: nil
            )
        case .denied, .restricted:
            return Check(
                name: "microphone",
                status: "fail",
                detail: "denied",
                remediation: "System Settings › Privacy & Security › Microphone → enable Oppulence"
            )
        @unknown default:
            return Check(
                name: "microphone", status: "warn", detail: "unknown state", remediation: nil)
        }
    }

    /// There is no side-effect-free way to query the system-audio TCC state: the only
    /// real check is creating a tap, which can fire the permission prompt.
    ///
    /// That makes it unsuitable for a check that runs on its own — opening the meetings
    /// UI should not raise a system dialog. So it only probes when asked, and otherwise
    /// reports honestly that the state is unknown until first use.
    static func systemAudio(probe: Bool) -> Check {
        guard probe else {
            return Check(
                name: "system audio",
                status: "warn",
                detail: "not checked — the state cannot be read without requesting access",
                remediation:
                    "if a recording has no system audio: System Settings › Privacy & Security › Screen & System Audio Recording"
            )
        }

        let description = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        description.name = "Oppulence permission probe"
        description.isPrivate = true
        description.muteBehavior = .unmuted

        var tapID = AudioObjectID(kAudioObjectUnknown)
        let status = AudioHardwareCreateProcessTap(description, &tapID)
        if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }

        guard status == noErr else {
            return Check(
                name: "system audio",
                status: "fail",
                detail: "cannot create a process tap (OSStatus \(status))",
                remediation:
                    "System Settings › Privacy & Security › Screen & System Audio Recording → enable Oppulence"
            )
        }
        return Check(
            name: "system audio", status: "ok", detail: "process tap available", remediation: nil)
    }

    static func inputDevice() -> Check {
        let engine = AVAudioEngine()
        // The input bus is the physical device format. The output bus can reflect a
        // graph default that the microphone cannot actually initialize.
        let format = engine.inputNode.inputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            return Check(
                name: "input device",
                status: "fail",
                detail: "no usable default input device",
                remediation: "System Settings › Sound › Input → choose a microphone"
            )
        }
        return Check(
            name: "input device",
            status: "ok",
            detail: "\(Int(format.sampleRate)) Hz, \(format.channelCount) ch",
            remediation: nil
        )
    }

    static func writable(_ root: URL) -> Check {
        let fm = FileManager.default
        do {
            try fm.createDirectory(at: root, withIntermediateDirectories: true)
        } catch {
            return Check(
                name: "recordings folder",
                status: "fail",
                detail: "cannot create \(root.path)",
                remediation: "check permissions on the parent directory"
            )
        }
        guard fm.isWritableFile(atPath: root.path) else {
            return Check(
                name: "recordings folder",
                status: "fail",
                detail: "\(root.path) is not writable",
                remediation: "check permissions on the directory"
            )
        }
        return Check(
            name: "recordings folder", status: "ok", detail: root.path, remediation: nil)
    }

    static func json(_ checks: [Check]) -> String {
        let payload: [String: Any] = [
            "ok": checks.allSatisfy { $0.status != "fail" },
            "sidecarVersion": audiocapVersion,
            "checks": checks.map { check -> [String: Any] in
                var entry: [String: Any] = [
                    "name": check.name, "status": check.status, "detail": check.detail,
                ]
                if let remediation = check.remediation { entry["remediation"] = remediation }
                return entry
            },
        ]
        guard
            let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
            let text = String(data: data, encoding: .utf8)
        else { return "{\"ok\":false,\"checks\":[]}" }
        return text
    }

    static func human(_ checks: [Check]) -> String {
        checks.map { check in
            let mark = check.status == "ok" ? "✓" : check.status == "warn" ? "!" : "✗"
            let head = "\(mark) \(check.name): \(check.detail)"
            return check.remediation.map { "\(head)\n    → \($0)" } ?? head
        }.joined(separator: "\n")
    }
}
