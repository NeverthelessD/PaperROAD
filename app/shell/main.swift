// PaperROAD — Dock 에 보이는 맥 앱 껍데기
// made by. Nevertheless_D
//
// 왜 이 껍데기가 있나요?
//   macOS 27 의 '백그라운드 앱 활동' 규칙: 앱을 종료한 뒤에도 창·메뉴 막대·Dock 없이 남아 도는 프로그램은
//   사용자에게 보여 주고, 허용되지 않으면 시스템이 끕니다. 예외는 '그 프로그램을 켠 앱이 Dock 에 있을 때'예요.
//   그래서 PaperROAD 는 Dock 에 보이는 정식 앱이고, 엔진은 이 앱의 자식으로 '앱이 켜져 있는 동안만' 돌아요.
//   규칙을 피해 가는 장치(종료 신호 무시, 몰래 도는 도우미 앱)는 쓰지 않아요. (MSROAD 와 같은 구조)
//
// 하는 일
//   1) 앱 안의 엔진을 ~/Library/Application Support/PaperROAD/bin 으로 복사 (업데이트로 앱 묶음이 바뀌어도 안전하게)
//   2) 엔진(지킴이 모드)을 자식으로 켜고, 127.0.0.1:47931 + 토큰 주소를 앱 창(WKWebView)에 띄움
//   3) Dock 아이콘을 누르면 창을 다시 보여 주고, 앱을 종료하면 엔진도 깔끔하게 끔
//   4) 엔진이 끝나면 앱도 끝남 (화면의 '종료' 버튼) · 업데이트 후에는 새 버전을 다시 엶
//   5) 모든 단계를 launcher.log 에 기록
//   6) 파일 고르기 · 폴더 고르기 창, Finder 에서 끌어 놓은 파일의 경로를 화면에 알려 줌
//      (Dock 아이콘 위에 PDF 를 떨어뜨리거나 '다음으로 열기'로 열어도 화면에 넣어 줘요)

import AppKit
import Darwin
import UniformTypeIdentifiers
import WebKit

// MARK: - 경로 · 기록

enum Paths {
    static let support: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("PaperROAD", isDirectory: true)
    }()
    static let bin = support.appendingPathComponent("bin", isDirectory: true)
    static let engine = bin.appendingPathComponent("paperroad-engine")
    static func file(_ name: String) -> URL { support.appendingPathComponent(name) }
}

enum Log {
    static func write(_ message: String) {
        let fm = FileManager.default
        try? fm.createDirectory(at: Paths.support, withIntermediateDirectories: true)
        let url = Paths.file("launcher.log")
        if let attrs = try? fm.attributesOfItem(atPath: url.path), let size = attrs[.size] as? NSNumber, size.intValue > 262_144 {
            let prev = Paths.file("launcher.prev.log")
            try? fm.removeItem(at: prev)
            try? fm.moveItem(at: url, to: prev)
        }
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "MM-dd HH:mm:ss"
        let line = "\(df.string(from: Date())) [앱 \(getpid())] \(message)\n"
        guard let data = line.data(using: .utf8) else { return }
        if let h = try? FileHandle(forWritingTo: url) {
            h.seekToEndOfFile()
            h.write(data)
            h.closeFile()
        } else {
            try? data.write(to: url)
        }
    }
}

// MARK: - 엔진

final class Engine {
    var process: Process?
    var port: Int = 0
    var token: String = ""
    let build: String
    var onExit: ((Int32, Bool) -> Void)?

