package main

// 넣은 파일 목록
//
// 사용자가 고르거나 끌어다 놓은 파일을 엔진이 기억해요 (앱이 켜져 있는 동안만).
//   - 맥 앱: 껍데기(Swift)가 파일 선택 창 · 끌어 놓기로 '경로'를 알려 줘요 → /api/open
//   - 경로를 모를 때(브라우저 시험 등): 화면이 파일 내용을 올려요 → /api/upload (Support/inbox 에 보관)
// 원본 파일은 절대 바꾸지 않아요. 모든 결과는 새 파일로 저장해요.

import (
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"golang.org/x/text/unicode/norm"
)

type Item struct {
	ID       string `json:"id"`
	Name     string `json:"name"` // 확장자 포함
	Base     string `json:"base"` // 확장자 뺀 이름
	Ext      string `json:"ext"`  // 소문자, 점 없이
	Kind     string `json:"kind"` // pdf | image
	Size     int64  `json:"size"`
	Pages    int    `json:"pages"` // PDF 쪽 수 (그림은 1)
	Dir      string `json:"dir"`   // 원본 폴더 (올린 파일은 "")
	Uploaded bool   `json:"uploaded"`
	path     string
}

type Files struct {
	mu      sync.Mutex
	support string
	items   map[string]*Item
}

func NewFiles(support string) *Files {
	return &Files{support: support, items: map[string]*Item{}}
}

func (f *Files) Count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.items)
}

func (f *Files) Get(id string) (*Item, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	it, ok := f.items[id]
	return it, ok
}

func (f *Files) workDir() string { return filepath.Join(f.support, "work") }

// cleanWork: 지난번 실행의 임시 파일(압축 미리 계산 · 변환 중간 파일 · 올린 파일)을 지워요
func (f *Files) cleanWork() {
	os.RemoveAll(f.workDir())
	os.RemoveAll(filepath.Join(f.support, "inbox"))
	os.MkdirAll(f.workDir(), 0o755)
}

var imageExts = map[string]bool{"jpg": true, "jpeg": true, "png": true, "heic": true, "heif": true, "gif": true, "webp": true, "tif": true, "tiff": true, "bmp": true}

func kindOf(name string) (string, string) {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))
	if ext == "pdf" {
		return "pdf", ext
	}
	if imageExts[ext] {
		return "image", ext
	}
	return "", ext
}

// composeHangul: 맥 파일 이름의 한글은 풀어 쓴 꼴(NFD)이라 화면 · 새 파일 이름에는 모아 쓴 꼴(NFC)로 바꿔요
func composeHangul(s string) string { return norm.NFC.String(s) }

func (f *Files) add(path string, uploaded bool) (*Item, error) {
	st, err := os.Stat(path)
	if err != nil {
		return nil, errors.New("파일을 찾을 수 없어요")
	}
	if st.IsDir() {
		return nil, errors.New("폴더는 넣을 수 없어요. 파일을 골라 주세요")
	}
	name := composeHangul(filepath.Base(path))
	kind, ext := kindOf(name)
	if kind == "" {
		return nil, fmt.Errorf("%s 파일은 다룰 수 없어요 (PDF · JPG · PNG · HEIC 만)", strings.ToUpper(ext))
	}
	it := &Item{ID: randID(8), Name: name, Base: strings.TrimSuffix(name, filepath.Ext(name)), Ext: ext, Kind: kind,
		Size: st.Size(), Pages: 1, Uploaded: uploaded, path: path}
	if !uploaded {
		it.Dir = filepath.Dir(path)
	}
	if kind == "pdf" {
		n, err := pdfPageCount(path)
		if err != nil {
			return nil, err
		}
		it.Pages = n
	}
	if (ext == "heic" || ext == "heif") && !canConvertHEIC() {
		return nil, errors.New("이 컴퓨터에서는 HEIC 사진을 읽을 수 없어요")
	}
	f.mu.Lock()
	f.items[it.ID] = it
	f.mu.Unlock()
	return it, nil
}

func pdfPageCount(path string) (n int, err error) {
	defer func() {
		if v := recover(); v != nil {
			log.Printf("page count panic %s: %v", path, v)
			n, err = 0, errors.New("PDF를 읽지 못했어요. 파일이 손상됐을 수 있어요")
		}
	}()
	conf := model.NewDefaultConfiguration()
	conf.ValidationMode = model.ValidationRelaxed
	fh, err := os.Open(path)
	if err != nil {
		return 0, errors.New("파일을 열지 못했어요")
	}
	defer fh.Close()
	n, err = api.PageCount(fh, conf)
	if err != nil {
		return 0, pdfErr(err)
	}
	if n < 1 {
		return 0, errors.New("페이지가 없는 PDF예요")
	}
	return n, nil
}

