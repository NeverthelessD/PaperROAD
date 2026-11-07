#!/bin/bash
# PaperROAD 맥 빌드 (맥에서만 돌아요 — 맥 빌드 서버 scripts/ci-mac.sh 가 불러요)
#   Go 엔진(darwin/arm64) + Swift 앱 껍데기(app/shell/main.swift) → dist/PaperROAD.app
#   → 앱 전체에 임시 서명(ad-hoc) → dist/PaperROAD-<버전>.zip (업데이트용) · dist/PaperROAD.zip (처음 설치용, 사용 가이드 포함)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(tr -d ' \n' < "$ROOT/VERSION")"
DIST="$ROOT/dist"
APP="$DIST/PaperROAD.app"
rm -rf "$DIST"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "▶ 엔진 테스트 · 빌드 (darwin/arm64, v$VERSION)"
( cd "$ROOT/engine" && go test ./... )
( cd "$ROOT/engine" && CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 \
    go build -trimpath -ldflags "-s -w -X main.build=$VERSION" -o "$APP/Contents/Resources/paperroad-engine" . )
chmod 755 "$APP/Contents/Resources/paperroad-engine"

echo "▶ 앱 껍데기 빌드 (Swift)"
xcrun swiftc --version
xcrun swiftc -O -target arm64-apple-macos12.0 \
  -o "$APP/Contents/MacOS/PaperROAD" "$ROOT/app/shell/main.swift" \
  -framework AppKit -framework WebKit -framework UniformTypeIdentifiers
chmod 755 "$APP/Contents/MacOS/PaperROAD"

echo "▶ 아이콘 (AppIcon.png → AppIcon.icns)"
ICONSET="$DIST/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" "$ROOT/app/AppIcon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z "$d" "$d" "$ROOT/app/AppIcon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
rm -rf "$ICONSET"

sed "s/__VERSION__/$VERSION/g" "$ROOT/app/Info.plist" > "$APP/Contents/Info.plist"
plutil -lint "$APP/Contents/Info.plist"
printf '%s' "$VERSION" > "$APP/Contents/Resources/version.txt"
printf 'APPL????' > "$APP/Contents/PkgInfo"

echo "▶ 임시 서명 (ad-hoc) · 확인"
codesign --force --deep --sign - --timestamp=none "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dv "$APP" 2>&1 | sed 's/^/  /'

echo "▶ 압축"
ditto -c -k --norsrc --keepParent "$APP" "$DIST/PaperROAD-$VERSION.zip"
mkdir -p "$DIST/first/PaperROAD"
ditto "$APP" "$DIST/first/PaperROAD/PaperROAD.app"
[ -f "$ROOT/docs/PaperROAD_사용가이드.png" ] && cp "$ROOT/docs/PaperROAD_사용가이드.png" "$DIST/first/PaperROAD/"
ditto -c -k --norsrc --keepParent "$DIST/first/PaperROAD" "$DIST/PaperROAD.zip"

echo "▶ 업데이트 파일을 풀어도 서명이 그대로인지 확인 (앱의 업데이트 기능처럼 unzip)"
CHECK="$DIST/check"; rm -rf "$CHECK"; mkdir -p "$CHECK"
( cd "$CHECK" && unzip -q "$DIST/PaperROAD-$VERSION.zip" )
codesign --verify --deep --strict "$CHECK/PaperROAD.app"
[ "$(cat "$CHECK/PaperROAD.app/Contents/Resources/version.txt")" = "$VERSION" ]
rm -rf "$CHECK"
echo "✔ dist/PaperROAD-$VERSION.zip · dist/PaperROAD.zip"
