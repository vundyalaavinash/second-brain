import AVFoundation
import AudioToolbox
import CoreAudio
import Foundation

struct RecorderError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

let kTargetSampleRate: Double = 16000

/// 16 kHz mono 16-bit little-endian PCM — what whisper.cpp wants, so nothing
/// downstream has to resample.
let kTargetFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: kTargetSampleRate, channels: 1, interleaved: true)!

/// Anything that can be torn down at the end of a recording.
protocol AudioSource: AnyObject {
    func stop()
}

/// Converts a buffer in any input format to 16 kHz mono Int16 samples.
final class Downmixer {
    private let converter: AVAudioConverter

    init(from format: AVAudioFormat) throws {
        guard let converter = AVAudioConverter(from: format, to: kTargetFormat) else {
            throw RecorderError("cannot convert \(format) to 16 kHz mono")
        }
        converter.sampleRateConverterQuality = AVAudioQuality.medium.rawValue
        self.converter = converter
    }

    func samples(from buffer: AVAudioPCMBuffer) -> [Int16] {
        guard buffer.frameLength > 0 else { return [] }
        let ratio = kTargetSampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: kTargetFormat, frameCapacity: capacity) else { return [] }
        var supplied = false
        var error: NSError?
        let status = converter.convert(to: out, error: &error) { _, outStatus in
            if supplied {
                outStatus.pointee = .noDataNow
                return nil
            }
            supplied = true
            outStatus.pointee = .haveData
            return buffer
        }
        guard status != .error, let channel = out.int16ChannelData, out.frameLength > 0 else { return [] }
        return Array(UnsafeBufferPointer(start: channel[0], count: Int(out.frameLength)))
    }
}

/// System output audio through a Core Audio process tap on the default output
/// device, wrapped in a private aggregate device so an IOProc can read it.
/// macOS 14.2 and newer; the caller falls back to the microphone alone when
/// this throws (older system, or the audio-capture permission was refused).
@available(macOS 14.2, *)
final class SystemTap: AudioSource {
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private var downmixer: Downmixer?
    private var format: AVAudioFormat?
    private let onSamples: ([Int16]) -> Void

    init(onSamples: @escaping ([Int16]) -> Void) throws {
        self.onSamples = onSamples

        let description = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        description.isPrivate = true
        description.muteBehavior = .unmuted
        description.name = "sb-recorder tap"
        var status = AudioHardwareCreateProcessTap(description, &tapID)
        guard status == noErr, tapID != AudioObjectID(kAudioObjectUnknown) else {
            throw RecorderError("AudioHardwareCreateProcessTap failed (\(status))")
        }

        let outputUID = try SystemTap.defaultOutputDeviceUID()
        let settings: [String: Any] = [
            kAudioAggregateDeviceNameKey: "sb-recorder",
            kAudioAggregateDeviceUIDKey: "com.second-brain.recorder.\(UUID().uuidString)",
            kAudioAggregateDeviceMainSubDeviceKey: outputUID,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID]],
            kAudioAggregateDeviceTapListKey: [[
                kAudioSubTapDriftCompensationKey: true,
                kAudioSubTapUIDKey: description.uuid.uuidString,
            ]],
        ]
        status = AudioHardwareCreateAggregateDevice(settings as CFDictionary, &aggregateID)
        guard status == noErr, aggregateID != AudioObjectID(kAudioObjectUnknown) else {
            cleanUp()
            throw RecorderError("AudioHardwareCreateAggregateDevice failed (\(status))")
        }

        var asbd = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        status = AudioObjectGetPropertyData(tapID, &address, 0, nil, &size, &asbd)
        guard status == noErr, let tapFormat = AVAudioFormat(streamDescription: &asbd), tapFormat.sampleRate > 0 else {
            cleanUp()
            throw RecorderError("the tap reported no usable format (\(status))")
        }
        format = tapFormat
        downmixer = try Downmixer(from: tapFormat)

        status = AudioDeviceCreateIOProcIDWithBlock(&procID, aggregateID, nil) { [weak self] _, inputData, _, _, _ in
            guard let self, let format = self.format, let downmixer = self.downmixer else { return }
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, bufferListNoCopy: inputData) else { return }
            let samples = downmixer.samples(from: buffer)
            if !samples.isEmpty { self.onSamples(samples) }
        }
        guard status == noErr, procID != nil else {
            cleanUp()
            throw RecorderError("AudioDeviceCreateIOProcIDWithBlock failed (\(status))")
        }
        status = AudioDeviceStart(aggregateID, procID)
        guard status == noErr else {
            cleanUp()
            throw RecorderError("AudioDeviceStart failed (\(status))")
        }
    }

    func stop() {
        if let procID, aggregateID != AudioObjectID(kAudioObjectUnknown) {
            AudioDeviceStop(aggregateID, procID)
        }
        cleanUp()
    }

    private func cleanUp() {
        if let procID, aggregateID != AudioObjectID(kAudioObjectUnknown) {
            AudioDeviceDestroyIOProcID(aggregateID, procID)
            self.procID = nil
        }
        if aggregateID != AudioObjectID(kAudioObjectUnknown) {
            AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = AudioObjectID(kAudioObjectUnknown)
        }
        if tapID != AudioObjectID(kAudioObjectUnknown) {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = AudioObjectID(kAudioObjectUnknown)
        }
    }

    private static func defaultOutputDeviceUID() throws -> String {
        var deviceID = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &deviceID)
        guard status == noErr, deviceID != AudioObjectID(kAudioObjectUnknown) else {
            throw RecorderError("no default output device (\(status))")
        }
        address.mSelector = kAudioDevicePropertyDeviceUID
        var uid: CFString = "" as CFString
        size = UInt32(MemoryLayout<CFString>.size)
        status = withUnsafeMutablePointer(to: &uid) {
            AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, $0)
        }
        guard status == noErr else { throw RecorderError("no UID for the default output device (\(status))") }
        return uid as String
    }
}

