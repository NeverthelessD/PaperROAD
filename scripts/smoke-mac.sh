#!/bin/bash
# PaperROAD 실제 맥 시험 (맥 빌드 서버에서 dist/PaperROAD.app 을 /Applications 에 깔고 여러 상황을 시험해요)
# 결과: $OUT/results.txt (PASS/FAIL 한 줄씩), 스크린샷, 기록 파일
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$ROOT/ci-out}"
mkdir -p "$OUT"
APPDIR="/Applications/PaperROAD.app"
SUP="$HOME/Library/Application Support/PaperROAD"
RES="$OUT/results.txt"
: > "$RES"

pass() { echo "PASS  $*" | tee -a "$RES"; }
fail() { echo "FAIL  $*" | tee -a "$RES"; }
check() { local name="$1"; shift; if "$@"; then pass "$name"; else fail "$name"; fi; }

app_pid() { pgrep -x PaperROAD | head -1; }
engines() { pgrep -x paperroad-engine | tr '\n' ' '; }
tok() { cat "$SUP/token" 2>/dev/null; }
port() { cat "$SUP/port" 2>/dev/null; }
API() { echo "http://127.0.0.1:$(port)"; }
ping_ok() { curl -fs -m 2 -H "x-token: $(tok)" "$(API)/api/ping" >/dev/null 2>&1; }
wait_ready() { for _ in $(seq 1 60); do [ -s "$SUP/port" ] && ping_ok && return 0; sleep 0.5; done; return 1; }
wait_gone() { for _ in $(seq 1 30); do [ -z "$(app_pid)" ] && [ -z "$(engines)" ] && return 0; sleep 0.5; done; return 1; }
snap() { echo "--- $1"; ps -axo pid,ppid,stat,comm | grep -E "PaperROAD|paperroad-engine" | grep -v grep; } >> "$OUT/procs.txt"
launch() { open "$APPDIR"; wait_ready; }
quit_app() { osascript -e 'tell application "PaperROAD" to quit' >/dev/null 2>&1; wait_gone; }
post() { curl -fs -X POST -H "x-token: $(tok)" -H 'content-type: application/json' --data "$2" "$(API)$1"; }
jget() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1" 2>/dev/null; }
settings() { # settings.json (시험용 ui.smoke 는 그 화면을 파일과 함께 열어요)
  printf '{"appearance":"%s","autoUpdate":false,"saveTo":"beside","ui":%s}' "$1" "$2" > "$SUP/settings.json"
}

echo "▶ 준비: 앱 설치 · 시험 파일"
rm -rf "$APPDIR"; ditto "$ROOT/dist/PaperROAD.app" "$APPDIR"
T="$HOME/PaperROAD-시험"; rm -rf "$T"; mkdir -p "$T"
printf '회의 자료\n\n1쪽 — 한글 글자가 PDF 안에 그대로 들어 있어요.\n\f2쪽 — 두 번째 페이지\n\f3쪽 — 세 번째 페이지\n' > "$T/회의자료.txt"
cupsfilter "$T/회의자료.txt" > "$T/회의자료.pdf" 2>/dev/null
cp "$ROOT/app/AppIcon.png" "$T/사진.png"
sips -s format jpeg "$ROOT/app/AppIcon.png" --out "$T/사진.jpg" >/dev/null 2>&1
sips -s format heic "$ROOT/app/AppIcon.png" --out "$T/사진.heic" >/dev/null 2>&1
ls -la "$T" > "$OUT/test-files.txt"
mkdir -p "$SUP"
settings light '{}'

echo "▶ A. 켜기 · 화면"
launch; check "A1 앱을 열면 엔진이 준비됨" ping_ok
check "A2 엔진이 Dock 앱 방식으로 켜짐(shell=native)" bash -c "curl -fs -H 'x-token: $(tok)' $(API)/api/ping | grep -q '\"shell\":\"native\"'"
check "A3 주소가 47931" test "$(port)" = "47931"
sleep 6
screencapture -x "$OUT/shot-home.png"
check "A4 화면이 앱 창(WKWebView)에서 열림" grep -q "PaperROADShell" "$SUP/requests.log"
APID=$(app_pid); snap "A 실행 중"
SUPPID=$(ps -axo pid=,ppid=,comm= | awk -v a="$APID" '$2==a && /paperroad-engine/ {print $1}' | head -1)
CHILD=$(ps -axo pid=,ppid=,comm= | awk -v s="$SUPPID" '$2==s && /paperroad-engine/ {print $1}' | head -1)
check "A5 엔진이 PaperROAD 앱의 자식 (앱 $APID → 지킴이 ${SUPPID:-없음} → 엔진 ${CHILD:-없음})" test -n "$SUPPID" -a -n "$CHILD"

