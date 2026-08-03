import AppKit
import ApplicationServices
import Foundation

/// Reads only the context needed for local casing/spacing decisions.
///
/// This intentionally does not walk the whole accessibility tree or capture a
/// screenshot. The focused control is read once, bounded around its selection,
/// and password-like controls are excluded before their value is inspected.
enum DesktopContext {
    private static let nearbyLimit = 256
    private static let selectedLimit = 8_000

    private static func attribute(_ element: AXUIElement, _ name: CFString) -> AnyObject? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name, &value) == .success else {
            return nil
        }
        return value
    }

    private static func stringAttribute(_ element: AXUIElement, _ name: CFString) -> String? {
        if let value = attribute(element, name) as? String { return value }
        if let value = attribute(element, name) as? URL { return value.absoluteString }
        return nil
    }

    private static func selectionRange(_ element: AXUIElement) -> CFRange? {
        guard let raw = attribute(element, kAXSelectedTextRangeAttribute as CFString) else {
            return nil
        }
        guard CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
        let value = unsafeBitCast(raw, to: AXValue.self)
        guard AXValueGetType(value) == .cfRange else { return nil }
        var range = CFRange()
        return AXValueGetValue(value, .cfRange, &range) ? range : nil
    }

    private static func parent(_ element: AXUIElement) -> AXUIElement? {
        guard let raw = attribute(element, kAXParentAttribute as CFString) else { return nil }
        guard CFGetTypeID(raw) == AXUIElementGetTypeID() else { return nil }
        return unsafeBitCast(raw, to: AXUIElement.self)
    }

    private static func documentURL(from element: AXUIElement) -> String? {
        var current: AXUIElement? = element
        for _ in 0..<8 {
            guard let node = current else { break }
            if let url = stringAttribute(node, kAXURLAttribute as CFString), !url.isEmpty {
                return url
            }
            if let document = stringAttribute(node, kAXDocumentAttribute as CFString),
                !document.isEmpty
            {
                return document
            }
            current = parent(node)
        }
        return nil
    }

    private static func isSensitive(_ element: AXUIElement, role: String?, subrole: String?) -> Bool {
        let attributes: [CFString] = [
            kAXTitleAttribute as CFString,
            kAXDescriptionAttribute as CFString,
            kAXHelpAttribute as CFString,
            kAXIdentifierAttribute as CFString,
            kAXPlaceholderValueAttribute as CFString,
        ]
        let hints = ([role, subrole] + attributes.map { stringAttribute(element, $0) })
            .compactMap { $0 }
            .joined(separator: " ")
            .lowercased()
        return isSensitiveHint(hints)
    }

    static func isSensitiveHint(_ hints: String) -> Bool {
        let hints = hints.lowercased()
        return hints.contains("secure") || hints.contains("password")
            || hints.contains("passcode") || hints.contains("secret")
            || hints.contains("access token") || hints.contains("api token")
    }

    static func boundedText(
        _ value: String, selection: CFRange
    ) -> (before: String, selected: String, selectedLength: Int, after: String) {
        let text = value as NSString
        let location = max(0, min(selection.location, text.length))
        let length = max(0, min(selection.length, text.length - location))
        let beforeStart = max(0, location - nearbyLimit)
        let afterStart = location + length
        let before = text.substring(with: NSRange(location: beforeStart, length: location - beforeStart))
        let selected = text.substring(
            with: NSRange(location: location, length: min(length, selectedLimit)))
        let after = text.substring(
            with: NSRange(location: afterStart, length: min(nearbyLimit, text.length - afterStart)))
        return (before, selected, length, after)
    }

    static func run(appOnly: Bool) -> Never {
        let application = NSWorkspace.shared.frontmostApplication
        let appName = application?.localizedName ?? "Unknown app"
        let bundleIdentifier = application?.bundleIdentifier

        guard AXIsProcessTrusted() else {
            Event.desktopContext(
                appName: appName, bundleIdentifier: bundleIdentifier, documentURL: nil, role: nil,
                sensitive: false, beforeText: "", selectedText: "", selectedTextLength: 0,
                afterText: ""
            ).emit()
            exit(0)
        }

        let system = AXUIElementCreateSystemWide()
        guard
            let rawFocused = attribute(system, kAXFocusedUIElementAttribute as CFString),
            CFGetTypeID(rawFocused) == AXUIElementGetTypeID()
        else {
            Event.desktopContext(
                appName: appName, bundleIdentifier: bundleIdentifier, documentURL: nil, role: nil,
                sensitive: false, beforeText: "", selectedText: "", selectedTextLength: 0,
                afterText: ""
            ).emit()
            exit(0)
        }

        let focused = unsafeBitCast(rawFocused, to: AXUIElement.self)
        let role = stringAttribute(focused, kAXRoleAttribute as CFString)
        let subrole = stringAttribute(focused, kAXSubroleAttribute as CFString)
        let sensitive = isSensitive(focused, role: role, subrole: subrole)
        var beforeText = ""
        var selectedText = ""
        var selectedTextLength = 0
        var afterText = ""

        if !appOnly && !sensitive,
            let text = stringAttribute(focused, kAXValueAttribute as CFString),
            let selection = selectionRange(focused)
        {
            let bounded = boundedText(text, selection: selection)
            beforeText = bounded.before
            selectedText = bounded.selected
            selectedTextLength = bounded.selectedLength
            afterText = bounded.after
        }

        Event.desktopContext(
            appName: appName,
            bundleIdentifier: bundleIdentifier,
            documentURL: documentURL(from: focused),
            role: role,
            sensitive: sensitive,
            beforeText: beforeText,
            selectedText: selectedText,
            selectedTextLength: selectedTextLength,
            afterText: afterText
        ).emit()
        exit(0)
    }
}
