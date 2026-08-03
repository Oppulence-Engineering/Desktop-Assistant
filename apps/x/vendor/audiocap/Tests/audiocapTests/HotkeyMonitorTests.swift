import AppKit
import XCTest

@testable import audiocap

final class HotkeyMonitorTests: XCTestCase {
    func testMatchesEverySupportedShortcutExactly() {
        XCTAssertTrue(HotkeyMonitor.isActive([.control, .option], shortcut: .controlOption))
        XCTAssertTrue(HotkeyMonitor.isActive([.function], shortcut: .fn))
        XCTAssertTrue(HotkeyMonitor.isActive([.control, .function], shortcut: .controlFn))
        XCTAssertTrue(
            HotkeyMonitor.isActive(
                [.command, .control, .option], shortcut: .commandControlOption
            )
        )
    }

    func testRejectsPartialAndExtraModifierChords() {
        XCTAssertFalse(HotkeyMonitor.isActive([.control], shortcut: .controlOption))
        XCTAssertFalse(HotkeyMonitor.isActive([.control, .option, .shift], shortcut: .controlOption))
        XCTAssertFalse(HotkeyMonitor.isActive([.function, .option], shortcut: .fn))
        XCTAssertFalse(HotkeyMonitor.isActive([.control, .function, .command], shortcut: .controlFn))
        XCTAssertFalse(
            HotkeyMonitor.isActive([.control, .option], shortcut: .commandControlOption)
        )
    }

    func testLabelsStayHumanReadable() {
        XCTAssertEqual(HotkeyShortcut.controlOption.label, "Control + Option")
        XCTAssertEqual(HotkeyShortcut.fn.label, "Fn")
        XCTAssertEqual(HotkeyShortcut.controlFn.label, "Control + Fn")
        XCTAssertEqual(
            HotkeyShortcut.commandControlOption.label, "Command + Control + Option"
        )
    }

    func testHandsFreeToggleRequiresSpaceAndTheExactConfiguredChord() {
        XCTAssertTrue(
            HotkeyMonitor.isHandsFreeToggle(
                keyCode: 49, isRepeat: false, flags: [.control, .option], shortcut: .controlOption
            )
        )
        XCTAssertTrue(
            HotkeyMonitor.isHandsFreeToggle(
                keyCode: 49, isRepeat: false, flags: [.function], shortcut: .fn
            )
        )
        XCTAssertFalse(
            HotkeyMonitor.isHandsFreeToggle(
                keyCode: 49, isRepeat: true, flags: [.control, .option], shortcut: .controlOption
            )
        )
        XCTAssertFalse(
            HotkeyMonitor.isHandsFreeToggle(
                keyCode: 36, isRepeat: false, flags: [.control, .option], shortcut: .controlOption
            )
        )
        XCTAssertFalse(
            HotkeyMonitor.isHandsFreeToggle(
                keyCode: 49, isRepeat: false, flags: [.control], shortcut: .controlOption
            )
        )
    }
}