echo "▶ P. PDF 작업 (실제 맥에서)"
check "P0 시험 PDF(한글) 만들기 (cupsfilter)" test -s "$T/회의자료.pdf"
R=$(post /api/open "{\"paths\":[\"$T/회의자료.pdf\",\"$T/사진.png\",\"$T/사진.jpg\",\"$T/사진.heic\"]}")
echo "$R" > "$OUT/open.json"
PDFID=$(echo "$R" | jget "[i['id'] for i in d['items'] if i['kind']=='pdf'][0]")
PAGES=$(echo "$R" | jget "[i['pages'] for i in d['items'] if i['kind']=='pdf'][0]")
IMGS=$(echo "$R" | jget "','.join('\"'+i['id']+'\"' for i in d['items'] if i['kind']=='image')")
NIMG=$(echo "$R" | jget "len([i for i in d['items'] if i['kind']=='image'])")
check "P1 PDF 와 사진 3장(PNG · JPG · HEIC)을 넣음 (PDF ${PAGES:-?}쪽, 사진 ${NIMG:-?}장)" test -n "$PDFID" -a "${NIMG:-0}" = "3"
R=$(post /api/img2pdf "{\"items\":[$(echo "$IMGS" | sed 's/"\([^"]*\)"/{"id":"\1"}/g')],\"paper\":\"a4\",\"orient\":\"auto\",\"margin\":\"narrow\",\"name\":\"사진모음\"}")
echo "$R" > "$OUT/img2pdf.json"
IMGPDF=$(echo "$R" | jget "d['path']")
check "P2 사진 3장(HEIC 포함) → PDF" test -s "$IMGPDF"
R=$(post /api/open "{\"paths\":[\"$IMGPDF\"]}"); IMGPDFID=$(echo "$R" | jget "d['items'][0]['id']")
R=$(post /api/build "{\"task\":\"merge\",\"pages\":[{\"id\":\"$IMGPDFID\",\"p\":3,\"r\":90},{\"id\":\"$PDFID\",\"p\":1},{\"id\":\"$IMGPDFID\",\"p\":1}]}")
echo "$R" > "$OUT/build.json"
MERGED=$(echo "$R" | jget "d['path']")
check "P3 두 PDF 합치기 · 순서 · 회전 → $(basename "${MERGED:-없음}")" test -s "$MERGED"
R=$(post /api/open "{\"paths\":[\"$MERGED\"]}")
check "P4 합친 PDF 가 3쪽" test "$(echo "$R" | jget "d['items'][0]['pages']")" = "3"
R=$(post /api/split "{\"id\":\"$IMGPDFID\",\"mode\":\"every\",\"every\":1}")
check "P5 나누기 (1쪽씩 → 3개)" test "$(echo "$R" | jget "d['count']")" = "3"
R=$(post /api/compress/estimate "{\"id\":\"$IMGPDFID\"}"); echo "$R" > "$OUT/compress.json"
check "P6 용량 줄이기 크기 계산" test -n "$(echo "$R" | jget "d['sizes']['mid']")"
cp "$MERGED" "$OUT/merged.pdf" 2>/dev/null

echo "▶ S. 앱 화면 (WKWebView 안에서 pdf.js 썸네일)"
quit_app
settings light "{\"smoke\":{\"screen\":\"merge\",\"paths\":[\"$MERGED\",\"$T/회의자료.pdf\"]}}"
launch; sleep 9
screencapture -x "$OUT/shot-merge.png"
check "S1 합치기 화면에서 PDF 2개를 읽음" bash -c "grep -c 'POST /api/open' '$SUP/requests.log' | awk '{exit !(\$1>=1)}'"
quit_app
settings dark "{\"smoke\":{\"screen\":\"img2pdf\",\"paths\":[\"$T/사진.png\",\"$T/사진.jpg\",\"$T/사진.heic\"]}}"
launch; sleep 8
screencapture -x "$OUT/shot-img2pdf-dark.png"
quit_app
settings light "{\"smoke\":{\"screen\":\"split\",\"paths\":[\"$IMGPDF\"]}}"
launch; sleep 8
screencapture -x "$OUT/shot-split.png"
quit_app
settings light '{}'

echo "▶ B. Dock 아이콘 다시 누르기(reopen)"
launch; APID=$(app_pid)
osascript -e 'tell application "PaperROAD" to reopen' >/dev/null 2>&1; sleep 1
check "B1 다시 열기 뒤에도 앱·엔진 그대로" test "$(app_pid)" = "$APID"

echo "▶ M. 창이 앞에 있을 때 맨 위를 잡고 끌어서 옮기기"
osascript -e 'tell application "PaperROAD" to activate' >/dev/null 2>&1; sleep 1
screencapture -x "$OUT/shot-drag-before.png"
MOVE=$(swift "$ROOT/scripts/drag-test.swift" PaperROAD 2>&1 | tail -1)
screencapture -x "$OUT/shot-drag-after.png"
echo "$MOVE" > "$OUT/drag-test.txt"
case "$MOVE" in
  moved*) pass "M1 창 맨 위를 끌면 창이 움직임 ($MOVE)" ;;
  *) echo "INFO  M1 창 옮기기를 확인하지 못함 ($MOVE) — 빌드 서버가 마우스 흉내를 막았을 수 있어요" | tee -a "$RES" ;;
esac

echo "▶ O. Finder 에서 PDF 를 앱으로 열기 ('다음으로 열기' · Dock 에 떨어뜨리기)"
open -a "$APPDIR" "$T/회의자료.pdf"; sleep 3
screencapture -x "$OUT/shot-open-with.png"
check "O1 앱이 파일을 받아 넣음" bash -c "tail -40 '$SUP/launcher.log' | grep -q '파일 열기 요청'"
check "O2 앱은 하나만" test "$(pgrep -x PaperROAD | wc -l | tr -d ' ')" = "1"

echo "▶ C. 엔진이 고장으로 꺼지면 지킴이가 다시 켬"
SUPPID=$(ps -axo pid=,ppid=,comm= | awk -v a="$APID" '$2==a && /paperroad-engine/ {print $1}' | head -1)
CHILD=$(ps -axo pid=,ppid=,comm= | awk -v s="$SUPPID" '$2==s && /paperroad-engine/ {print $1}' | head -1)
kill -SEGV "$CHILD" 2>/dev/null; sleep 4
check "C1 엔진 다시 켜짐" ping_ok
check "C2 앱은 그대로" test "$(app_pid)" = "$APID"

echo "▶ D. 앱 종료(⌘Q) → 엔진까지 모두 꺼짐"
osascript -e 'tell application "PaperROAD" to quit' >/dev/null 2>&1
check "D1 앱·엔진 모두 꺼짐" wait_gone
snap "D 종료 뒤"

echo "▶ E. 화면의 '종료'(= /api/quit) → 앱도 꺼짐"
launch
curl -fs -X POST -H "x-token: $(tok)" "$(API)/api/quit" >/dev/null
check "E1 앱·엔진 모두 꺼짐" wait_gone

echo "▶ F. 앱이 강제로 꺼지면 엔진도 스스로 꺼짐"
launch; kill -9 "$(app_pid)"; sleep 1
check "F1 남은 엔진 없음" bash -c 'for i in $(seq 1 20); do [ -z "$(pgrep -x paperroad-engine)" ] && exit 0; sleep 0.5; done; exit 1'

echo "▶ G. 업데이트 뒤 다시 열기 (/api/update/restart)"
launch; OLD=$(app_pid)
curl -fs -X POST -H "x-token: $(tok)" "$(API)/api/update/restart" >/dev/null
sleep 3
check "G1 새로 열린 앱이 엔진을 켬" wait_ready
NEW=$(app_pid)
check "G2 앱이 새로 열림 ($OLD → ${NEW:-없음})" test -n "$NEW" -a "$NEW" != "$OLD"
check "G3 앱 하나만 떠 있음" test "$(pgrep -x PaperROAD | wc -l | tr -d ' ')" = "1"
quit_app

echo "▶ 기록 모으기"
for f in launcher.log requests.log engine.log engine.prev.log engine.out engine.prev.out settings.json; do
  [ -f "$SUP/$f" ] && cp "$SUP/$f" "$OUT/$f"
done
sw_vers > "$OUT/macos.txt"
echo
echo "== 결과 =="; cat "$RES"
! grep -q '^FAIL' "$RES"
