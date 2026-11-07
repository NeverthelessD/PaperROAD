package main

// PDF 페이지 작업: 합치기 · 순서 바꾸기 · 회전 · 삭제 (/api/build), 나누기 · 추출 (/api/split)
// pdfcpu(Apache-2.0)로 페이지를 그대로 옮겨서 화질 · 글자가 바뀌지 않아요.

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// pdfcpu 는 설정 폴더(~/Library/Application Support/pdfcpu)를 만들고, 못 만들면 프로그램을 끝내 버려요.
// 그 폴더가 필요 없으니 처음부터 꺼 둬요 (글꼴 추가 기능만 안 쓰게 돼요).
func init() { api.DisableConfigDir() }

func pdfConf() *model.Configuration {
	conf := model.NewDefaultConfiguration()
	conf.ValidationMode = model.ValidationRelaxed
	return conf
}

// guard turns a pdfcpu panic into an error.
func guard(err *error) {
	if v := recover(); v != nil {
		log.Printf("pdf op panic: %v", v)
		*err = errors.New("PDF를 처리하다가 문제가 생겼어요. 파일이 손상됐을 수 있어요")
	}
}

type PageRef struct {
	ID string `json:"id"`
	P  int    `json:"p"` // 1부터
	R  int    `json:"r"` // 0 | 90 | 180 | 270 (시계 방향)
}

// assemble writes pages (from one or more PDFs, in this order, each turned by R) into out.
func (a *App) assemble(pages []PageRef, out string) (err error) {
	defer guard(&err)
	if len(pages) == 0 {
		return errors.New("저장할 페이지가 없어요")
	}
	if len(pages) > 5000 {
		return errors.New("페이지가 너무 많아요")
	}
	var ids []string
	seen := map[string]bool{}
	for _, p := range pages {
		if !seen[p.ID] {
			seen[p.ID] = true
			ids = append(ids, p.ID)
		}
	}
	items, err := a.files.itemsByIDs(ids)
	if err != nil {
		return err
	}
	offset := map[string]int{}
	total := 0
	var paths []string
	for _, it := range items {
		if it.Kind != "pdf" {
			return fmt.Errorf("%s 은(는) PDF가 아니에요", it.Name)
		}
		offset[it.ID] = total
		total += it.Pages
		paths = append(paths, it.path)
	}
	work, err := os.MkdirTemp(a.files.workDir(), "build-")
	if err != nil {
		return errors.New("작업 폴더를 만들지 못했어요")
	}
	defer os.RemoveAll(work)

	src := paths[0]
	if len(paths) > 1 {
		src = filepath.Join(work, "merged.pdf")
		if err := api.MergeCreateFile(paths, src, false, pdfConf()); err != nil {
			return pdfErr(err)
		}
	}
	sel := make([]string, len(pages))
	for i, p := range pages {
		it, _ := a.files.Get(p.ID)
		if p.P < 1 || p.P > it.Pages {
			return fmt.Errorf("%s 에 %d쪽이 없어요", it.Name, p.P)
		}
		sel[i] = strconv.Itoa(offset[p.ID] + p.P)
	}
	collected := filepath.Join(work, "collected.pdf")
	if err := api.CollectFile(src, collected, sel, pdfConf()); err != nil {
		return pdfErr(err)
	}
	// 회전: 같은 각도끼리 한 번에
	byRot := map[int][]string{}
	for i, p := range pages {
		r := ((p.R % 360) + 360) % 360
		if r == 90 || r == 180 || r == 270 {
			byRot[r] = append(byRot[r], strconv.Itoa(i+1))
		}
	}
	cur := collected
	for _, r := range []int{90, 180, 270} {
		if len(byRot[r]) == 0 {
			continue
		}
		next := filepath.Join(work, fmt.Sprintf("rot%d.pdf", r))
		if err := api.RotateFile(cur, next, r, byRot[r], pdfConf()); err != nil {
			return pdfErr(err)
		}
		cur = next
	}
	if n, err := api.PageCountFile(cur); err != nil || n != len(pages) {
		log.Printf("assemble: page count %d want %d (%v)", n, len(pages), err)
		return errors.New("페이지를 모으다가 문제가 생겼어요")
	}
	return moveInto(cur, out)
}

