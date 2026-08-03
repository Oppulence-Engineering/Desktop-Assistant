import AppKit
import Foundation

enum HotkeyShortcut: String, CaseIterable {
    case controlOption = "control-option"
    case fn = "fn"
    case controlFn = "control-fn"
    case commandControlOption = "command-control-option"

    var flags: NSEvent.ModifierFlags {
        switch self {
        case .controlOption: [.control, .option]
        case .fn: [.function]
        case .controlFn: [.control, .function]
        case .commandControlOption: [.command, .control, .option]
        }
    }

    var label: String {
        switch self {
        case .controlOption: "Control + Option"
        case .fn: "Fn"
        case .controlFn: "Control + Fn"
        case .commandControlOption: "Command + Control + Option"
        }
    }
}

/// Watches a configurable modifier-only desktop dictation chord.
///
/// Electron can register accelerators that end in a normal key, but it cannot tell
/// when a user releases a pair of modifier keys. `flagsChanged` gives us both edges,
/// which makes "hold Control + Option to talk" feel like a microphone button instead
/// of a mode the user can accidentally leave running.
final class HotkeyMonitor {
    private static let relevantFlags: NSEvent.ModifierFlags = [
        .control, .option, .command, .shift, .function,
    ]
    private let shortcut: HotkeyShortcut
    private var pressed = false
    private var globalMonitor: Any?
    private var localMonitor: Any?

    init(shortcut: HotkeyShortcut) {
        self.shortcut = shortcut
    }

    static func isActive(_ flags: NSEvent.ModifierFlags, shortcut: HotkeyShortcut) -> Bool {
        flags.intersection(relevantFlags) == shortcut.flags
    }

    static func isHandsFreeToggle(
        keyCode: UInt16,
        isRepeat: Bool,
        flags: NSEvent.ModifierFlags,
        shortcut: HotkeyShortcut
    ) -> Bool {
        keyCode == 49 && !isRepeat && isActive(flags, shortcut: shortcut)
    }

    func run() -> Never {
        let mask: NSEvent.EventTypeMask = [.flagsChanged, .keyDown]
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: mask) {
            [weak self] event in
            self?.handle(event)
        }
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: mask) {
            [weak self] event in
            self?.handle(event)
            return event
        }

        guard globalMonitor != nil else {
            Event.error(
                code: "hotkey_monitor_unavailable",
                message:
                    "macOS did not allow global keyboard monitoring — enable Oppulence in Privacy & Security > Input Monitoring"
            ).emit()
            exit(1)
        }

        Event.hotkey(phase: "ready").emit()

        // Stop with stdin EOF or an explicit line from the Electron parent.
        DispatchQueue.global(qos: .utility).async {
            while let line = readLine(strippingNewline: true) {
                if line.trimmingCharacters(in: .whitespacesAndNewlines) == "stop" {
                    exit(0)
                }
            }
            exit(0)
        }

        RunLoop.main.run()
        exit(0)
    }

    private func handle(_ event: NSEvent) {
        if event.type == .keyDown {
            // Space (virtual key 49) plus the selected modifier chord toggles
            // hands-free mode. Repeats are ignored so holding Space cannot stop
            // a session immediately after starting it.
            if Self.isHandsFreeToggle(
                keyCode: event.keyCode,
                isRepeat: event.isARepeat,
                flags: event.modifierFlags,
                shortcut: shortcut
            ) {
                Event.hotkey(phase: "hands-free-toggle").emit()
            }
            return
        }

        let active = Self.isActive(event.modifierFlags, shortcut: shortcut)
        guard active != pressed else { return }
        pressed = active
        Event.hotkey(phase: active ? "pressed" : "released").emit()
    }
}