    init() {
        let v = Bundle.main.url(forResource: "version", withExtension: "txt")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? "0.0.0"
        build = v.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func readText(_ name: String) -> String? {
        guard let s = try? String(contentsOf: Paths.file(name), encoding: .utf8) else { return nil }
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    /// 앱 안의 엔진을 앱 전용 폴더로 복사해요 (버전이 바뀌었을 때만)
    func prepare() throws {
        let fm = FileManager.default
        try fm.createDirectory(at: Paths.bin, withIntermediateDirectories: true)
        let buildFile = Paths.bin.appendingPathComponent("build")
        let installed = (try? String(contentsOf: buildFile, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let want = build + "-native"
        if installed != want || !fm.isExecutableFile(atPath: Paths.engine.path) {
            guard let src = Bundle.main.url(forResource: "paperroad-engine", withExtension: nil) else {
                throw NSError(domain: "PaperROAD", code: 1, userInfo: [NSLocalizedDescriptionKey: "앱 안에서 엔진을 찾지 못했어요"])
            }
            let tmp = Paths.bin.appendingPathComponent("paperroad-engine.new")
            try? fm.removeItem(at: tmp)
            try fm.copyItem(at: src, to: tmp)
            chmod(tmp.path, 0o755)
            removexattr(tmp.path, "com.apple.quarantine", 0)
            if rename(tmp.path, Paths.engine.path) != 0 {
                throw NSError(domain: "PaperROAD", code: 2, userInfo: [NSLocalizedDescriptionKey: "엔진을 준비하지 못했어요"])
            }
            try want.write(to: buildFile, atomically: true, encoding: .utf8)
            Log.write("엔진 준비 (v\(build))")
        }
        removexattr(Paths.engine.path, "com.apple.quarantine", 0)
    }

    /// 127.0.0.1 엔진에 짧게 요청해요 (응답이 200 이면 내용을 돌려줘요)
    func request(_ method: String, port: Int, path: String, token: String, timeout: TimeInterval) -> Data? {
        guard let url = URL(string: "http://127.0.0.1:\(port)\(path)") else { return nil }
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        req.httpMethod = method
        req.setValue(token, forHTTPHeaderField: "x-token")
        if method == "POST" {
            req.httpBody = "{}".data(using: .utf8)
            req.setValue("application/json", forHTTPHeaderField: "content-type")
        }
        let sem = DispatchSemaphore(value: 0)
        var out: Data?
        let task = URLSession.shared.dataTask(with: req) { data, resp, _ in
            if let h = resp as? HTTPURLResponse, h.statusCode == 200 { out = data ?? Data() }
            sem.signal()
        }
        task.resume()
        if sem.wait(timeout: .now() + timeout + 0.5) == .timedOut { task.cancel() }
        return out
    }

    /// 이미 켜져 있는 엔진(예전 버전 포함)이 있으면 끄고 새로 켜요
    func stopExisting() {
        guard let p = readText("port").flatMap({ Int($0) }), let t = readText("token") else { return }
        guard request("GET", port: p, path: "/api/ping", token: t, timeout: 1) != nil else { return }
        Log.write("이미 켜져 있던 엔진(포트 \(p))을 끄고 새로 켜요")
        _ = request("POST", port: p, path: "/api/quit", token: t, timeout: 2)
        for _ in 0..<40 {
            if request("GET", port: p, path: "/api/ping", token: t, timeout: 0.5) == nil { break }
            usleep(150_000)
        }
    }

    func start() throws {
        let fm = FileManager.default
        token = readText("token") ?? Engine.randomToken()
        try? fm.removeItem(at: Paths.file("port"))
        try? fm.removeItem(at: Paths.file("restart-requested"))

        let p = Process()
        p.executableURL = Paths.engine
        var env = ProcessInfo.processInfo.environment
        for k in ["PAPERROAD_RESTART", "PAPERROAD_PORT", "PAPERROAD_CHILD"] { env.removeValue(forKey: k) }
        env["PAPERROAD_SUPERVISOR"] = "1"
        env["PAPERROAD_SHELL"] = "native"
        env["PAPERROAD_VIA"] = "native"
        env["PAPERROAD_TOKEN"] = token
        env["PAPERROAD_SUPPORT"] = Paths.support.path
        env["PAPERROAD_APP"] = Bundle.main.bundlePath
        env["PAPERROAD_PARENT_PID"] = String(getpid())
        env["PAPERROAD_PORT_WAIT"] = "1"
        p.environment = env
        p.standardInput = FileHandle.nullDevice
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        p.terminationHandler = { [weak self] proc in
            let code = proc.terminationStatus
            DispatchQueue.main.async { self?.exited(code) }
        }
        try p.run()
        process = p
        Log.write("엔진 켬 (지킴이 pid \(p.processIdentifier))")
    }

    func waitForPort() -> Int? {
        for _ in 0..<100 {
            if let v = readText("port").flatMap({ Int($0) }) {
                port = v
                return v
            }
            usleep(150_000)
        }
        return nil
    }

    private func exited(_ code: Int32) {
        let restart = FileManager.default.fileExists(atPath: Paths.file("restart-requested").path)
        process = nil
        onExit?(code, restart)
    }

    /// 앱을 종료할 때: 엔진에게 정중히 끄라고 하고, 안 꺼지면 종료 신호를 보내요
    func stop(completion: @escaping () -> Void) {
        guard let p = process, p.isRunning else { completion(); return }
        let port = self.port, token = self.token
        DispatchQueue.global(qos: .userInitiated).async {
            _ = self.request("POST", port: port, path: "/api/quit", token: token, timeout: 2)
            for _ in 0..<30 where p.isRunning { usleep(100_000) }
            if p.isRunning {
                p.terminate()
                for _ in 0..<20 where p.isRunning { usleep(100_000) }
            }
            if p.isRunning { kill(p.processIdentifier, SIGKILL) }
            DispatchQueue.main.async { completion() }
        }
    }

    static func randomToken() -> String {
        let chars = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")
        return String((0..<32).map { _ in chars[Int(arc4random_uniform(UInt32(chars.count)))] })
    }
}

// MARK: - 끌어 놓기를 받는 화면

/// Finder 에서 파일을 끌어 오면 경로를 화면(JS)에 알려 줘요. 파일이 아닌 끌기는 원래대로 처리해요.
final class PaperWebView: WKWebView {
    weak var app: AppDelegate?

    private func fileURLs(_ info: NSDraggingInfo) -> [URL] {
        let opts: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
        return (info.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: opts) as? [URL]) ?? []
    }

    private func point(_ info: NSDraggingInfo) -> (Double, Double) {
        let p = convert(info.draggingLocation, from: nil)
        return (Double(p.x), Double(isFlipped ? p.y : bounds.height - p.y))
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        if fileURLs(sender).isEmpty { return super.draggingEntered(sender) }
        let (x, y) = point(sender)
        app?.callJS("dragOver", ["on": true, "x": x, "y": y])
        return .copy
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        if fileURLs(sender).isEmpty { return super.draggingUpdated(sender) }
        let (x, y) = point(sender)
        app?.callJS("dragOver", ["on": true, "x": x, "y": y])
        return .copy
    }

    override func draggingExited(_ sender: NSDraggingInfo?) {
        app?.callJS("dragOver", ["on": false])
        super.draggingExited(sender)
    }

    override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool {
        if fileURLs(sender).isEmpty { return super.prepareForDragOperation(sender) }
        return true
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = fileURLs(sender)
        if urls.isEmpty { return super.performDragOperation(sender) }
        let (x, y) = point(sender)
        app?.callJS("dragOver", ["on": false])
        app?.callJS("drop", ["paths": urls.map { $0.path }, "x": x, "y": y])
        Log.write("끌어 놓기: 파일 \(urls.count)개")
        return true
    }

    override func concludeDragOperation(_ sender: NSDraggingInfo?) {
        if let s = sender, fileURLs(s).isEmpty { super.concludeDragOperation(sender) }
    }
}

/// 화면(app.js)에서 오는 부탁: window.webkit.messageHandlers.paperroad.postMessage({type: 'pickFiles' | 'chooseFolder', …})
final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var app: AppDelegate?
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.securityOrigin.host == "127.0.0.1",
              let body = message.body as? [String: Any], let type = body["type"] as? String, let app = app else {
            replyHandler(nil, "허용되지 않은 요청이에요")
            return
        }
        switch type {
        case "pickFiles": app.pickFiles(body, reply: replyHandler)
        case "chooseFolder": app.chooseFolder(body, reply: replyHandler)
        default: replyHandler(nil, "알 수 없는 요청이에요")
        }
    }
}

// MARK: - 창 맨 위 '잡는 줄'
// 화면(WKWebView)이 투명한 제목 막대 밑까지 창 전체를 덮고 있어요. 창이 앞에 있을 때(활성) 제목 막대 자리를 누르면
// 맥이 그 누름을 화면(WKWebView)에 넘겨 주고, WKWebView 는 '창을 옮겨도 된다'고 하지 않아서 창이 움직이지 않았어요.
// (다른 창을 눌렀다 돌아오면 첫 누름은 '창 앞으로 가져오기'로 맥이 직접 처리해서 움직였던 것.)
// 그래서 맨 위(제목 막대 + 도구 막대 높이, 52pt)에 투명한 줄을 깔아 두고, 여기를 잡으면 창이 움직여요
// (두 번 누르면 맥 설정대로 확대 · 최소화). 신호등 단추와 '설정' 단추는 제목 막대 위에 있어서 가려지지 않아요. (DayROAD 와 같은 방식)

final class DragStrip: NSView {
    static let height: CGFloat = 52

