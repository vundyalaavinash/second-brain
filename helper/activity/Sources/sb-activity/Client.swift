import Foundation

struct HeartbeatResponse: Decodable {
    struct Exclusions: Decodable { var apps: [String]; var domains: [String] }
    var exclusions: Exclusions
    var paused: Bool
}

final class Client {
    let base: URL
    let token: String
    private let session = URLSession(configuration: .ephemeral)

    init(base: URL, token: String) { self.base = base; self.token = token }

    /// Synchronous POST; returns (status, body) or nil when the server is unreachable.
    func post(_ path: String, json: Data) -> (Int, Data)? {
        var req = URLRequest(url: base.appendingPathComponent(path), timeoutInterval: 5)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.httpBody = json
        let sem = DispatchSemaphore(value: 0)
        var result: (Int, Data)?
        session.dataTask(with: req) { data, resp, _ in
            if let http = resp as? HTTPURLResponse { result = (http.statusCode, data ?? Data()) }
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 6)
        return result
    }
}
