// swift-tools-version:6.0
import PackageDescription

// The capture half needs nothing but the system frameworks. The transcription half
// needs FluidAudio's Core ML port of Parakeet, which is why this manifest exists at
// all — see README ("On SwiftPM") for why the build moved back off bare `swiftc`.
let package = Package(
    name: "audiocap",
    platforms: [.macOS("14.2")], // Core Audio process taps (AudioHardwareCreateProcessTap)
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", from: "0.15.0")
    ],
    targets: [
        .executableTarget(
            name: "audiocap",
            dependencies: [.product(name: "FluidAudio", package: "FluidAudio")],
            path: "Sources/audiocap",
            exclude: ["Info.plist"],
            linkerSettings: [
                // Embed Info.plist into the Mach-O (__TEXT,__info_plist) so TCC has
                // usage strings to attribute when the binary runs without an .app
                // bundle around it — e.g. straight from a terminal in dev.
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", "Sources/audiocap/Info.plist",
                ])
            ]
        ),
        .testTarget(name: "audiocapTests", dependencies: ["audiocap"]),
    ],
    swiftLanguageVersions: [.v5]
)
