import AVFoundation
import Foundation

/// Bumped by hand; mirrored into meta.json and `doctor` output so a transcript can
/// always be traced back to the capture code that produced it.
let audiocapVersion = "0.1.0"

let usage = """
    oppulence-audiocap \(audiocapVersion) — local dual-track meeting capture (macOS 14.2+)

    USAGE
      audiocap record --out <session-dir> [--voice-processing]
      audiocap doctor [--json] [--out <recordings-root>]
      audiocap --version

    record
      Captures the default input device to mic.wav and all system audio to
      system.wav (16 kHz mono 16-bit PCM), then writes meta.json on stop.
      Emits NDJSON events on stdout; logs to stderr. Stop with the line "stop"
      on stdin, or SIGTERM/SIGINT.

    doctor
      Reports microphone and system-audio permission state plus the default input
      device. --json for machine output. Creating the probe tap can trigger the
      one-time System Audio Recording prompt.
    """

// MARK: - Argument parsing

/// Hand-rolled rather than pulling in ArgumentParser: two subcommands and three
/// flags is not worth a dependency, a Package.resolved, or a CI fetch step.
struct Args {
    var command: String?
    var out: String?
    var json = false
    var voiceProcessing = false
    var version = false
    var help = false

    init(_ argv: [String]) {
        var rest = argv
        if let first = rest.first, !first.hasPrefix("-") {
            command = first
            rest.removeFirst()
        }
        var index = 0
        while index < rest.count {
            switch rest[index] {
            case "--out", "-o":
                index += 1
                if index < rest.count { out = rest[index] }
            case "--json":
                json = true
            case "--voice-processing":
                voiceProcessing = true
            case "--version", "-v":
                version = true
            case "--help", "-h":
                help = true
            default:
                Log.info("ignoring unknown argument \(rest[index])")
            }
            index += 1
        }
    }
}

func expand(_ path: String) -> URL {
    if path == "~" { return URL(fileURLWithPath: NSHomeDirectory()) }
    if path.hasPrefix("~/") {
        return URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(
            String(path.dropFirst(2)))
    }
    return URL(fileURLWithPath: (path as NSString).expandingTildeInPath).standardizedFileURL
}

let args = Args(Array(CommandLine.arguments.dropFirst()))

if args.help {
    print(usage)
    exit(0)
}
if args.version {
    print(audiocapVersion)
    exit(0)
}

// MARK: - doctor

if args.command == "doctor" {
    let checks = Doctor.run(recordingsRoot: args.out.map(expand))
    print(args.json ? Doctor.json(checks) : Doctor.human(checks))
    exit(checks.allSatisfy { $0.status != "fail" } ? 0 : 1)
}

// MARK: - record

guard args.command == nil || args.command == "record" else {
    Log.info("unknown command \(args.command ?? "")")
    print(usage)
    exit(64)
}

guard let outPath = args.out else {
    Log.info("--out <session-dir> is required")
    print(usage)
    exit(64)
}

let session: Session
do {
    session = try Session(dir: expand(outPath))
    try session.start(voiceProcessing: args.voiceProcessing)
} catch {
    let code = (error as? Session.SessionError) != nil ? "no_audio_source" : "session_start_failed"
    Event.error(code: code, message: "\(error)").emit()
    exit(1)
}

/// Stop is idempotent, but two stops racing (SIGTERM while stdin's "stop" is being
/// handled) would emit two `stopped` events, so gate on a flag hopped to main.
var stopping = false
func stopAndExit() {
    guard !stopping else { return }
    stopping = true
    session.stop()
    exit(0)
}

// SIGTERM is how Electron asks us to finish on app quit; both must finalize the
// headers rather than dying, or the last write is a file the host has to repair.
// The sources have to outlive this loop or they are cancelled on deinit.
var signalSources: [DispatchSourceSignal] = []
for sig in [SIGTERM, SIGINT] {
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler { stopAndExit() }
    source.resume()
    signal(sig, SIG_IGN)
    // Keep the source alive for the process lifetime.
    signalSources.append(source)
}

// stdin is the primary control channel — a parent that dies takes the pipe with it,
// which lands here as EOF and stops the session rather than leaking a recorder.
DispatchQueue.global(qos: .utility).async {
    while let line = readLine(strippingNewline: true) {
        switch line.trimmingCharacters(in: .whitespaces) {
        case "stop":
            DispatchQueue.main.async { stopAndExit() }
            return
        case "":
            continue
        default:
            Log.info("unknown stdin command: \(line)")
        }
    }
    // EOF: the host is gone.
    DispatchQueue.main.async { stopAndExit() }
}

dispatchMain()
