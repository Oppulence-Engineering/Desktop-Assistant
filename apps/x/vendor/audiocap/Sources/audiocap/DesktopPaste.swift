import CoreGraphics
import Foundation

/// Sends Command+V without activating Oppulence.
///
/// Electron owns the clipboard contents; this native helper only posts the key
/// events to the app that stayed focused while dictation was running. Keeping this
/// out of AppleScript avoids an additional Automation permission prompt.
enum DesktopPaste {
    private static func postKey(_ virtualKey: CGKeyCode, flags: CGEventFlags = []) -> Bool {
        guard
            let source = CGEventSource(stateID: .hidSystemState),
            let keyDown = CGEvent(keyboardEventSource: source, virtualKey: virtualKey, keyDown: true),
            let keyUp = CGEvent(keyboardEventSource: source, virtualKey: virtualKey, keyDown: false)
        else {
            return false
        }

        keyDown.flags = flags
        keyUp.flags = flags
        keyDown.post(tap: .cghidEventTap)
        usleep(12_000)
        keyUp.post(tap: .cghidEventTap)
        return true
    }

    static func run(paste: Bool = true, pressEnter: Bool = false) -> Never {
        if paste && !postKey(9, flags: .maskCommand) {
            Event.error(
                code: "paste_event_unavailable",
                message: "Could not create the desktop paste keyboard event"
            ).emit()
            exit(1)
        }
        if pressEnter {
            if paste { usleep(35_000) }
            guard postKey(36) else {
                Event.error(
                    code: "enter_event_unavailable",
                    message: "Could not create the desktop Enter keyboard event"
                ).emit()
                exit(1)
            }
        }
        exit(0)
    }
}
