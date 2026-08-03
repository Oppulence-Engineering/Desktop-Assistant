import FluidAudio
import Foundation
import NaturalLanguage

/// NDJSON request consumed by the persistent local dictation worker.
private struct ParakeetServerRequest: Decodable {
    let id: String
    let audioPath: String
    let language: String?
}

enum ParakeetServer {
    private static let supportedLanguages = Set(Language.allCases.map(\.rawValue))

    private static func resolvedLanguage(requested: String?, text: String) -> String? {
        if let requested, requested != "auto", supportedLanguages.contains(requested) {
            return requested
        }
        guard
            !text.isEmpty,
            let detected = NLLanguageRecognizer.dominantLanguage(for: text)?.rawValue,
            supportedLanguages.contains(detected)
        else { return nil }
        return detected
    }

    static func run(version: AsrModelVersion) async -> Int32 {
        let manager = AsrManager()
        do {
            let models = try await ParakeetEngine.prepare(version: version, emitProgress: false)
            try await manager.loadModels(models)
        } catch let error as ParakeetEngine.EngineError {
            Event.error(code: error.code, message: error.description).emit()
            return 1
        } catch {
            Event.error(code: "parakeet_server_unavailable", message: "\(error)").emit()
            return 1
        }

        Event.transcriptionReady(
            engine: ParakeetEngine.engineName,
            model: ParakeetEngine.modelName(for: version)
        ).emit()

        while let line = readLine(strippingNewline: true) {
            if line == "stop" { break }
            guard let data = line.data(using: .utf8) else { continue }

            let request: ParakeetServerRequest
            do {
                request = try JSONDecoder().decode(ParakeetServerRequest.self, from: data)
            } catch {
                Event.transcriptionError(
                    id: "", code: "invalid_request", message: "Invalid transcription request"
                ).emit()
                continue
            }

            let startedAt = ContinuousClock.now
            do {
                let segments = try await ParakeetEngine.transcribeLoaded(
                    expand(request.audioPath), manager: manager, language: request.language
                )
                let elapsed = startedAt.duration(to: .now)
                let durationMs = Double(elapsed.components.seconds) * 1_000
                    + Double(elapsed.components.attoseconds) / 1e15
                let text = segments.map(\.text).joined(separator: " ").trimmingCharacters(
                    in: .whitespacesAndNewlines)
                let language = resolvedLanguage(requested: request.language, text: text)
                Event.transcriptionResult(
                    id: request.id,
                    engine: ParakeetEngine.engineName,
                    model: ParakeetEngine.modelName(for: version),
                    text: text,
                    segments: segments,
                    durationMs: durationMs,
                    language: language
                ).emit()
            } catch let error as ParakeetEngine.EngineError {
                Event.transcriptionError(
                    id: request.id, code: error.code, message: error.description
                ).emit()
            } catch {
                Event.transcriptionError(
                    id: request.id, code: "parakeet_failed", message: "\(error)"
                ).emit()
            }
        }

        await manager.cleanup()
        return 0
    }
}
