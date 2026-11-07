# PaperROAD — notes for Claude

**Read `PROJECT_NOTES.md` first** (structure, decisions, progress checklist) and update it at the end of every task.
PaperROAD is a personal macOS (Apple Silicon) PDF page organizer/converter for **Nevertheless_D**, who is not a programmer.
Talk to them in Korean, in plain words. Never ask them to use Terminal. Never mention GitHub (or the repo name) in anything the user sees.
It follows the same structure as MSROAD (their other ROAD app): a real, visible Dock app (Swift shell `app/shell/main.swift`,
WKWebView window) with a Go engine (`engine/`) that runs as the app's child only while the app is open (app → supervisor → engine).
This follows macOS 27's "Background App Activity" rule — never add hidden helpers, nohup engines or SIGTERM-ignoring.

PDF work is done by pdfcpu v0.11.1 (the newest that builds with Go 1.24, which the Mac build server uses). Page previews and
PDF → image rendering are done in the UI with pdf.js. Images → PDF reuse MSROAD's `pdfout.go` (+ rotation). HEIC → JPEG via `sips`.
`api.DisableConfigDir()` must stay: otherwise pdfcpu may exit the whole process when it can't create its config dir.

The app can only be built on a Mac: pushing changes under app/, engine/ or VERSION triggers `.github/workflows/build-mac.yml`, which builds,
ad-hoc signs, runs real-Mac smoke tests and force-pushes results to the `ci-results` branch (this session's proxy blocks the Actions API,
so read results via git). Release with `scripts/release.sh`. Test recipe for Linux (engine + Playwright) is in PROJECT_NOTES.md.
In tests use `pkill -x`, never `pkill -f paperroad-engine`.

Design was confirmed by the user on 2026-11-08 (Design canvas "PaperROAD 디자인 시안"); colors/fonts/layout are recorded in PROJECT_NOTES.md.
Text must wrap only between words (`word-break: keep-all` everywhere — user request).
