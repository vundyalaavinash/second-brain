import Foundation

/// Streaming WAV writer for 16-bit PCM. The header goes out first with zeroed
/// sizes, samples are appended as they arrive, and `close()` patches the two
/// size fields — so a recording killed mid-flight still leaves a readable file
/// apart from its length fields.
final class WavWriter {
    private let handle: FileHandle
    private let sampleRate: Int
    private let channels: Int
    private var dataBytes: UInt32 = 0
    private var closed = false

    init(path: String, sampleRate: Int = 16000, channels: Int = 1) throws {
        self.sampleRate = sampleRate
        self.channels = channels
        let dir = (path as NSString).deletingLastPathComponent
        if !dir.isEmpty {
            try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        }
        guard FileManager.default.createFile(atPath: path, contents: nil),
              let handle = FileHandle(forWritingAtPath: path) else {
            throw RecorderError("cannot open \(path) for writing")
        }
        self.handle = handle
        try handle.write(contentsOf: WavWriter.header(sampleRate: sampleRate, channels: channels, dataBytes: 0))
    }

    func append(_ data: Data) throws {
        guard !closed else { return }
        try handle.write(contentsOf: data)
        dataBytes = dataBytes &+ UInt32(data.count)
    }

    /// Patch the RIFF and data chunk sizes, then close the file.
    func close() {
        guard !closed else { return }
        closed = true
        try? handle.synchronize()
        try? handle.seek(toOffset: 4)
        try? handle.write(contentsOf: le32(36 &+ dataBytes))
        try? handle.seek(toOffset: 40)
        try? handle.write(contentsOf: le32(dataBytes))
        try? handle.close()
    }

    var bytesWritten: UInt32 { dataBytes }

    private static func header(sampleRate: Int, channels: Int, dataBytes: UInt32) -> Data {
        let bitsPerSample = 16
        let byteRate = sampleRate * channels * bitsPerSample / 8
        let blockAlign = channels * bitsPerSample / 8
        var d = Data()
        d.append(contentsOf: Array("RIFF".utf8))
        d.append(le32(36 &+ dataBytes))
        d.append(contentsOf: Array("WAVEfmt ".utf8))
        d.append(le32(16))                       // PCM fmt chunk size
        d.append(le16(1))                        // format: PCM
        d.append(le16(UInt16(channels)))
        d.append(le32(UInt32(sampleRate)))
        d.append(le32(UInt32(byteRate)))
        d.append(le16(UInt16(blockAlign)))
        d.append(le16(UInt16(bitsPerSample)))
        d.append(contentsOf: Array("data".utf8))
        d.append(le32(dataBytes))
        return d
    }
}

private func le16(_ v: UInt16) -> Data { withUnsafeBytes(of: v.littleEndian) { Data($0) } }
private func le32(_ v: UInt32) -> Data { withUnsafeBytes(of: v.littleEndian) { Data($0) } }
