package main

// PDF → 그림(JPG · PNG) 저장
//
// PDF 페이지를 그림으로 그리는 일은 화면(pdf.js)이 해요. 엔진은 받은 그림을 저장만 해요.
//   1) /api/images/begin {id, ext, count, task, dir} → 저장할 곳을 정하고 작업 번호를 줘요
//      (여러 장이면 "<이름> JPG" 폴더를 새로 만들고, 한 장이면 그 폴더에 바로)
//   2) /api/images/put?job=..&p=3  (본문 = 그림 파일)  → "<이름>_3쪽.jpg"
//   3) /api/images/end {job} → 최근 작업에 남기고 결과를 알려 줘요

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type imageJob struct {
	item    *Item
	ext     string
	task    string
	dir     string // 그림을 넣을 폴더
	folder  bool   // 새로 만든 폴더인지
	written []string
	created time.Time
}

type ImageJobs struct {
	mu   sync.Mutex
	jobs map[string]*imageJob
}

func NewImageJobs() *ImageJobs { return &ImageJobs{jobs: map[string]*imageJob{}} }

func (j *ImageJobs) get(id string) (*imageJob, bool) {
	j.mu.Lock()
	defer j.mu.Unlock()
	job, ok := j.jobs[id]
	return job, ok
}

func (a *App) handleImagesBegin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID    string `json:"id"`
		Ext   string `json:"ext"`
		Count int    `json:"count"`
		Task  string `json:"task"`
		Dir   string `json:"dir"`
	}
	if err := readJSON(r, &in); err != nil {
		jsonError(w, 400, "bad request")
		return
	}
	it, ok := a.files.Get(in.ID)
	if !ok || it.Kind != "pdf" {
		jsonError(w, 400, "넣은 PDF를 찾지 못했어요. 파일을 다시 넣어 주세요")
		return
	}
	ext := strings.ToLower(in.Ext)
	if ext != "jpg" && ext != "png" {
		ext = "jpg"
	}
	if in.Count < 1 {
		jsonError(w, 400, "바꿀 페이지를 골라 주세요")
		return
	}
	task := "toimg"
	if in.Task == "jpg" {
		task = "jpg"
	}
	dir, err := a.destDir(it, in.Dir)
	if err != nil {
		jsonError(w, 400, err.Error())
		return
	}
	job := &imageJob{item: it, ext: ext, task: task, dir: dir, created: time.Now()}
	if in.Count > 1 {
		folder, err := uniqueDir(dir, it.Base+" "+strings.ToUpper(ext))
		if err != nil {
			jsonError(w, 500, err.Error())
			return
		}
		job.dir, job.folder = folder, true
	}
	id := randID(8)
	a.images.mu.Lock()
	for k, old := range a.images.jobs { // 오래된 작업 정리
		if time.Since(old.created) > 6*time.Hour {
			delete(a.images.jobs, k)
		}
	}
	a.images.jobs[id] = job
	a.images.mu.Unlock()
	writeJSON(w, map[string]any{"ok": true, "job": id})
}

func (a *App) handleImagesPut(w http.ResponseWriter, r *http.Request) {
	job, ok := a.images.get(r.URL.Query().Get("job"))
	if !ok {
		jsonError(w, 400, "저장 작업을 찾지 못했어요. 다시 시도해 주세요")
		return
	}
	p, err := strconv.Atoi(r.URL.Query().Get("p"))
	if err != nil || p < 1 || p > job.item.Pages {
		jsonError(w, 400, "페이지 번호가 잘못됐어요")
		return
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, 200<<20))
	r.Body.Close()
	if err != nil || len(b) < 8 {
		jsonError(w, 400, "그림을 받지 못했어요")
		return
	}
	isJPEG := b[0] == 0xFF && b[1] == 0xD8
	isPNG := bytes.HasPrefix(b, []byte("\x89PNG"))
	if (job.ext == "jpg" && !isJPEG) || (job.ext == "png" && !isPNG) {
		jsonError(w, 400, "그림 형식이 맞지 않아요")
		return
	}
	out := uniquePath(job.dir, fmt.Sprintf("%s_%d쪽.%s", job.item.Base, p, job.ext))
	if err := os.WriteFile(out, b, 0o644); err != nil {
		jsonError(w, 500, "그림을 저장하지 못했어요")
		return
	}
	a.images.mu.Lock()
	job.written = append(job.written, out)
	a.images.mu.Unlock()
	writeJSON(w, map[string]any{"ok": true})
}

func (a *App) handleImagesEnd(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Job    string `json:"job"`
		Cancel bool   `json:"cancel"`
	}
	readJSON(r, &in)
	job, ok := a.images.get(in.Job)
	if !ok {
		jsonError(w, 400, "저장 작업을 찾지 못했어요")
		return
	}
	a.images.mu.Lock()
	delete(a.images.jobs, in.Job)
	written := append([]string(nil), job.written...)
	a.images.mu.Unlock()
	if in.Cancel {
		for _, p := range written {
			os.Remove(p)
		}
		if job.folder {
			os.Remove(job.dir)
		}
		writeJSON(w, map[string]any{"ok": true, "canceled": true})
		return
	}
	if len(written) == 0 {
		if job.folder {
			os.Remove(job.dir)
		}
		jsonError(w, 400, errors.New("저장한 그림이 없어요").Error())
		return
	}
	path := written[0]
	if job.folder {
		path = job.dir
	}
	a.finish(w, job.task, path, len(written), job.folder, nil)
}

var _ = filepath.Join
