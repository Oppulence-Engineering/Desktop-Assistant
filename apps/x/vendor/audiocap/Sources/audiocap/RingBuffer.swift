import Foundation

/// A fixed-capacity ring of 16-bit samples: the last N seconds of audio, and nothing
/// older.
///
/// The capacity is the whole feature. Standby has to be bounded in memory *and* bounded
/// in what it could possibly retain — "we keep the last five minutes" is a claim someone
/// can check, and an unbounded buffer that happens to get drained often is not the same
/// promise at all.
///
/// Storage is a flat pre-allocated array so there is no allocation on the audio thread,
/// and `write` is O(n) in the samples written regardless of how long standby has run.
/// Callers hold the writer's lock; this does no locking of its own.
final class RingBuffer {
    private var storage: [Int16]
    private let capacity: Int
    /// Where the next sample goes.
    private var head = 0
    /// How many valid samples are held, saturating at `capacity`.
    private(set) var count = 0

    init(capacity: Int) {
        self.capacity = max(1, capacity)
        self.storage = [Int16](repeating: 0, count: self.capacity)
    }

    func write(_ samples: UnsafePointer<Int16>, count sampleCount: Int) {
        guard sampleCount > 0 else { return }

        // More than a full ring in one buffer: only the tail could survive, so skip
        // straight to it rather than overwriting the same cells repeatedly.
        let start = sampleCount > capacity ? sampleCount - capacity : 0
        let usable = sampleCount - start

        storage.withUnsafeMutableBufferPointer { destination in
            guard let base = destination.baseAddress else { return }
            let firstChunk = min(usable, capacity - head)
            base.advanced(by: head).update(from: samples.advanced(by: start), count: firstChunk)
            let remainder = usable - firstChunk
            if remainder > 0 {
                base.update(from: samples.advanced(by: start + firstChunk), count: remainder)
            }
        }

        head = (head + usable) % capacity
        count = min(count + usable, capacity)
    }

    /// Everything held, oldest first. Empties the ring.
    func drain() -> [Int16] {
        guard count > 0 else { return [] }
        var out = [Int16]()
        out.reserveCapacity(count)
        // `head` is one past the newest sample, so the oldest is `count` behind it.
        let start = (head - count + capacity) % capacity
        if start + count <= capacity {
            out.append(contentsOf: storage[start..<(start + count)])
        } else {
            out.append(contentsOf: storage[start..<capacity])
            out.append(contentsOf: storage[0..<(count - (capacity - start))])
        }
        head = 0
        count = 0
        return out
    }
}