// POST {pages:[{id,p,r}], task: merge|organize, name, dir}
func (a *App) handleBuild(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Pages []PageRef `json:"pages"`
		Task  string    `json:"task"`
		Name  string    `json:"name"`
		Dir   string    `json:"dir"`
	}
	if err := readJSON(r, &in); err != nil || len(in.Pages) == 0 {
		jsonError(w, 400, "저장할 페이지가 없어요")
		return
	}
	first, ok := a.files.Get(in.Pages[0].ID)
	if !ok {
		jsonError(w, 400, "넣은 파일을 찾지 못했어요. 파일을 다시 넣어 주세요")
		return
	}
	dir, err := a.destDir(first, in.Dir)
	if err != nil {
		jsonError(w, 400, err.Error())
		return
	}
	multi := false
	for _, p := range in.Pages {
		if p.ID != first.ID {
			multi = true
			break
		}
	}
	name := pdfName(in.Name)
	if name == "" {
		if multi {
			name = first.Base + "_합침.pdf"
		} else {
			name = first.Base + "_정리됨.pdf"
		}
	}
	task := "organize"
	if in.Task == "merge" {
		task = "merge"
	}
	out := uniquePath(dir, name)
	tmp := filepath.Join(dir, "."+filepath.Base(out)+".part")
	if err := a.assemble(in.Pages, tmp); err != nil {
		os.Remove(tmp)
		jsonError(w, 400, err.Error())
		return
	}
	if err := moveInto(tmp, out); err != nil {
		jsonError(w, 500, err.Error())
		return
	}
	a.finish(w, task, out, 1, false, map[string]any{"pages": len(in.Pages)})
}

// pdfName cleans a user-given file name and makes sure it ends with .pdf ("" when empty).
func pdfName(s string) string {
	s = safeName(composeHangul(s))
	if s == "" {
		return ""
	}
	if !strings.HasSuffix(strings.ToLower(s), ".pdf") {
		s += ".pdf"
	}
	return s
}

// ---------------------------------------------------------------- 나누기

type span struct{ from, to int }

func (s span) label() string {
	if s.from == s.to {
		return strconv.Itoa(s.from) + "쪽"
	}
	return fmt.Sprintf("%d-%d쪽", s.from, s.to)
}

var rangeRe = regexp.MustCompile(`^(\d*)\s*[-~–]\s*(\d*)$`)

// parseRanges reads "1-3, 6, 8-" (1-based, inclusive). "8-" = 8쪽부터 끝까지.
func parseRanges(text string, pages int) ([]span, error) {
	text = strings.NewReplacer("，", ",", "、", ",", ";", ",", "쪽", "", "p", "", "P", "").Replace(text)
	var out []span
	for _, part := range strings.Split(text, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		var s span
		if m := rangeRe.FindStringSubmatch(part); m != nil {
			s.from, s.to = 1, pages
			if m[1] != "" {
				s.from, _ = strconv.Atoi(m[1])
			}
			if m[2] != "" {
				s.to, _ = strconv.Atoi(m[2])
			}
		} else if n, err := strconv.Atoi(part); err == nil {
			s.from, s.to = n, n
		} else {
			return nil, fmt.Errorf("'%s' 을(를) 이해하지 못했어요. 예: 1-3, 6, 8", part)
		}
		if s.from < 1 || s.to > pages || s.from > s.to {
			return nil, fmt.Errorf("'%s' 은(는) 1~%d쪽 안에서 적어 주세요", part, pages)
		}
		out = append(out, s)
	}
	if len(out) == 0 {
		return nil, errors.New("페이지 범위를 적어 주세요. 예: 1-3, 6, 8")
	}
	return out, nil
}

