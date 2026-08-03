import XCTest

@testable import audiocap

final class DesktopContextTests: XCTestCase {
    func testSensitiveHintsCoverPasswordAndSecretControls() {
        XCTAssertTrue(DesktopContext.isSensitiveHint("AXSecureTextField"))
        XCTAssertTrue(DesktopContext.isSensitiveHint("Enter your password"))
        XCTAssertTrue(DesktopContext.isSensitiveHint("API token"))
        XCTAssertFalse(DesktopContext.isSensitiveHint("Message body"))
    }

    func testNearbyTextIsBoundedAroundTheSelection() {
        let value = String(repeating: "a", count: 300) + String(repeating: "b", count: 20)
            + String(repeating: "c", count: 300)
        let context = DesktopContext.boundedText(value, selection: CFRange(location: 300, length: 20))

        XCTAssertEqual((context.before as NSString).length, 256)
        XCTAssertEqual(context.selected, String(repeating: "b", count: 20))
        XCTAssertEqual(context.selectedLength, 20)
        XCTAssertEqual((context.after as NSString).length, 256)
        XCTAssertEqual(context.before, String(repeating: "a", count: 256))
        XCTAssertEqual(context.after, String(repeating: "c", count: 256))
    }

    func testSelectedTextIsAlsoCapped() {
        let context = DesktopContext.boundedText(
            String(repeating: "x", count: 9_000),
            selection: CFRange(location: 0, length: 9_000)
        )
        XCTAssertEqual((context.selected as NSString).length, 8_000)
        XCTAssertEqual(context.selectedLength, 9_000)
        XCTAssertEqual(context.before, "")
        XCTAssertEqual(context.after, "")
    }
}
