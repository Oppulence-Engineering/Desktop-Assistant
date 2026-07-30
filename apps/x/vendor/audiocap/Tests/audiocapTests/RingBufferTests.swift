import XCTest

@testable import audiocap

/// The bounded buffer behind retroactive recording.
///
/// Worth testing precisely because every failure here is silent. A ring that returns
/// samples out of order still produces a playable WAV — of garbled audio. One that
/// keeps the *oldest* N instead of the newest still produces a recording, of the wrong
/// few minutes. And one that quietly grows past its capacity still works, while turning
/// "we hold the last five minutes" into a claim that is no longer true.
final class RingBufferTests: XCTestCase {
    private func write(_ ring: RingBuffer, _ values: [Int16]) {
        values.withUnsafeBufferPointer { buffer in
            guard let base = buffer.baseAddress else { return }
            ring.write(base, count: buffer.count)
        }
    }

    func testEmptyRingDrainsToNothing() {
        XCTAssertEqual(RingBuffer(capacity: 8).drain(), [])
    }

    func testHoldsEverythingUnderCapacity() {
        let ring = RingBuffer(capacity: 8)
        write(ring, [1, 2, 3])
        XCTAssertEqual(ring.count, 3)
        XCTAssertEqual(ring.drain(), [1, 2, 3])
    }

    func testKeepsTheNewestSamplesOnceFull() {
        let ring = RingBuffer(capacity: 4)
        write(ring, [1, 2, 3, 4, 5, 6])
        // The last four, in order — not the first four, and not shuffled.
        XCTAssertEqual(ring.drain(), [3, 4, 5, 6])
    }

    func testWrapsAcrossSeparateWrites() {
        // The case a single-write test misses: the wrap happens *between* calls, which
        // is how it actually arrives from an audio callback.
        let ring = RingBuffer(capacity: 5)
        write(ring, [1, 2, 3])
        write(ring, [4, 5, 6, 7])
        XCTAssertEqual(ring.drain(), [3, 4, 5, 6, 7])
    }

    func testWriteLargerThanCapacityKeepsOnlyItsTail() {
        let ring = RingBuffer(capacity: 3)
        write(ring, [1, 2, 3, 4, 5, 6, 7, 8, 9])
        XCTAssertEqual(ring.drain(), [7, 8, 9])
    }

    func testNeverExceedsCapacity() {
        let ring = RingBuffer(capacity: 4)
        for _ in 0..<1000 { write(ring, [1, 2, 3]) }
        // The whole promise of standby: memory is bounded no matter how long it runs.
        XCTAssertEqual(ring.count, 4)
        XCTAssertEqual(ring.drain().count, 4)
    }

    func testDrainEmptiesTheRing() {
        let ring = RingBuffer(capacity: 4)
        write(ring, [1, 2, 3])
        _ = ring.drain()
        XCTAssertEqual(ring.count, 0)
        XCTAssertEqual(ring.drain(), [])
    }

    func testRefillsCleanlyAfterDraining() {
        let ring = RingBuffer(capacity: 4)
        write(ring, [1, 2, 3, 4, 5])
        _ = ring.drain()
        write(ring, [9, 8])
        XCTAssertEqual(ring.drain(), [9, 8])
    }

    func testEmptyWriteIsANoOp() {
        let ring = RingBuffer(capacity: 4)
        write(ring, [1, 2])
        write(ring, [])
        XCTAssertEqual(ring.drain(), [1, 2])
    }
}