    override var mouseDownCanMoveWindow: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseDown(with event: NSEvent) {
        guard let w = window else { return }
        if event.clickCount == 2 {
            switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") ?? "Maximize" {
            case "Minimize": w.performMiniaturize(nil)
            case "None": break
            default: w.performZoom(nil)
            }
            return
        }
        w.performDrag(with: event)
    }
}

// MARK: - 앱

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate, NSToolbarDelegate {
    var window: NSWindow!
    var web: PaperWebView!
    let engine = Engine()
    var quitting = false
    var pageURL: URL?
    var pageReady = false
    var pendingOpen: [String] = []   // 화면이 준비되기 전에 '다음으로 열기'로 받은 파일

    func applicationDidFinishLaunching(_ notification: Notification) {
        Log.write("시작 v\(engine.build) · macOS \(ProcessInfo.processInfo.operatingSystemVersionString) · \(Bundle.main.bundlePath)")
        buildMenu()
        makeWindow()
        showLoading()
        engine.onExit = { [weak self] code, restart in self?.engineExited(code: code, restart: restart) }
        boot()
    }

    func boot() {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try self.engine.prepare()
                self.engine.stopExisting()
                try self.engine.start()
                guard let port = self.engine.waitForPort() else {
                    throw NSError(domain: "PaperROAD", code: 3, userInfo: [NSLocalizedDescriptionKey: "엔진이 준비되지 않았어요"])
                }
                Log.write("엔진 준비됨 (포트 \(port))")
                DispatchQueue.main.async { self.loadApp(port: port) }
            } catch {
                Log.write("⚠️ 시작 실패: \(error.localizedDescription)")
                DispatchQueue.main.async { self.startFailed(error) }
            }
        }
    }

    func loadApp(port: Int) {
        guard let url = URL(string: "http://127.0.0.1:\(port)/?t=\(engine.token)") else { return }
        pageURL = url
        pageReady = false
        web.load(URLRequest(url: url))
    }

    func startFailed(_ error: Error) {
        let a = NSAlert()
        a.alertStyle = .warning
        a.messageText = "PaperROAD를 시작하지 못했어요"
        a.informativeText = "\(error.localizedDescription)\n앱을 다시 실행해 보세요. 계속 안 되면 맥을 재시동한 뒤 시도해 주세요."
        a.addButton(withTitle: "다시 시도")
        a.addButton(withTitle: "종료")
        if a.runModal() == .alertFirstButtonReturn {
            boot()
        } else {
            quitting = true
            NSApp.terminate(nil)
        }
    }

    func engineExited(code: Int32, restart: Bool) {
        if quitting { return }
        if restart {
            relaunch()
            return
        }
        Log.write("엔진이 끝나서 앱도 닫아요 (코드 \(code))")
        quitting = true
        NSApp.terminate(nil)
    }

    /// 업데이트된 새 버전을 macOS 정식 방법(LaunchServices)으로 다시 열고, 지금 앱은 끝내요
    func relaunch() {
        Log.write("새 버전으로 다시 열어요")
        quitting = true
        let appURL = URL(fileURLWithPath: Bundle.main.bundlePath)
        let cfg = NSWorkspace.OpenConfiguration()
        cfg.createsNewApplicationInstance = true
        cfg.activates = true
        var env = ProcessInfo.processInfo.environment
        env.removeValue(forKey: "PAPERROAD_RESTART")
        env["PAPERROAD_RELAUNCHED"] = "1"
        cfg.environment = env
        NSWorkspace.shared.openApplication(at: appURL, configuration: cfg) { _, error in
            if let error = error { Log.write("⚠️ 다시 열지 못했어요: \(error.localizedDescription)") }
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }

    // Dock 아이콘 위에 파일을 떨어뜨리거나 Finder 의 '다음으로 열기'
    func application(_ application: NSApplication, open urls: [URL]) {
        let paths = urls.filter { $0.isFileURL }.map { $0.path }
        guard !paths.isEmpty else { return }
        Log.write("파일 열기 요청: \(paths.count)개")
        showMain()
        if pageReady {
            callJS("drop", ["paths": paths])
        } else {
            pendingOpen.append(contentsOf: paths)
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showMain() }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard engine.process != nil else { return .terminateNow }
        quitting = true
        Log.write("종료: 엔진을 끄는 중")
        engine.stop {
            Log.write("종료 완료")
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    // MARK: 화면에 알리기

    /// window.PR.native(name, data) 를 불러요 (화면이 아직 준비 안 됐으면 조용히 넘어가요)
    func callJS(_ name: String, _ data: [String: Any]) {
        guard pageReady,
              let json = try? JSONSerialization.data(withJSONObject: data),
              let s = String(data: json, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.PR && window.PR.native && window.PR.native(\"\(name)\", \(s))", completionHandler: nil)
    }

    // MARK: 창

    func makeWindow() {
        let cfg = WKWebViewConfiguration()
        cfg.applicationNameForUserAgent = "PaperROADShell/\(engine.build)"
        let bridge = Bridge()
        bridge.app = self
        cfg.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "paperroad")
        web = PaperWebView(frame: NSRect(x: 0, y: 0, width: 1200, height: 820), configuration: cfg)
        web.app = self
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsMagnification = false
        if #available(macOS 13.3, *) { web.isInspectable = true }

        // 창 제목 막대를 투명하게 해서 화면의 머리(로고)와 하나로 보이게 해요 (확정 시안).
        // 신호등 단추와 오른쪽 '설정' 단추는 맥이 그리는 진짜 단추예요.
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.title = "PaperROAD"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        let toolbar = NSToolbar(identifier: "PaperROADToolbar")
        toolbar.delegate = self
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
        window.toolbar = toolbar
        if #available(macOS 11.0, *) { window.toolbarStyle = .unified }
        window.minSize = NSSize(width: 900, height: 620)
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.delegate = self
        // 화면 + 맨 위 잡는 줄
        let box = NSView(frame: NSRect(x: 0, y: 0, width: 1200, height: 820))
        web.frame = box.bounds
        web.autoresizingMask = [.width, .height]
        box.addSubview(web)
        let strip = DragStrip(frame: NSRect(x: 0, y: box.bounds.height - DragStrip.height, width: box.bounds.width, height: DragStrip.height))
        strip.autoresizingMask = [.width, .minYMargin]
        box.addSubview(strip)
        window.contentView = box
        if !window.setFrameUsingName("PaperROADMain") { window.center() }
        window.setFrameAutosaveName("PaperROADMain")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func showLoading() {
        let html = """
        <!doctype html><meta charset="utf-8"><style>
        :root{color-scheme:light dark}
        body{margin:0;height:100vh;display:grid;place-items:center;font:600 14px -apple-system,"Apple SD Gothic Neo",sans-serif;
             background:#F6F7F9;color:#5B6270}
        @media (prefers-color-scheme: dark){body{background:#121417;color:#A1A8B4}}
        .w{display:flex;flex-direction:column;align-items:center;gap:14px}
        .s{width:22px;height:22px;border-radius:50%;border:2.5px solid rgba(128,128,160,.3);border-top-color:#2C4BDB;animation:r .9s linear infinite}
        @keyframes r{to{transform:rotate(360deg)}}
        </style><div class="w"><div class="s"></div>PaperROAD 준비 중…</div>
        """
        web.loadHTMLString(html, baseURL: nil)
    }

    @objc func showMain() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func openDiag() {
        if engine.port > 0, let u = URL(string: "http://127.0.0.1:\(engine.port)/diag") { NSWorkspace.shared.open(u) }
    }

    @objc func reloadPage() {
        if let u = pageURL { web.load(URLRequest(url: u)) }
    }

    @objc func menuOpen() { showMain(); callJS("menu", ["action": "open"]) }
    @objc func menuSettings() { showMain(); callJS("menu", ["action": "settings"]) }
    @objc func menuHome() { showMain(); callJS("menu", ["action": "home"]) }

    // MARK: 도구 막대 (설정 단추)

    static let settingsItem = NSToolbarItem.Identifier("PaperROADSettings")

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.flexibleSpace, AppDelegate.settingsItem]
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.flexibleSpace, AppDelegate.settingsItem]
    }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier,
                 willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        guard id == AppDelegate.settingsItem else { return nil }
        let item = NSToolbarItem(itemIdentifier: id)
        item.label = "설정"
        item.paletteLabel = "설정"
        item.toolTip = "설정 (⌘,)"
        if #available(macOS 11.0, *) {
            item.image = NSImage(systemSymbolName: "slider.horizontal.3", accessibilityDescription: "설정")
        }
        item.isBordered = true
        item.target = self
        item.action = #selector(menuSettings)
        return item
    }

    // MARK: 파일 · 폴더 고르기

    func pickFiles(_ b: [String: Any], reply: @escaping (Any?, String?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = (b["multiple"] as? Bool) ?? true
        switch (b["kind"] as? String) ?? "any" {
        case "pdf":
            panel.allowedContentTypes = [UTType.pdf]
            panel.message = "PDF 파일을 골라 주세요"
        case "image":
            panel.allowedContentTypes = [UTType.image]
            panel.message = "사진(JPG · PNG · HEIC)을 골라 주세요"
        default:
            panel.allowedContentTypes = [UTType.pdf, UTType.image]
            panel.message = "PDF나 사진을 골라 주세요"
        }
        panel.prompt = "넣기"
        showMain()
        panel.beginSheetModal(for: window) { r in
            if r == .OK {
                reply(["paths": panel.urls.map { $0.path }], nil)
            } else {
                reply(["paths": [String](), "canceled": true], nil)
            }
        }
    }

    func chooseFolder(_ b: [String: Any], reply: @escaping (Any?, String?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = (b["message"] as? String) ?? "저장할 폴더를 골라 주세요"
        panel.prompt = "여기에 저장"
        if let start = b["start"] as? String, !start.isEmpty {
            panel.directoryURL = URL(fileURLWithPath: start, isDirectory: true)
        }
        showMain()
        panel.beginSheetModal(for: window) { r in
            if r == .OK, let u = panel.url {
                reply(["path": u.path], nil)
            } else {
                reply(["path": "", "canceled": true], nil)
            }
        }
    }

    // MARK: WKWebView

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let cur = webView.url, cur.host == "127.0.0.1" else { return }
        pageReady = true
        if !pendingOpen.isEmpty {
            let paths = pendingOpen
            pendingOpen = []
            // 화면의 첫 준비가 끝날 때까지 조금 기다려요
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in self?.callJS("drop", ["paths": paths]) }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let u = action.request.url else { decisionHandler(.allow); return }
        let scheme = u.scheme ?? ""
        if scheme == "about" || scheme == "data" || scheme == "blob" || u.host == "127.0.0.1" || u.host == "localhost" {
            decisionHandler(.allow)
            return
        }
        // 화면 안으로 파일을 떨어뜨려 생긴 이동(file://)은 막아요 — 화면이 사라지지 않게
        if scheme == "file" {
            decisionHandler(.cancel)
            return
        }
        NSWorkspace.shared.open(u)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = action.request.url, u.scheme == "http" || u.scheme == "https" { NSWorkspace.shared.open(u) }
        return nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard pageURL != nil, !quitting else { return }
        Log.write("⚠️ 화면을 불러오지 못함: \(error.localizedDescription) → 다시 시도")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in self?.reloadPage() }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Log.write("⚠️ 화면 프로세스가 멈춤 → 다시 불러와요")
        reloadPage()
    }

    func webViewDidClose(_ webView: WKWebView) {
        window.orderOut(nil)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "확인")
        a.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "확인")
        a.addButton(withTitle: "취소")
        a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { r in completionHandler(r == .OK ? panel.urls : nil) }
    }

    // MARK: 메뉴

    func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "PaperROAD에 관하여", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        let settings = appMenu.addItem(withTitle: "설정…", action: #selector(menuSettings), keyEquivalent: ",")
        settings.target = self
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "PaperROAD 가리기", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let others = appMenu.addItem(withTitle: "기타 가리기", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        others.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "모두 보기", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "PaperROAD 종료", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let fileItem = NSMenuItem()
        main.addItem(fileItem)
        let file = NSMenu(title: "파일")
        let open = file.addItem(withTitle: "파일 넣기…", action: #selector(menuOpen), keyEquivalent: "o")
        open.target = self
        let home = file.addItem(withTitle: "처음 화면으로", action: #selector(menuHome), keyEquivalent: "")
        home.target = self
        file.addItem(NSMenuItem.separator())
        file.addItem(withTitle: "창 닫기", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileItem.submenu = file

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let edit = NSMenu(title: "편집")
        edit.addItem(withTitle: "실행 취소", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "실행 복귀", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(NSMenuItem.separator())
        edit.addItem(withTitle: "오려두기", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "복사하기", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "붙여넣기", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "모두 선택", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let view = NSMenu(title: "보기")
        let fs = view.addItem(withTitle: "전체 화면", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fs.keyEquivalentModifierMask = [.command, .control]
        view.addItem(NSMenuItem.separator())
        let diag = view.addItem(withTitle: "진단 정보 보기", action: #selector(openDiag), keyEquivalent: "")
        diag.target = self
        viewItem.submenu = view

        let winItem = NSMenuItem()
        main.addItem(winItem)
        let win = NSMenu(title: "윈도우")
        win.addItem(withTitle: "최소화", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "확대/축소", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        win.addItem(NSMenuItem.separator())
        let show = win.addItem(withTitle: "PaperROAD 창 보기", action: #selector(showMain), keyEquivalent: "")
        show.target = self
        winItem.submenu = win

        NSApp.mainMenu = main
        NSApp.windowsMenu = win
    }
}

// MARK: - 시작

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
