import FluidAudio
import XCTest

@testable import audiocap

/// Turning Parakeet's sub-word tokens into timed words and segments.
///
/// Worth testing precisely because getting it wrong is invisible: a broken word
/// splitter still produces a perfectly readable transcript, just with every timestamp
/// collapsed onto one span — which then silently destroys the interleaving of the two
/// capture tracks. That is exactly the bug this guards.
final class ParakeetSegmentationTests: XCTestCase {
    private func timing(_ token: String, _ start: Double, _ end: Double) -> TokenTiming {
        TokenTiming(token: token, tokenId: 0, startTime: start, endTime: end, confidence: 1)
    }

    func testLeadingSpaceTokens() {
        // What parakeet-tdt-0.6b-v3 actually emits.
        let words = ParakeetEngine.wordTimings(from: [
            timing(" L", 0.0, 0.1),
            timing("eg", 0.1, 0.2),
            timing("al", 0.2, 0.3),
            timing(" st", 0.3, 0.4),
            timing("ill", 0.4, 0.5),
        ])

        XCTAssertEqual(words.map(\.text), ["Legal", "still"])
        XCTAssertEqual(words[0].start, 0.0, accuracy: 0.001)
        XCTAssertEqual(words[0].end, 0.3, accuracy: 0.001)
        XCTAssertEqual(words[1].start, 0.3, accuracy: 0.001)
    }

    func testSentencePieceTokens() {
        let words = ParakeetEngine.wordTimings(from: [
            timing("\u{2581}Le", 0.0, 0.1),
            timing("gal", 0.1, 0.2),
            timing("\u{2581}still", 0.2, 0.3),
        ])
        XCTAssertEqual(words.map(\.text), ["Legal", "still"])
    }

    func testWhitespaceToken() {
        let words = ParakeetEngine.wordTimings(from: [
            timing("one", 0.0, 0.1),
            timing(" ", 0.1, 0.11),
            timing("two", 0.11, 0.2),
        ])
        XCTAssertEqual(words.map(\.text), ["one", "two"])
    }

    func testEmptyTimings() {
        XCTAssertTrue(ParakeetEngine.wordTimings(from: []).isEmpty)
    }

    func testSentenceBreak() {
        let segments = ParakeetEngine.segments(from: [
            ParakeetEngine.Word(text: "Hello", start: 0, end: 0.5),
            ParakeetEngine.Word(text: "there.", start: 0.5, end: 1.0),
            ParakeetEngine.Word(text: "Next", start: 1.1, end: 1.5),
        ])
        XCTAssertEqual(segments.count, 2)
        XCTAssertEqual(segments[0].text, "Hello there.")
        XCTAssertEqual(segments[0].end, 1.0, accuracy: 0.001)
        XCTAssertEqual(segments[1].text, "Next")
    }

    func testSilenceBreak() {
        // A pause longer than a second is a turn boundary, not a run-on sentence.
        let segments = ParakeetEngine.segments(from: [
            ParakeetEngine.Word(text: "before", start: 0, end: 0.5),
            ParakeetEngine.Word(text: "after", start: 3.0, end: 3.5),
        ])
        XCTAssertEqual(segments.map(\.text), ["before", "after"])
    }

    func testRunOnWraps() {
        // No punctuation and no pauses must still produce more than one segment.
        let words = (0..<130).map {
            ParakeetEngine.Word(text: "word", start: Double($0) * 0.1, end: Double($0) * 0.1 + 0.05)
        }
        XCTAssertEqual(ParakeetEngine.segments(from: words).count, 3)
    }
}
