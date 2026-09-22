import AVFoundation
import Foundation

// Usage:
//   sb-recorder <wav-path>   record until SIGINT/SIGTERM; WAV to the path,
//                            raw 16 kHz mono LE16 PCM on stdout, JSON state
//                            lines on stderr
//   sb-recorder --probe      record two seconds to a temp file and exit 0 (or 1
//                            when nothing could be captured), which is what
//                            triggers the macOS permission prompts

let VERSION = "1.0.0"
let PROBE_SECONDS: TimeInterval = 2

let stdoutHandle = FileHandle.standardOutput
let stderrHandle = FileHandle.standardError

func log(_ s: String) {
    stderrHandle.write("[sb-recorder] \(s)\n".data(using: .utf8)!)
}

/// One JSON object per line on stderr — the contract the Node side parses.
func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes]) else { return }
    stderrHandle.write(data)
    stderrHandle.write(Data("\n".utf8))
}

func emitError(_ message: String) {
    emit(["state": "error", "message": message])
}

let args = Array(CommandLine.arguments.dropFirst())
let probing = args.contains("--probe")
let pathArgument = args.first { !$0.hasPrefix("--") }

if args.contains("--version") {
    print(VERSION)
    exit(0)
}
if !probing && pathArgument == nil {
    log("usage: sb-recorder <wav-path> | sb-recorder --probe")
    exit(2)
}

let probeFile = NSTemporaryDirectory() + "sb-recorder-probe-\(UUID().uuidString).wav"
let wavPath: String = {
    guard let p = pathArgument else { return probeFile }
    return p.hasPrefix("/") ? p : FileManager.default.currentDirectoryPath + "/" + p
}()
/// Only a real recording streams PCM; a probe would spray binary at the terminal.
let streamPCM = !probing

let outputLock = NSLock()
var writer: WavWriter?
var recorder: Recorder?
var finished = false
var wavFailed = false

/// stdout is drained on its own serial queue, and never under `outputLock`: a
/// consumer that stops reading then blocks nothing but itself, and the capture
/// thread and `finish()` keep running while a write sits wedged in the kernel.
let stdoutQueue = DispatchQueue(label: "com.second-brain.recorder.stdout")
let stdoutLock = NSLock()
var stdoutBacklog: [Data] = []
var stdoutBacklogBytes = 0
var stdoutOpen = true
/// Two seconds of 16 kHz mono 16-bit audio.
let maxBacklogBytes = Int(kTargetSampleRate) * 2 * MemoryLayout<Int16>.size

func writeChunk(_ data: Data) {
    outputLock.lock()
    var failure: String?
    do {
        try writer?.append(data)
    } catch {
        failure = error.localizedDescription
    }
    outputLock.unlock()
    if let failure {
        wavWriteFailed(failure)
        return
    }
    guard streamPCM else { return }
    queueForStdout(data)
}

/// A WAV that cannot be written leaves a truncated recording, so say so once and
/// stop with a non-zero status rather than recording into nothing.
func wavWriteFailed(_ message: String) {
    outputLock.lock()
    let first = !wavFailed
    wavFailed = true
    outputLock.unlock()
    guard first else { return }
    emitError("cannot write \(wavPath): \(message)")
    // Off the capture thread: finish() stops the engine that is calling us.
    DispatchQueue.main.async { finish(1) }
}

func queueForStdout(_ data: Data) {
    stdoutLock.lock()
    guard stdoutOpen else {
        stdoutLock.unlock()
        return
    }
    stdoutBacklog.append(data)
    stdoutBacklogBytes += data.count
    var stalled = false
    while stdoutBacklogBytes > maxBacklogBytes, !stdoutBacklog.isEmpty {
        stdoutBacklogBytes -= stdoutBacklog.removeFirst().count
        stalled = true
    }
    if stalled {
        stdoutOpen = false
        stdoutBacklog.removeAll()
        stdoutBacklogBytes = 0
    }
    stdoutLock.unlock()
    if stalled {
        emitError("stdout consumer stalled")
        return
    }
    stdoutQueue.async { drainStdout() }
}

func drainStdout() {
    stdoutLock.lock()
    guard stdoutOpen, !stdoutBacklog.isEmpty else {
        stdoutLock.unlock()
        return
    }
    let chunk = stdoutBacklog.removeFirst()
    stdoutBacklogBytes -= chunk.count
    stdoutLock.unlock()
    do {
        try stdoutHandle.write(contentsOf: chunk)
    } catch {
        // The reader went away (EPIPE); keep filling the WAV regardless.
        closeStdout()
    }
}

func closeStdout() {
    stdoutLock.lock()
    stdoutOpen = false
    stdoutBacklog.removeAll()
    stdoutBacklogBytes = 0
    stdoutLock.unlock()
}

func finish(_ code: Int32) -> Never {
    if finished { exit(code) }
    finished = true
    recorder?.stop()
    outputLock.lock()
    writer?.close()
    writer = nil
    outputLock.unlock()
    if probing && pathArgument == nil { try? FileManager.default.removeItem(atPath: wavPath) }
    exit(code)
}

/// Asking for microphone access is what raises the system prompt; the tap's own
/// audio-capture permission is requested by Core Audio when the tap is created.
func ensureMicrophoneAccess() -> Bool {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized:
        return true
    case .notDetermined:
        let semaphore = DispatchSemaphore(value: 0)
        var granted = false
        AVCaptureDevice.requestAccess(for: .audio) { ok in
            granted = ok
            semaphore.signal()
        }
        if semaphore.wait(timeout: .now() + 120) == .timedOut { return false }
        return granted
    default:
        return false
    }
}

guard ensureMicrophoneAccess() else {
    emitError("microphone access denied; allow it in System Settings › Privacy & Security › Microphone")
    exit(1)
}

do {
    writer = try WavWriter(path: wavPath)
} catch {
    emitError("cannot write \(wavPath): \(error.localizedDescription)")
    exit(1)
}

let capture = Recorder { data in writeChunk(data) }
recorder = capture
capture.onDeviceChange = { systemAudio in emit(["state": "device", "systemAudio": systemAudio]) }
capture.onFatal = { message in
    emitError(message)
    finish(1)
}
do {
    try capture.start()
} catch {
    emitError(error.localizedDescription)
    finish(1)
}

emit(["state": "recording", "systemAudio": capture.systemAudio])

// SIGINT and SIGTERM are ignored by the default handler so the dispatch source
// can flush the WAV header before the process goes away.
signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)
signal(SIGPIPE, SIG_IGN)
let interruptSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
let terminateSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
interruptSource.setEventHandler { finish(0) }
terminateSource.setEventHandler { finish(0) }
interruptSource.resume()
terminateSource.resume()

if probing {
    DispatchQueue.main.asyncAfter(deadline: .now() + PROBE_SECONDS) {
        capture.stop()
        let counters = capture.counters()
        // systemSeconds separates "the tap was created" from "the tap delivered".
        emit([
            "state": "probed",
            "systemAudio": capture.systemAudio,
            "seconds": Double(counters.frames) / kTargetSampleRate,
            "systemSeconds": Double(counters.systemFrames) / kTargetSampleRate,
        ])
        if counters.frames == 0 {
            emitError("no audio was captured in \(Int(PROBE_SECONDS)) s")
            finish(1)
        }
        finish(0)
    }
}

RunLoop.main.run()
