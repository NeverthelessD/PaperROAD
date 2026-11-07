# PaperROAD

## ⬇️ 앱 받기

**[PaperROAD.zip 받기 (macOS · Apple Silicon)](https://github.com/NeverthelessD/PaperROAD/raw/main/download/PaperROAD.zip)**

항상 가장 최신판이에요. zip 안에 앱과 사용 가이드가 함께 들어 있어요.

PDF 페이지 정리 · 변환 앱 (macOS · Apple Silicon) — made by. Nevertheless_D

- **합치기 · 순서 바꾸기**: 여러 PDF를 넣고 페이지를 끌어서 순서를 정해 하나로 저장
- **분할 · 페이지 추출**: 고른 페이지만 새 PDF로 · 몇 쪽씩 · 범위(1-3, 6, 8-)로 나누기 · 전체나 고른 페이지를 JPG로
- **회전 · 삭제**: 페이지를 눌러 돌리기 · 지우기 (여러 쪽 함께, ⌘Z 되돌리기)
- **압축 · PDF → 이미지**: 가볍게 · 보통 · 강하게 (줄어든 크기를 미리 보여 줌) · PDF를 JPG · PNG로
- **이미지 → PDF**: JPG · PNG · HEIC 사진을 순서대로 모아 PDF 한 파일로 (용지 · 방향 · 여백)
- **원본은 그대로**: 결과는 늘 새 파일로 (원본 옆 · 다운로드 · 매번 물어보기)
- **화면**: 맥 설정 따르기(기본) / 라이트 / 다크
- **자동 업데이트**: 새 버전이 나오면 앱이 알아서 받아요

## 설치

1. 위의 **앱 받기**에서 `PaperROAD.zip`을 받아 압축을 풀어요. (안에 앱과 사용 가이드가 들어 있어요)
2. `PaperROAD.app`을 **응용 프로그램** 폴더로 옮겨요. (업데이트가 동작하려면 꼭 옮겨 주세요)
3. 처음 열 때 경고가 뜨면 **시스템 설정 → 개인정보 보호 및 보안 → "그래도 열기"**.

사용 가이드: [`docs/PaperROAD_사용가이드.png`](docs/PaperROAD_사용가이드.png)

앱 설정은 `~/Library/Application Support/PaperROAD` 한 폴더에만 저장돼요. 지우려면 앱을 휴지통에 버리고 그 폴더도 지우면 끝이에요.

## 사용한 오픈소스

- [pdfcpu](https://github.com/pdfcpu/pdfcpu) (Apache-2.0) — PDF 합치기 · 나누기 · 회전 · 압축
- [PDF.js](https://github.com/mozilla/pdf.js) (Apache-2.0) — 페이지 미리보기 · PDF → 이미지
- 글꼴: [IBM Plex Sans KR](https://github.com/IBM/plex), [Gothic A1](https://fonts.google.com/specimen/Gothic+A1) (SIL OFL)

## 폴더 구조

```
app/        PaperROAD.app 껍데기 (Swift · Info.plist · 아이콘)
engine/     Go 엔진 (로컬 서버 · PDF 작업 · 업데이트) + engine/web 앱 화면
scripts/    맥 빌드 · 시험 · 릴리스 · 사용 가이드 이미지
releases/   업데이트 파일 (PaperROAD-x.y.z.zip · latest.json)
download/   처음 설치용 zip (최신판 1개)
docs/       사용 가이드 이미지와 원본(guide.html)
```

자세한 구조 · 결정 사항 · 진행 상황은 [`PROJECT_NOTES.md`](PROJECT_NOTES.md)에 있어요.
