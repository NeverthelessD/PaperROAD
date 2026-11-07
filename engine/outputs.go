package main

// 결과 저장 위치 · 최근 작업
//
// 저장 위치(설정): beside = 원본 파일 옆 (기본) · downloads = 다운로드 폴더 · ask = 매번 폴더를 물어봐요
//   ask 일 때는 화면이 먼저 폴더를 물어보고 그 경로를 dir 로 보내요.
//   원본 폴더를 모르거나(올린 파일) 쓸 수 없으면 다운로드 폴더에 저장해요.
// 같은 이름이 있으면 덮어쓰지 않고 " (2)", " (3)" … 을 붙여요.
// 최근 작업(Support/recent.json, 최근 12개): 첫 화면에 보여 주고, 누르면 Finder 에서 보여 줘요.

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Recent struct {
	Path   string `json:"path"`
	Name   string `json:"name"`
	Task   string `json:"task"`   // merge | organize | split | jpg | compress | toimg | img2pdf
	Count  int    `json:"count"`  // 만든 파일 수
	Folder bool   `json:"folder"` // Path 가 폴더인지 (여러 파일)
	Time   int64  `json:"time"`
}

type Outputs struct {
	mu      sync.Mutex
	support string
	recent  []Recent
}

func NewOutputs(support string) *Outputs {
	o := &Outputs{support: support}
	if b, err := os.ReadFile(o.file()); err == nil {
		json.Unmarshal(b, &o.recent)
	}
	return o
}

func (o *Outputs) file() string { return filepath.Join(o.support, "recent.json") }

func (o *Outputs) add(r Recent) {
	o.mu.Lock()
	defer o.mu.Unlock()
	r.Time = time.Now().UnixMilli()
	list := []Recent{r}
	for _, x := range o.recent {
		if x.Path != r.Path && len(list) < 12 {
			list = append(list, x)
		}
	}
	o.recent = list
	b, _ := json.MarshalIndent(o.recent, "", "  ")
	writeFileAtomic(o.file(), b, 0o644)
}

func (o *Outputs) list() []map[string]any {
	o.mu.Lock()
	defer o.mu.Unlock()
	out := []map[string]any{}
	for _, r := range o.recent {
		out = append(out, map[string]any{"path": r.Path, "name": r.Name, "task": r.Task, "count": r.Count,
			"folder": r.Folder, "time": r.Time, "exists": fileExists(r.Path), "dir": composeHangul(filepath.Base(filepath.Dir(r.Path)))})
	}
	return out
}

func (o *Outputs) known(p string) bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	for _, r := range o.recent {
		if r.Path == p {
			return true
		}
	}
	return false
}

func downloadsDir() string {
	if d := env("DOWNLOADS"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Downloads")
}

func writable(dir string) bool {
	if !dirExists(dir) {
		return false
	}
	f, err := os.CreateTemp(dir, ".paperroad-*")
	if err != nil {
		return false
	}
	name := f.Name()
	f.Close()
	os.Remove(name)
	return true
}

// destDir decides where results go. askDir is the folder the user picked when saveTo == "ask".
func (a *App) destDir(src *Item, askDir string) (string, error) {
	s := a.Settings()
	switch s.SaveTo {
	case "ask":
		if askDir == "" {
			return "", errors.New("저장할 폴더를 고르지 않았어요")
		}
		if !writable(askDir) {
			return "", errors.New("고른 폴더에 저장할 수 없어요. 다른 폴더를 골라 주세요")
		}
		return askDir, nil
	case "beside":
		if src != nil && src.Dir != "" && writable(src.Dir) {
			return src.Dir, nil
		}
	}
	d := downloadsDir()
	os.MkdirAll(d, 0o755)
	if !writable(d) {
		return "", errors.New("다운로드 폴더에 저장할 수 없어요")
	}
	return d, nil
}

// uniquePath returns dir/name, adding " (2)" … before the extension when the name is taken.
func uniquePath(dir, name string) string {
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	p := filepath.Join(dir, name)
	for i := 2; fileExists(p); i++ {
		p = filepath.Join(dir, fmt.Sprintf("%s (%d)%s", base, i, ext))
	}
	return p
}

// uniqueDir makes a new folder dir/name (adding " (2)" … when taken).
func uniqueDir(dir, name string) (string, error) {
	p := filepath.Join(dir, name)
	for i := 2; fileExists(p); i++ {
		p = filepath.Join(dir, fmt.Sprintf("%s (%d)", name, i))
	}
	if err := os.MkdirAll(p, 0o755); err != nil {
		return "", errors.New("결과를 담을 폴더를 만들지 못했어요")
	}
	return p, nil
}

// moveInto moves a finished temp file to its final place (copying when on another disk).
func moveInto(tmp, final string) error {
	if err := os.Rename(tmp, final); err == nil {
		return nil
	}
	if err := copyPlain(tmp, final); err != nil {
		os.Remove(final)
		return errors.New("결과 파일을 저장하지 못했어요")
	}
	os.Remove(tmp)
	return nil
}

func (a *App) handleRecent(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"items": a.outs.list()})
}

// POST {path} — 결과 파일(최근 작업에 있는 것만)을 Finder 에서 보여 줘요
func (a *App) handleReveal(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Path string `json:"path"`
	}
	readJSON(r, &in)
	if !a.outs.known(in.Path) {
		jsonError(w, 400, "보여 줄 파일을 찾지 못했어요")
		return
	}
	if !fileExists(in.Path) {
		jsonError(w, 404, "파일이 없어졌어요. 옮기거나 지웠을 수 있어요")
		return
	}
	if dirExists(in.Path) {
		openPaths([]string{in.Path})
	} else {
		revealPaths([]string{in.Path})
	}
	writeJSON(w, map[string]any{"ok": true})
}

// finish records a result and answers the screen.
func (a *App) finish(w http.ResponseWriter, task, path string, count int, folder bool, extra map[string]any) {
	name := composeHangul(filepath.Base(path))
	a.outs.add(Recent{Path: path, Name: name, Task: task, Count: count, Folder: folder})
	out := map[string]any{"ok": true, "path": path, "name": name, "dir": composeHangul(filepath.Base(filepath.Dir(path))),
		"count": count, "folder": folder}
	for k, v := range extra {
		out[k] = v
	}
	writeJSON(w, out)
}