/// Records the microphone, mixed with system output audio when the process tap
/// is available, and hands every converted chunk to `onChunk` as raw LE16 PCM.
final class Recorder {
    private let engine = AVAudioEngine()
    private let lock = NSLock()
    private var systemQueue: [Int16] = []
    private var micDownmixer: Downmixer?
    private var systemTap: AudioSource?
    private let onChunk: (Data) -> Void
    private(set) var systemAudio = false
    private(set) var framesWritten = 0
    private(set) var systemFrames = 0

    /// Two seconds of system audio; past that the microphone has fallen behind
    /// (or stopped) and the oldest samples are dropped rather than queued.
    private let maxQueued = Int(kTargetSampleRate) * 2

    init(onChunk: @escaping (Data) -> Void) {
        self.onChunk = onChunk
    }

    func start() throws {
        if #available(macOS 14.2, *) {
            do {
                systemTap = try SystemTap { [weak self] samples in self?.enqueueSystem(samples) }
                systemAudio = true
            } catch {
                log("system audio unavailable, recording the microphone only: \(error.localizedDescription)")
            }
        } else {
            log("system audio needs macOS 14.2 or newer; recording the microphone only")
        }

        let input = engine.inputNode
        let format = input.inputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw RecorderError("the default input device reports no format; is a microphone connected?")
        }
        micDownmixer = try Downmixer(from: format)
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            self?.handleMic(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            throw RecorderError("could not start the audio engine: \(error.localizedDescription)")
        }
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        if engine.isRunning { engine.stop() }
        systemTap?.stop()
        systemTap = nil
    }

    private func enqueueSystem(_ samples: [Int16]) {
        lock.lock()
        systemFrames += samples.count
        systemQueue.append(contentsOf: samples)
        if systemQueue.count > maxQueued {
            systemQueue.removeFirst(systemQueue.count - maxQueued)
        }
        lock.unlock()
    }

    /// The microphone is the clock: every mic buffer takes as many system
    /// samples as it has frames and sums them, so the output stays at real time
    /// whether or not system audio is flowing.
    private func handleMic(_ buffer: AVAudioPCMBuffer) {
        guard let downmixer = micDownmixer else { return }
        var samples = downmixer.samples(from: buffer)
        guard !samples.isEmpty else { return }

        lock.lock()
        let take = min(samples.count, systemQueue.count)
        if take > 0 {
            let system = systemQueue.prefix(take)
            systemQueue.removeFirst(take)
            lock.unlock()
            for (i, s) in system.enumerated() {
                let sum = Int32(samples[i]) + Int32(s)
                samples[i] = Int16(max(Int32(Int16.min), min(Int32(Int16.max), sum)))
            }
        } else {
            lock.unlock()
        }

        framesWritten += samples.count
        let data = samples.withUnsafeBufferPointer { Data(buffer: $0) }
        onChunk(data)
    }
}