// pdfErr turns pdfcpu errors into words the user understands.
func pdfErr(err error) error {
	s := strings.ToLower(err.Error())
	switch {
	case strings.Contains(s, "password") || strings.Contains(s, "encrypt"):
		return errors.New("암호가 걸린 PDF예요. 암호를 푼 뒤 다시 넣어 주세요")
	case strings.Contains(s, "not a pdf") || strings.Contains(s, "header") || strings.Contains(s, "eof"):
		return errors.New("PDF를 읽지 못했어요. 파일이 손상됐을 수 있어요")
	}
	log.Printf("pdf error: %v", err)
	return errors.New("PDF를 읽지 못했어요. 파일이 손상됐을 수 있어요")
}

type openResult struct {
	Items  []*Item          `json:"items"`
	Errors []map[string]any `json:"errors"`
}

func (f *Files) openPaths(paths []string, uploaded bool) openResult {
	res := openResult{Items: []*Item{}, Errors: []map[string]any{}}
	for _, p := range paths {
		it, err := f.add(p, uploaded)
		if err != nil {
			res.Errors = append(res.Errors, map[string]any{"name": composeHangul(filepath.Base(p)), "error": err.Error()})
			continue
		}
		res.Items = append(res.Items, it)
	}
	return res
}

// POST {paths:[...]}
func (a *App) handleOpen(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Paths []string `json:"paths"`
	}
	if err := readJSON(r, &in); err != nil {
		jsonError(w, 400, "bad request")
		return
	}
	if len(in.Paths) > 500 {
		in.Paths = in.Paths[:500]
	}
	clean := []string{}
	for _, p := range in.Paths {
		if filepath.IsAbs(p) {
			clean = append(clean, filepath.Clean(p))
		}
	}
	writeJSON(w, a.files.openPaths(clean, false))
}

// POST multipart files=... — 경로를 모르는 파일(브라우저에서 끌어 놓기 등)
func (a *App) handleUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 2<<30)
	mr, err := r.MultipartReader()
	if err != nil {
		jsonError(w, 400, "파일을 받지 못했어요")
		return
	}
	var paths []string
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			jsonError(w, 400, "파일을 받다가 끊겼어요")
			return
		}
		if part.FileName() == "" {
			continue
		}
		p, err := a.saveUpload(part)
		part.Close()
		if err != nil {
			jsonError(w, 500, err.Error())
			return
		}
		paths = append(paths, p)
	}
	writeJSON(w, a.files.openPaths(paths, true))
}

func (a *App) saveUpload(part *multipart.Part) (string, error) {
	name := safeName(composeHangul(filepath.Base(part.FileName())))
	if name == "" {
		name = "파일"
	}
	dir := filepath.Join(a.support, "inbox", randID(6))
	os.MkdirAll(dir, 0o755)
	p := filepath.Join(dir, name)
	out, err := os.Create(p)
	if err != nil {
		return "", errors.New("파일을 저장하지 못했어요")
	}
	if _, err := io.Copy(out, part); err != nil {
		out.Close()
		return "", errors.New("파일을 받다가 끊겼어요")
	}
	return p, out.Close()
}

// safeName keeps a file name usable on macOS (no slashes, colons or control characters).
func safeName(s string) string {
	s = strings.Map(func(r rune) rune {
		if r < 32 || r == '/' || r == '\\' || r == ':' || r == 0x7f {
			return -1
		}
		return r
	}, s)
	s = strings.TrimSpace(s)
	s = strings.TrimLeft(s, ".")
	for len(s) > 200 {
		_, size := utf8.DecodeLastRuneInString(s)
		s = s[:len(s)-size]
	}
	return s
}

// POST {kind: pdf|image|any, multiple} — 껍데기가 없을 때 쓰는 파일 선택 (맥: osascript, 시험: PAPERROAD_TEST_PICK)
func (a *App) handlePick(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Kind     string `json:"kind"`
		Multiple bool   `json:"multiple"`
	}
	readJSON(r, &in)
	var paths []string
	if t := env("TEST_PICK"); t != "" {
		for _, p := range strings.Split(t, "|") {
			if p = strings.TrimSpace(p); p != "" {
				k, _ := kindOf(p)
				if in.Kind == "any" || in.Kind == "" || k == in.Kind {
					paths = append(paths, p)
				}
			}
		}
		if !in.Multiple && len(paths) > 1 {
			paths = paths[:1]
		}
	} else if runtime.GOOS == "darwin" {
		types := `{"com.adobe.pdf"}`
		switch in.Kind {
		case "image":
			types = `{"public.image"}`
		case "any":
			types = `{"com.adobe.pdf", "public.image"}`
		}
		multi := ""
		if in.Multiple {
			multi = " with multiple selections allowed"
		}
		script := `activate
try
set fs to choose file of type ` + types + ` with prompt "파일을 골라 주세요"` + multi + `
on error number -128
return ""
end try
if class of fs is list then
set out to ""
repeat with f in fs
set out to out & POSIX path of f & linefeed
end repeat
return out
end if
return POSIX path of fs`
		out, err := exec.Command("/usr/bin/osascript", "-e", script).Output()
		if err != nil {
			jsonError(w, 500, "파일 선택 창을 열지 못했어요")
			return
		}
		for _, l := range strings.Split(string(out), "\n") {
			if l = strings.TrimSpace(l); l != "" {
				paths = append(paths, l)
			}
		}
	} else {
		jsonError(w, 501, "파일 선택 창을 열 수 없어요")
		return
	}
	writeJSON(w, a.files.openPaths(paths, false))
}

