package main

// 엔진 기능 시험: 실제 PDF 를 만들어 합치기 · 순서 · 회전 · 나누기 · 압축 · 사진→PDF 를 확인해요.
// (맥 빌드 서버의 build-mac.sh 가 빌드 전에 돌려요)

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
)

// noisyJPEG makes a photo-like JPEG (hard to compress, so the PDF is big).
func noisyJPEG(t *testing.T, w, h int, seed int64, q int) []byte {
	t.Helper()
	rnd := rand.New(rand.NewSource(seed))
	im := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			v := uint8((x*255)/w) ^ uint8(rnd.Intn(60))
			im.Set(x, y, color.RGBA{v, uint8((y * 255) / h), uint8(rnd.Intn(255)), 255})
		}
	}
	var b bytes.Buffer
	jpeg.Encode(&b, im, &jpeg.Options{Quality: q})
	return b.Bytes()
}

func testPNG(t *testing.T, w, h int) []byte {
	im := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			im.Set(x, y, color.NRGBA{uint8(x), uint8(y), 120, 255})
		}
	}
	var b bytes.Buffer
	png.Encode(&b, im)
	return b.Bytes()
}

// makePDF writes an n-page PDF, each page one photo, pages w×h mm.
func makePDF(t *testing.T, path string, n int, w, h float64, imgW, imgH int) {
	t.Helper()
	imgs := map[string][]byte{}
	spec := &PrintSpec{W: w, H: h}
	for i := 0; i < n; i++ {
		id := string(rune('a' + i))
		imgs[id] = noisyJPEG(t, imgW, imgH, int64(i), 95)
		spec.Pages = append(spec.Pages, PrintPage{Ops: []PrintOp{{Type: "image", ID: id, Box: []float64{10, 10, w - 20, h - 20}}}})
	}
	data, _, err := buildPDF(spec, func(id string, _ int) ([]byte, error) { return imgs[id], nil })
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

type testEnv struct {
	t       *testing.T
	dir     string
	handler http.Handler
}

func newTestEnv(t *testing.T) *testEnv {
	dir := t.TempDir()
	sup := filepath.Join(dir, "support")
	os.MkdirAll(sup, 0o755)
	t.Setenv("PAPERROAD_DOWNLOADS", filepath.Join(dir, "Downloads"))
	app = &App{support: sup, token: "tok"}
	app.loadSettings()
	app.files = NewFiles(sup)
	app.outs = NewOutputs(sup)
	app.upd = &Updater{support: sup, status: "idle"}
	app.comp = NewCompressor(sup)
	app.images = NewImageJobs()
	app.files.cleanWork()
	return &testEnv{t: t, dir: dir, handler: app.routes()}
}

func (e *testEnv) call(path string, in any) map[string]any {
	e.t.Helper()
	b, _ := json.Marshal(in)
	req := httptest.NewRequest("POST", path, bytes.NewReader(b))
	req.Host = "127.0.0.1"
	req.Header.Set("x-token", "tok")
	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	if out == nil {
		out = map[string]any{}
	}
	out["_code"] = rec.Code
	return out
}

func (e *testEnv) open(paths ...string) []map[string]any {
	e.t.Helper()
	res := e.call("/api/open", map[string]any{"paths": paths})
	var items []map[string]any
	for _, x := range res["items"].([]any) {
		items = append(items, x.(map[string]any))
	}
	if errs := res["errors"].([]any); len(errs) > 0 {
		e.t.Fatalf("open errors: %v", errs)
	}
	return items
}

func pageCount(t *testing.T, p string) int {
	t.Helper()
	n, err := api.PageCountFile(p)
	if err != nil {
		t.Fatalf("%s: %v", p, err)
	}
	return n
}

func rotations(t *testing.T, p string) []int {
	t.Helper()
	ctx, err := api.ReadContextFile(p)
	if err != nil {
		t.Fatal(err)
	}
	var out []int
	for i := 1; i <= ctx.PageCount; i++ {
		d, _, inh, err := ctx.XRefTable.PageDict(i, false)
		if err != nil {
			t.Fatal(err)
		}
		r := 0
		if inh != nil {
			r = inh.Rotate
		}
		if o, ok := d.Find("Rotate"); ok {
			if v, err := ctx.XRefTable.DereferenceInteger(o); err == nil && v != nil {
				r = v.Value()
			}
		}
		out = append(out, ((r%360)+360)%360)
	}
	return out
}

func widths(t *testing.T, p string) []int {
	t.Helper()
	dims, err := api.PageDimsFile(p)
	if err != nil {
		t.Fatal(err)
	}
	var out []int
	for _, d := range dims {
		out = append(out, int(d.Width+0.5))
	}
	return out
}

func TestMergeReorderRotate(t *testing.T) {
	e := newTestEnv(t)
	src := filepath.Join(e.dir, "자료")
	os.MkdirAll(src, 0o755)
	a := filepath.Join(src, "회의자료.pdf") // 3쪽, A4 세로
	b := filepath.Join(src, "견적서.pdf")   // 2쪽, 가로로 넓은 쪽 (구분용)
	makePDF(t, a, 3, 210, 297, 300, 400)
	makePDF(t, b, 2, 297, 210, 400, 300)
	items := e.open(a, b)
	if len(items) != 2 || items[0]["pages"].(float64) != 3 || items[1]["pages"].(float64) != 2 {
		t.Fatalf("open: %v", items)
	}
	ia, ib := items[0]["id"].(string), items[1]["id"].(string)
	// 견적서 2쪽 → 회의자료 3쪽(90도) → 회의자료 1쪽 → 견적서 1쪽(180도)  (회의자료 2쪽은 뺌)
	res := e.call("/api/build", map[string]any{"task": "merge", "pages": []map[string]any{
		{"id": ib, "p": 2}, {"id": ia, "p": 3, "r": 90}, {"id": ia, "p": 1}, {"id": ib, "p": 1, "r": 180}}})
	if res["ok"] != true {
		t.Fatalf("build: %v", res)
	}
	out := res["path"].(string)
	if filepath.Base(out) != "견적서_합침.pdf" || filepath.Dir(out) != src { // 첫 페이지의 파일 이름
		t.Fatalf("이름/위치: %s", out)
	}
	if n := pageCount(t, out); n != 4 {
		t.Fatalf("pages %d", n)
	}
	// 폭(회전 반영): 견적서(가로) · 회의자료를 90도 돌림(→ 가로 폭) · 회의자료(세로) · 견적서(가로)
	if got := widths(t, out); got[0] != 842 || got[1] != 842 || got[2] != 595 || got[3] != 842 {
		t.Fatalf("순서(폭): %v", got)
	}
	if got := rotations(t, out); got[0] != 0 || got[1] != 90 || got[2] != 0 || got[3] != 180 {
		t.Fatalf("회전: %v", got)
	}
	// 같은 이름이 있으면 (2)
	res = e.call("/api/build", map[string]any{"task": "merge", "pages": []map[string]any{{"id": ib, "p": 1}, {"id": ia, "p": 1}}})
	if filepath.Base(res["path"].(string)) != "견적서_합침 (2).pdf" {
		t.Fatalf("중복 이름: %v", res["path"])
	}
	// 한 파일 정리(회전 · 삭제) → _정리됨
	res = e.call("/api/build", map[string]any{"task": "organize", "pages": []map[string]any{{"id": ia, "p": 2, "r": 270}, {"id": ia, "p": 1}}})
	if filepath.Base(res["path"].(string)) != "회의자료_정리됨.pdf" || pageCount(t, res["path"].(string)) != 2 {
		t.Fatalf("정리: %v", res)
	}
	if got := rotations(t, res["path"].(string)); got[0] != 270 {
		t.Fatalf("회전 270: %v", got)
	}
	// 원본은 그대로
	if pageCount(t, a) != 3 || pageCount(t, b) != 2 {
		t.Fatal("원본이 바뀜")
	}
	// 최근 작업
	rec := e.call("/api/recent", nil)
	if len(rec["items"].([]any)) != 3 {
		t.Fatalf("recent: %v", rec)
	}
}

func TestSplit(t *testing.T) {
	e := newTestEnv(t)
	p := filepath.Join(e.dir, "계약서.pdf")
	makePDF(t, p, 8, 210, 297, 200, 280)
	id := e.open(p)[0]["id"].(string)

	res := e.call("/api/split", map[string]any{"id": id, "mode": "pick", "pages": []int{6, 2, 3}})
	if res["ok"] != true || filepath.Base(res["path"].(string)) != "계약서_2-3,6쪽.pdf" || pageCount(t, res["path"].(string)) != 3 {
		t.Fatalf("pick: %v", res)
	}
	res = e.call("/api/split", map[string]any{"id": id, "mode": "every", "every": 3})
	if res["ok"] != true || res["folder"] != true || res["count"].(float64) != 3 {
		t.Fatalf("every: %v", res)
	}
	files, _ := filepath.Glob(filepath.Join(res["path"].(string), "*.pdf"))
	if len(files) != 3 || filepath.Base(res["path"].(string)) != "계약서 나눔" {
		t.Fatalf("every files: %v", files)
	}
	if pageCount(t, filepath.Join(res["path"].(string), "계약서_7-8쪽.pdf")) != 2 {
		t.Fatal("마지막 묶음 2쪽")
	}
	res = e.call("/api/split", map[string]any{"id": id, "mode": "range", "ranges": "1-3, 6, 8-"})
	if res["ok"] != true || res["count"].(float64) != 3 || filepath.Base(res["path"].(string)) != "계약서 나눔 (2)" {
		t.Fatalf("range: %v", res)
	}
	if pageCount(t, filepath.Join(res["path"].(string), "계약서_8쪽.pdf")) != 1 {
		t.Fatal("8- 은 8쪽만")
	}
	res = e.call("/api/split", map[string]any{"id": id, "mode": "range", "ranges": "3-12"})
	if res["ok"] != false || !strings.Contains(res["error"].(string), "1~8") {
		t.Fatalf("범위 밖: %v", res)
	}
	res = e.call("/api/split", map[string]any{"id": id, "mode": "pick", "pages": []int{}})
	if res["ok"] != false {
		t.Fatalf("빈 선택: %v", res)
	}
}

func TestCompress(t *testing.T) {
	e := newTestEnv(t)
	p := filepath.Join(e.dir, "사진많은자료.pdf")
	makePDF(t, p, 3, 210, 297, 2600, 3400)
	st, _ := os.Stat(p)
	id := e.open(p)[0]["id"].(string)
	res := e.call("/api/compress/estimate", map[string]any{"id": id})
	if res["ok"] != true {
		t.Fatalf("estimate: %v", res)
	}
	sz := res["sizes"].(map[string]any)
	low, mid, high := int64(sz["low"].(float64)), int64(sz["mid"].(float64)), int64(sz["high"].(float64))
	t.Logf("원본 %d · 가볍게 %d · 보통 %d · 강하게 %d", st.Size(), low, mid, high)
	if !(high < mid && mid < low && low < st.Size()) {
		t.Fatalf("크기 순서가 이상해요: %d %d %d (원본 %d)", low, mid, high, st.Size())
	}
	res = e.call("/api/compress/save", map[string]any{"id": id, "level": "mid"})
	if res["ok"] != true || filepath.Base(res["path"].(string)) != "사진많은자료_압축.pdf" || pageCount(t, res["path"].(string)) != 3 {
		t.Fatalf("save: %v", res)
	}
}

func TestImagesToPDFAndRender(t *testing.T) {
	e := newTestEnv(t)
	dir := filepath.Join(e.dir, "사진")
	os.MkdirAll(dir, 0o755)
	j := filepath.Join(dir, "영수증_01.jpg")
	os.WriteFile(j, noisyJPEG(t, 400, 300, 1, 80), 0o644) // 가로 사진
	pn := filepath.Join(dir, "스캔.png")
	os.WriteFile(pn, testPNG(t, 300, 500), 0o644) // 세로 사진
	items := e.open(j, pn)
	res := e.call("/api/img2pdf", map[string]any{"items": []map[string]any{{"id": items[0]["id"]}, {"id": items[1]["id"], "r": 90}},
		"paper": "a4", "orient": "auto", "margin": "narrow", "name": "사진모음"})
	if res["ok"] != true || filepath.Base(res["path"].(string)) != "사진모음.pdf" {
		t.Fatalf("img2pdf: %v", res)
	}
	// 가로 사진 → 가로 A4, 세로 사진을 90도 돌림 → 가로 A4
	if got := widths(t, res["path"].(string)); got[0] != 842 || got[1] != 842 {
		t.Fatalf("용지 방향: %v", got)
	}
	res = e.call("/api/img2pdf", map[string]any{"items": []map[string]any{{"id": items[1]["id"]}}, "paper": "photo", "margin": "none"})
	if res["ok"] != true || filepath.Base(res["path"].(string)) != "사진모음 (2).pdf" {
		t.Fatalf("photo: %v", res)
	}

	// PDF → 그림 (화면이 그린 그림을 저장)
	p := filepath.Join(e.dir, "계약서.pdf")
	makePDF(t, p, 3, 210, 297, 100, 140)
	id := e.open(p)[0]["id"].(string)
	b := e.call("/api/images/begin", map[string]any{"id": id, "ext": "jpg", "count": 2, "task": "jpg"})
	job := b["job"].(string)
	for _, pg := range []string{"1", "3"} {
		req := httptest.NewRequest("POST", "/api/images/put?job="+job+"&p="+pg, bytes.NewReader(noisyJPEG(t, 50, 70, 2, 80)))
		req.Host = "127.0.0.1"
		req.Header.Set("x-token", "tok")
		rec := httptest.NewRecorder()
		e.handler.ServeHTTP(rec, req)
		if rec.Code != 200 {
			t.Fatalf("put: %s", rec.Body.String())
		}
	}
	end := e.call("/api/images/end", map[string]any{"job": job})
	if end["ok"] != true || filepath.Base(end["path"].(string)) != "계약서 JPG" || end["count"].(float64) != 2 {
		t.Fatalf("end: %v", end)
	}
	if !fileExists(filepath.Join(end["path"].(string), "계약서_3쪽.jpg")) {
		t.Fatal("계약서_3쪽.jpg 없음")
	}
}

func TestSaveToSettings(t *testing.T) {
	e := newTestEnv(t)
	p := filepath.Join(e.dir, "a.pdf")
	makePDF(t, p, 1, 100, 100, 50, 50)
	id := e.open(p)[0]["id"].(string)
	e.call("/api/settings", map[string]any{"saveTo": "downloads"})
	res := e.call("/api/build", map[string]any{"pages": []map[string]any{{"id": id, "p": 1}}})
	if filepath.Dir(res["path"].(string)) != filepath.Join(e.dir, "Downloads") {
		t.Fatalf("downloads: %v", res["path"])
	}
	e.call("/api/settings", map[string]any{"saveTo": "ask"})
	res = e.call("/api/build", map[string]any{"pages": []map[string]any{{"id": id, "p": 1}}})
	if res["ok"] != false {
		t.Fatalf("ask 인데 폴더 없음: %v", res)
	}
	other := filepath.Join(e.dir, "고른폴더")
	os.MkdirAll(other, 0o755)
	res = e.call("/api/build", map[string]any{"pages": []map[string]any{{"id": id, "p": 1}}, "dir": other})
	if filepath.Dir(res["path"].(string)) != other {
		t.Fatalf("ask: %v", res)
	}
	// 다룰 수 없는 파일 · 손상된 PDF
	bad := filepath.Join(e.dir, "메모.txt")
	os.WriteFile(bad, []byte("x"), 0o644)
	broken := filepath.Join(e.dir, "깨짐.pdf")
	os.WriteFile(broken, []byte("%PDF-1.4 broken"), 0o644)
	r := e.call("/api/open", map[string]any{"paths": []string{bad, broken}})
	if len(r["errors"].([]any)) != 2 {
		t.Fatalf("errors: %v", r)
	}
}

func TestParseRanges(t *testing.T) {
	s, err := parseRanges("1-3, 6，8-", 10)
	if err != nil || len(s) != 3 || s[2].from != 8 || s[2].to != 10 {
		t.Fatalf("%v %v", s, err)
	}
	if _, err := parseRanges("가나다", 10); err == nil {
		t.Fatal("잘못된 글자")
	}
	if compactPages([]int{6, 2, 3, 9, 10, 11}) != "2-3,6,9-11" {
		t.Fatal(compactPages([]int{6, 2, 3, 9, 10, 11}))
	}
}
