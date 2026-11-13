> **이 파일을 읽은 Claude는 작업이 끝날 때마다 이 파일을 업데이트할 것.**
> (구조가 바뀌면 「구조」, 새로 정한 것은 「결정 사항」, 한 일·남은 일은 「진행 사항」에 적고 커밋·푸시까지 할 것)

# PaperROAD — 프로젝트 노트

PDF 페이지 정리 · 변환 앱. macOS (Apple Silicon). made by. Nevertheless_D
사용자는 개발자가 아니에요. 한국어로 쉽게 설명하고, 터미널 사용을 요구하지 말 것. 결과물은 더블클릭으로 쓸 수 있게.

---

## 진행 사항

작업이 중간에 끊기면 아래 체크리스트에서 **처음으로 체크 안 된 항목부터** 이어서 하면 돼요. 각 단계가 끝날 때마다 커밋 · 푸시.

- [x] 0. 사용자와 기능 정하기 (페이지 정리 앱: 합치기 · 순서, 분할 · 추출, 회전 · 삭제, 압축 · 이미지 변환 / 이름 PaperROAD / 작업 고르고 시작)
- [x] 1. 디자인 시안 (Design 캔버스 'PaperROAD 디자인 시안') → 수정 4번 → 2026-11-08 사용자 "확정"
- [x] 2. 저장소 뼈대 (이 파일, CLAUDE.md, VERSION, .gitignore, README)
- [x] 3. 엔진: 파일 넣기 · 합치기/순서/회전/삭제 · 분할 · 압축 · 그림 저장 · 이미지→PDF · 저장 위치 · 최근 작업 · 업데이트 · 지킴이 · 진단 (go test 통과)
- [x] 4. 화면: 시안 8개 화면 그대로 (라이트/다크), pdf.js 썸네일, 끌어서 순서, 단축키, 설정 창
- [x] 5. 맥 앱 껍데기(Swift): Dock 앱 · 파일/폴더 고르기 창 · Finder 끌어 놓기 · Dock 아이콘에 떨어뜨리기 · 투명 제목 막대 + 설정 단추
- [x] 6. 리눅스에서 Playwright 로 모든 흐름 시험 (합치기 · 회전 · 끌기 · 지우기/되돌리기 · 분할 4가지 · 압축 · PDF→PNG · 사진→PDF · 매번 물어보기)
- [x] 7. 사용 가이드 이미지 (docs/PaperROAD_사용가이드.png)
- [x] 8. 맥 빌드 서버: build=ok · smoke=ok (24/24, macOS 15 · Apple Silicon), 스크린샷이 시안과 같음 확인
- [x] 9. v1.0.0 release.sh → releases/ · download/ · 커밋 · 푸시, '앱 받기' 링크 확인
- [x] 10. v1.1.0 (사용자 요청): 창이 앞에 있을 때 맨 위를 잡아도 창이 안 옮겨짐 → main.swift DragStrip(맨 위 52pt) · smoke M1(scripts/drag-test.swift)
      · ⌫ 뒤로 가기(ROAD 앱 공통, 고른 페이지 · 사진이 있으면 ⌫ 는 지우기가 먼저, ⌘[ 도 뒤로) → 맥 빌드 서버 통과(M1 창 옮기기 실제 확인) · 내보냄

### 다음에 할 수 있는 일
- [ ] 사용자 맥에서 실제로 써 보기 (끌어 놓기 · 파일 선택 창 · 저장 위치 · HEIC)

### 작업 기록
- 2026-11-13 v1.1.0 — 사용자 제보: 창이 선택(활성)된 상태에서는 창 위쪽을 잡아 옮길 수 없고, 다른 창을 눌렀다 오면 됨.
  원인: fullSizeContentView + 투명 제목 막대라 WKWebView 가 제목 막대 밑까지 덮음. 활성 창에서는 맥이 그 누름을 WKWebView 에 넘기는데
  WKWebView 는 창 옮기기를 허락하지 않음(비활성일 때 첫 누름은 맥이 '창 앞으로 + 끌기'로 직접 처리해서 됐던 것). DayROAD v1.2.0 과 같은 문제.
  해결: DayROAD 와 같은 투명 DragStrip(52pt = 통합 도구 막대 높이, 화면 .titlebar 52px 와 같음, performDrag · 두 번 누르기는 맥 설정대로).
  '설정' 단추 · 신호등은 제목 막대 위라 그대로 눌림. 같은 날 ⌫ 뒤로 가기(road-app-skill 공통 규칙)도 넣음.
- 2026-11-08 v1.0.1 — 사용자 제보: 불러온 파일을 빼는 기능이 없음. 모든 화면에 '목록에서 빼기'(원본 파일은 그대로) + 되돌리기 알림:
  합치기 = 파일 카드 ✕ 를 잘 보이게(흐린 색 → muted) + '모두 빼기'(⌘Z 로도 되돌림) · 분할 / 압축·변환 = 도구 줄 '✕ 빼기' ·
  이미지 → PDF = 사진 칸 오른쪽 위 ✕(늘 보임) + '모두 빼기'. 빼기 알림은 마지막 것만, 다른 화면으로 가면 '되돌리기' 알림은 치움.
  화면에서만 빼요(엔진의 넣은 파일 목록은 그대로 → 되돌리기 가능, 다음 실행 때 정리).
- 2026-11-08 v1.0.0 — 첫 버전 (디자인 확정 뒤 제작). 맥 빌드 서버 첫 실행에서 24/24 통과.
  실제 맥 스크린샷(shot-merge · shot-img2pdf-dark · shot-split · shot-open-with)에서 WKWebView 안 pdf.js 썸네일 · HEIC · 투명 제목 막대 + 설정 단추 확인.
  참고: 시험용 HEIC 는 투명 PNG 를 바꾼 것이라 모서리가 검게 보여요(앱 문제 아님).

## 구조

```
app/shell/main.swift   PaperROAD.app 본체(Swift/AppKit): Dock 아이콘 · 메뉴(파일 넣기 ⌘O · 설정 ⌘,) · WKWebView 창 ·
                       엔진 실행/종료 · Dock 다시 열기 · 업데이트 후 다시 열기(restart-requested → NSWorkspace) · launcher.log
                       Bridge('paperroad'): pickFiles(NSOpenPanel) · chooseFolder(NSOpenPanel 폴더)
                       PaperWebView: Finder 에서 끌어 온 파일 경로 → PR.native('drop', {paths, x, y}) (끄는 동안 'dragOver')
                       application(open:) : Dock 아이콘에 떨어뜨리기 · '다음으로 열기' → 같은 drop
                       창: 제목 막대 투명 + fullSizeContentView + NSToolbar(통합형, 오른쪽 '설정' 단추) → 화면 머리와 하나로 보임
app/Info.plist         LSUIElement 없음, NSAllowsLocalNetworking, 자동/갑작스런 종료 끔, CFBundleDocumentTypes(PDF · 사진, Alternate)
app/AppIcon.svg/png    아이콘 원본 (build-mac.sh 가 sips + iconutil 로 icns 를 만들어요)
engine/main.go         설정(settings.json: appearance · autoUpdate · saveTo · ui) · 라우트 · 127.0.0.1:47931 + 토큰
engine/supervise.go    지킴이 (MSROAD 와 같음): 엔진을 자식으로, '고장'일 때만 다시 켬, 종료 신호는 항상 따름, 앱이 사라지면 끝
engine/files.go        넣은 파일 목록(메모리) · /api/open(경로) · /api/upload(경로 모를 때) · /api/pick · /api/choose-folder(osascript, 시험 env)
                       · /api/file(pdf.js · 그림) · HEIC → JPEG(sips, Support/work/heic)
engine/pdfops.go       /api/build: 페이지 목록(파일 · 쪽 · 회전) → MergeCreateFile → CollectFile(순서) → RotateFile(각도별)
                       /api/split: pick(고른 쪽 → <이름>_2-3,6쪽.pdf) · every · range("1-3, 6, 8-") → "<이름> 나눔" 폴더
engine/compress.go     그림 다시 저장(긴 변 2400/1700/1100px · JPEG 85/72/55) · 세 단계를 미리 만들어 크기를 보여 줌
engine/imagejobs.go    PDF → 그림: 화면(pdf.js)이 그린 그림을 받아 저장 (begin → put × N → end, 여러 장이면 "<이름> JPG" 폴더)
engine/img2pdf.go      사진 → PDF 배치 (용지 photo/a4/letter · 방향 · 여백) → pdfout.go
engine/pdfout.go       MSROAD 의 그림 → PDF 쓰기 + 회전(Rot) + 쪽마다 다른 용지 크기(geo)
engine/outputs.go      저장 위치(beside · downloads · ask) · 같은 이름이면 " (2)" · 최근 작업(recent.json 12개) · Finder 에서 보기
engine/update.go       자동 업데이트 (MSROAD 와 같음, releases/latest.json, backup.noindex)
engine/diag.go         /diag 진단 페이지 · requests.log · alive/clean-exit
engine/ops_test.go     실제 PDF 로 모든 작업 시험 (빌드 서버도 빌드 전에 돌림)
engine/web/            index.html · css/app.css(토큰 · 라이트/다크) · js/core.js(엔진 요청 · 파일 넣기 · 썸네일 · 알림)
                       · js/screens.js(화면 6개 + 설정) · js/main.js(누르기 · 끌기 · 단축키 · 시작) · fonts · vendor/pdfjs(4.10.38)
scripts/build-mac.sh   (맥 전용) Go + Swift → 번들 → 아이콘 → codesign --deep -s - → zip 2개
scripts/smoke-mac.sh   (맥 전용) 켜기 · 자식 관계 · 실제 PDF 작업(HEIC 포함) · 화면 스크린샷 3장 · 다시 열기 · '다음으로 열기' · 고장 복구 · ⌘Q · 종료 · 강제 종료 · 업데이트 재실행
scripts/ci-mac.sh      빌드 서버 진입점 → ci-results 브랜치에 결과
scripts/release.sh     ci-results 확인 → releases/PaperROAD-<v>.zip · latest.json · download/PaperROAD.zip(publish-download.sh)
scripts/guide.py       docs/guide.html → docs/PaperROAD_사용가이드.png
```
엔진 실행 사슬: PaperROAD.app(Swift, Dock) → paperroad-engine(지킴이, PAPERROAD_SUPERVISOR=1) → paperroad-engine(엔진, PAPERROAD_CHILD=1).
기록: ~/Library/Application Support/PaperROAD/{launcher.log, requests.log, engine.log, engine.out, settings.json, recent.json}

### 리눅스에서 시험하는 법
```
cd engine && go test ./... && go build -o /tmp/pr-engine .
PAPERROAD_SUPPORT=/tmp/prsup PAPERROAD_TOKEN=tok PAPERROAD_PORT=47931 PAPERROAD_DOWNLOADS=/tmp/dl \
PAPERROAD_TEST_PICK="/path/a.pdf|/path/b.jpg" PAPERROAD_TEST_CHOOSE=/tmp/out PAPERROAD_UPDATE_URL=http://127.0.0.1:1/x /tmp/pr-engine
```
→ Playwright 로 `http://127.0.0.1:47931/?t=tok`. 맥 껍데기의 끌어 놓기는 `PR.native('drop', {paths:[...], x, y})` 로 흉내 내요.
HEIC 는 리눅스에 sips 가 없어서 맥 빌드 서버에서만 시험돼요.
맥 빌드 서버 화면 시험: settings.json 의 `ui.smoke = {screen, paths}` 면 그 화면을 파일과 함께 열어요 (사용자는 안 씀).

## 결정 사항

- **디자인 (2026-11-08 확정)**: 종이처럼 깨끗한 흰 바탕 + 잉크 파랑. 라이트 #F6F7F9(바탕) · #FFFFFF(면) · #16181D(글자) · #5B6270(흐린 글자) ·
  #E3E6EB(선) · 강조 #2C4BDB / 다크 #121417 · #1B1E23 · #ECEEF2 · #A1A8B4 · #2C313A · 강조 #7C95FF. 노란 접힌 모서리 #F2B807(로고).
  형식 배지: PDF 빨강 #C62828 · JPG/PNG/HEIC 초록 #0F7A6F — 카드 · 썸네일 · 작업 화면 제목 옆에 '무엇이 무엇으로' 보이게.
  글꼴: 본문 IBM Plex Sans KR(400/500/600/700) · 제목/로고 Gothic A1 ExtraBold — 둘 다 OFL, 앱 안에 넣음.
  첫 화면: 머리 그림(PDF → JPG) + 작업 카드 5개(가로로 넓은 2열) + 6번째 칸 '파일 놓는 곳' + 최근 작업.
  작업 화면: 위 도구 줄(처음으로 · 제목 · 형식 흐름 · 단추) / 가운데 썸네일 / 옆 칸(파일 목록 또는 선택지, 저장 단추는 늘 아래에 보이게) / 아래 줄.
  **단어 단위로만 줄바꿈**(word-break: keep-all, 모든 요소) — 사용자 요청.
- '빼기'는 늘 '목록에서 빼기'예요 — 디스크의 원본 파일은 절대 지우지 않아요. 빼면 '되돌리기' 알림을 보여 줘요.
- '회전 · 삭제'는 합치기 화면과 같은 화면(제목만 다름, 저장 이름 _정리됨). 페이지를 누르면 아래에 회전 · 삭제 단추.
- '이미지 → PDF'는 첫 화면 카드로 따로 (사용자 요청). '압축 · PDF → 이미지' 화면에는 이미지 → PDF 탭이 없어요.
- 분할의 'JPG 저장': 전체 / 고른 페이지만, 화질 보통(150dpi) · 선명(300dpi), 이름 <이름>_<쪽>쪽.jpg.
- 결과 이름: _합침(여러 파일, 첫 페이지의 파일 이름) · _정리됨 · _2-3,6쪽 · "<이름> 나눔"/<이름>_1-3쪽 · _압축 · "<이름> JPG|PNG" · 사진모음(바꿀 수 있음).
  같은 이름이 있으면 덮어쓰지 않고 " (2)". 원본은 절대 바꾸지 않아요.
- 저장 위치 기본은 '원본 파일 옆'. 원본 폴더를 모르거나 쓸 수 없으면 다운로드 폴더.
- 화면에 GitHub · 저장소 이름을 쓰지 않아요 ("새 버전이 나오면 앱이 알아서 받아요"). 화면 아래 made by. Nevertheless_D.
- 커밋 작성자: `Nevertheless_D <NeverthelessD@users.noreply.github.com>`

## 업데이트 내보내는 법 (Claude용)

1. 수정 → `VERSION` 올리기 → 커밋 · 푸시 (app/ · engine/ · VERSION 이 바뀌면 맥 빌드 서버가 자동으로 돎, 5~10분)
2. `git ls-remote origin ci-results` 가 바뀔 때까지 기다린 뒤 결과 확인:
   `git fetch origin +refs/heads/ci-results:refs/remotes/origin/ci-results && git archive origin/ci-results | tar -x -C <임시폴더>`
   → status.json(build/smoke 모두 ok), results.txt, shot-*.png 확인
3. `scripts/release.sh --notes "바뀐 점 1" "바뀐 점 2"` → 커밋 · 푸시. 처음 설치용은 download/PaperROAD.zip(최신판 1개만).
4. 맥 기계가 배정되지 않으면 워크플로 파일을 조금 바꿔 다시 푸시.