// POST {} → {path} — 껍데기가 없을 때 쓰는 폴더 선택 ('매번 물어보기')
func (a *App) handleChooseFolder(w http.ResponseWriter, r *http.Request) {
	if t := env("TEST_CHOOSE"); t != "" {
		writeJSON(w, map[string]any{"ok": true, "path": t})
		return
	}
	if runtime.GOOS != "darwin" {
		jsonError(w, 501, "폴더 선택 창을 열 수 없어요")
		return
	}
	script := `activate
try
set f to choose folder with prompt "저장할 폴더를 골라 주세요"
return POSIX path of f
on error number -128
return ""
end try`
	out, err := exec.Command("/usr/bin/osascript", "-e", script).Output()
	if err != nil {
		jsonError(w, 500, "폴더 선택 창을 열지 못했어요")
		return
	}
	p := strings.TrimSpace(string(out))
	if p != "/" {
		p = strings.TrimSuffix(p, "/")
	}
	writeJSON(w, map[string]any{"ok": true, "path": p})
}

// GET ?id= — 화면이 PDF(pdf.js) · 그림을 그릴 때 쓰는 원본 (HEIC 는 JPEG 으로 바꿔서)
func (a *App) handleFile(w http.ResponseWriter, r *http.Request) {
	it, ok := a.files.Get(r.URL.Query().Get("id"))
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	p := it.path
	ctype := ""
	if it.Ext == "heic" || it.Ext == "heif" {
		jp, err := a.files.heicJPEG(it)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		p, ctype = jp, "image/jpeg"
	} else if it.Kind == "pdf" {
		ctype = "application/pdf"
	}
	fh, err := os.Open(p)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	defer fh.Close()
	st, _ := fh.Stat()
	if ctype != "" {
		w.Header().Set("Content-Type", ctype)
	}
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeContent(w, r, "", st.ModTime(), fh)
}

// ---------------------------------------------------------------- HEIC

func canConvertHEIC() bool {
	if env("NO_SIPS") == "1" {
		return false
	}
	return fileExists("/usr/bin/sips")
}

var heicMu sync.Mutex

// heicJPEG converts a HEIC photo to a JPEG once (Support/work/heic/<id>.jpg) with macOS sips.
func (f *Files) heicJPEG(it *Item) (string, error) {
	heicMu.Lock()
	defer heicMu.Unlock()
	out := filepath.Join(f.workDir(), "heic", it.ID+".jpg")
	if fileExists(out) {
		return out, nil
	}
	if !canConvertHEIC() {
		return "", errors.New("이 컴퓨터에서는 HEIC 사진을 읽을 수 없어요")
	}
	os.MkdirAll(filepath.Dir(out), 0o755)
	cmd := exec.Command("/usr/bin/sips", "-s", "format", "jpeg", "-s", "formatOptions", "92", it.path, "--out", out)
	if b, err := cmd.CombinedOutput(); err != nil || !fileExists(out) {
		log.Printf("sips heic: %v %s", err, b)
		return "", errors.New("HEIC 사진을 바꾸지 못했어요")
	}
	return out, nil
}

// itemBytes reads an image item as JPEG/PNG/GIF/WEBP/TIFF/BMP bytes (HEIC → JPEG).
func (f *Files) itemBytes(it *Item) ([]byte, error) {
	p := it.path
	if it.Ext == "heic" || it.Ext == "heif" {
		jp, err := f.heicJPEG(it)
		if err != nil {
			return nil, err
		}
		p = jp
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return nil, fmt.Errorf("%s 파일을 읽지 못했어요", it.Name)
	}
	return b, nil
}

// itemsByIDs returns the items in order, or an error naming a missing one.
func (f *Files) itemsByIDs(ids []string) ([]*Item, error) {
	out := make([]*Item, 0, len(ids))
	for _, id := range ids {
		it, ok := f.Get(id)
		if !ok {
			return nil, errors.New("넣은 파일을 찾지 못했어요. 파일을 다시 넣어 주세요")
		}
		if !fileExists(it.path) {
			return nil, fmt.Errorf("%s 파일이 없어졌어요. 옮기거나 지웠는지 확인해 주세요", it.Name)
		}
		out = append(out, it)
	}
	return out, nil
}

func uniqueSorted(xs []string) []string {
	m := map[string]bool{}
	out := []string{}
	for _, x := range xs {
		if !m[x] {
			m[x] = true
			out = append(out, x)
		}
	}
	sort.Strings(out)
	return out
}

func nowStamp() string { return time.Now().Format("20060102-150405") }
