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
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return }
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
var stdoutOpen = true
var finished = false

func writeChunk(_ data: Data) {
    outputLock.lock()
    defer { outputLock.unlock() }
    try? writer?.append(data)
    guard streamPCM, stdoutOpen else { return }
    do {
        try stdoutHandle.write(contentsOf: data)
    } catch {
        // The reader went away (EPIPE); keep filling the WAV regardless.
        stdoutOpen = false
    }
}

func finish(_ code: Int32) -> Never {
    if finished { exit(code) }
    finished = true
    recorder?.stop()
    outputLock.lock()
    writer?.close()
    writer = nil
    outputLock.unlock()
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
do {
    try capture.start()
} catch {
    outputLock.lock()
    writer?.close()
    writer = nil
    outputLock.unlock()
    if probing { try? FileManager.default.removeItem(atPath: wavPath) }
    emitError(error.localizedDescription)
    exit(1)
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
        outputLock.lock()
        writer?.close()
        writer = nil
        outputLock.unlock()
        let frames = capture.framesWritten
        if pathArgument == nil { try? FileManager.default.removeItem(atPath: wavPath) }
        // systemSeconds separates "the tap was created" from "the tap delivered".
        emit([
            "state": "probed",
            "systemAudio": capture.systemAudio,
            "seconds": Double(frames) / kTargetSampleRate,
            "systemSeconds": Double(capture.systemFrames) / kTargetSampleRate,
        ])
        if frames == 0 {
            emitError("no audio was captured in \(Int(PROBE_SECONDS)) s")
            exit(1)
        }
        exit(0)
    }
}

RunLoop.main.run()