// compactPages turns [2,3,6] into "2-3,6".
func compactPages(ps []int) string {
	sort.Ints(ps)
	var parts []string
	for i := 0; i < len(ps); {
		j := i
		for j+1 < len(ps) && ps[j+1] == ps[j]+1 {
			j++
		}
		if i == j {
			parts = append(parts, strconv.Itoa(ps[i]))
		} else {
			parts = append(parts, fmt.Sprintf("%d-%d", ps[i], ps[j]))
		}
		i = j + 1
	}
	return strings.Join(parts, ",")
}

// POST {id, mode: pick|every|range, pages:[..], every:n, ranges:"..", dir}
func (a *App) handleSplit(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID     string `json:"id"`
		Mode   string `json:"mode"`
		Pages  []int  `json:"pages"`
		Every  int    `json:"every"`
		Ranges string `json:"ranges"`
		Dir    string `json:"dir"`
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
	if !fileExists(it.path) {
		jsonError(w, 400, it.Name+" 파일이 없어졌어요. 옮기거나 지웠는지 확인해 주세요")
		return
	}
	dir, err := a.destDir(it, in.Dir)
	if err != nil {
		jsonError(w, 400, err.Error())
		return
	}
	switch in.Mode {
	case "pick":
		uniq := map[int]bool{}
		var ps []int
		for _, p := range in.Pages {
			if p >= 1 && p <= it.Pages && !uniq[p] {
				uniq[p] = true
				ps = append(ps, p)
			}
		}
		if len(ps) == 0 {
			jsonError(w, 400, "새 PDF에 넣을 페이지를 골라 주세요")
			return
		}
		sort.Ints(ps)
		refs := make([]PageRef, len(ps))
		for i, p := range ps {
			refs[i] = PageRef{ID: it.ID, P: p}
		}
		out := uniquePath(dir, fmt.Sprintf("%s_%s쪽.pdf", it.Base, compactPages(ps)))
		tmp := filepath.Join(dir, "."+filepath.Base(out)+".part")
		if err := a.assemble(refs, tmp); err != nil {
			os.Remove(tmp)
			jsonError(w, 400, err.Error())
			return
		}
		if err := moveInto(tmp, out); err != nil {
			jsonError(w, 500, err.Error())
			return
		}
		a.finish(w, "split", out, 1, false, map[string]any{"pages": len(ps)})
	case "every", "range":
		var spans []span
		if in.Mode == "every" {
			n := in.Every
			if n < 1 {
				jsonError(w, 400, "몇 쪽씩 나눌지 1 이상으로 적어 주세요")
				return
			}
			for p := 1; p <= it.Pages; p += n {
				spans = append(spans, span{p, min(p+n-1, it.Pages)})
			}
		} else {
			spans, err = parseRanges(in.Ranges, it.Pages)
			if err != nil {
				jsonError(w, 400, err.Error())
				return
			}
		}
		if len(spans) > 1000 {
			jsonError(w, 400, "파일이 너무 많이 만들어져요. 쪽수를 늘려 주세요")
			return
		}
		folder, err := uniqueDir(dir, it.Base+" 나눔")
		if err != nil {
			jsonError(w, 500, err.Error())
			return
		}
		for _, s := range spans {
			refs := []PageRef{}
			for p := s.from; p <= s.to; p++ {
				refs = append(refs, PageRef{ID: it.ID, P: p})
			}
			out := uniquePath(folder, fmt.Sprintf("%s_%s.pdf", it.Base, s.label()))
			if err := a.assemble(refs, out); err != nil {
				jsonError(w, 400, err.Error())
				return
			}
		}
		a.finish(w, "split", folder, len(spans), true, nil)
	default:
		jsonError(w, 400, "나누는 방법을 골라 주세요")
	}
}
