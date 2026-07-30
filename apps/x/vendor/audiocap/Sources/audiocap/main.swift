import AVFoundation
import FluidAudio
import Foundation

/// Bumped by hand; mirrored into meta.json and `doctor` output so a transcript can
/// always be traced back to the capture code that produced it.
let audiocapVersion = "0.1.0"

let usage = """
    oppulence-audiocap \(audiocapVersion) — local meeting capture + transcription (macOS 14.2+)

    USAGE
      audiocap record     --out <session-dir> [--voice-processing]
      audiocap doctor     [--json] [--out <recordings-root>]
      audiocap transcribe --in <audio> [--model v3|v2] [--language en] [--json]
      audiocap models     [--ensure] [--model v3|v2] [--json]
      audiocap compress   --in <wav> --out <m4a>
      audiocap decode     --in <m4a> --out <wav>
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

    transcribe
      Parakeet (Core ML) transcription of one audio file to timed segments as JSON.
      Roughly ten times faster than whisper.cpp. Downloads ~600 MB of models on
      first use — run `models --ensure` ahead of time to avoid that mid-meeting.

    models
      Whether the transcription models are present; --ensure downloads them,
      reporting NDJSON progress.

    compress / decode
      AAC round-trip for retained recordings: ~1/8 the size, still playable, and
      decodable back to exactly what capture produced so re-transcription works.
    """

// MARK: - Argument parsing

/// Hand-rolled rather than pulling in ArgumentParser. A handful of subcommands with
/// no interdependent options does not need a parsing library, and the smaller the
/// dependency list the less there is to resolve at build time.
struct Args {
    var command: String?
    var out: String?
    var input: String?
    var model = "v3"
    var language: String?
    var json = false
    var voiceProcessing = false
    var ensure = false
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
            case "--in", "-i":
                index += 1
                if index < rest.count { input = rest[index] }
            case "--model":
                index += 1
                if index < rest.count { model = rest[index] }
            case "--language":
                index += 1
                if index < rest.count { language = rest[index] }
            case "--json":
                json = true
            case "--ensure":
                ensure = true
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

/// Run an async operation from the top level and exit with its outcome. The CLI
/// subcommands are one-shot, so there is nothing to keep a run loop alive for.
func runAsync(_ body: @escaping () async -> Int32) -> Never {
    let group = DispatchGroup()
    group.enter()
    var code: Int32 = 0
    Task {
        code = await body()
        group.leave()
    }
    group.wait()
    exit(code)
}

func emitFailure(_ code: String, _ message: String) -> Int32 {
    Event.error(code: code, message: message).emit()
    return 1
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

// MARK: - transcribe / models / compress / decode

if args.command == "transcribe" {
    guard let inPath = args.input else {
        Log.info("--in <audio> is required")
        exit(64)
    }
    let version = ParakeetEngine.version(named: args.model)
    runAsync {
        do {
            let segments = try await ParakeetEngine.transcribe(
                expand(inPath),
                version: version,
                language: args.language,
                // Progress only matters to a host reading the stream; a human running
                // this by hand gets the stderr log instead.
                emitProgress: args.json
            )
            let payload: [String: Any] = [
                "engine": ParakeetEngine.engineName,
                "model": ParakeetEngine.modelName(for: version),
                "segments": segments.map { ["start": $0.start, "end": $0.end, "text": $0.text] },
            ]
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data("\n".utf8))
            return 0
        } catch let error as ParakeetEngine.EngineError {
            return emitFailure(error.code, error.description)
        } catch {
            return emitFailure("parakeet_failed", "\(error)")
        }
    }
}

if args.command == "models" {
    let version = ParakeetEngine.version(named: args.model)
    runAsync {
        if args.ensure {
            do {
                _ = try await ParakeetEngine.prepare(version: version, emitProgress: true)
            } catch let error as ParakeetEngine.EngineError {
                return emitFailure(error.code, error.description)
            } catch {
                return emitFailure("parakeet_models_unavailable", "\(error)")
            }
        }
        let ready = ParakeetEngine.modelsReady(version: version)
        let payload: [String: Any] = [
            "ready": ready,
            "model": ParakeetEngine.modelName(for: version),
            "cacheDir": AsrModels.defaultCacheDirectory(for: version).path,
        ]
        if args.json,
            let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
            let text = String(data: data, encoding: .utf8)
        {
            print(text)
        } else {
            print(ready ? "models ready" : "models not downloaded (~600 MB on first use)")
        }
        return ready ? 0 : 1
    }
}

if args.command == "compress" || args.command == "decode" {
    guard let inPath = args.input, let outPath = args.out else {
        Log.info("--in <file> and --out <file> are both required")
        exit(64)
    }
    do {
        if args.command == "compress" {
            try Codec.compress(input: expand(inPath), output: expand(outPath))
        } else {
            try Codec.decode(input: expand(inPath), output: expand(outPath))
        }
        exit(0)
    } catch let error as Codec.CodecError {
        exit(emitFailure(error.code, error.description))
    } catch {
        exit(emitFailure("codec_failed", "\(error)"))
    }
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
