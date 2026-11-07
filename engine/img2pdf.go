package main

// 이미지 → PDF
//   용지: photo = 사진 크기 그대로 (사진 비율 그대로, 150dpi 기준 · 긴 변 100~600mm)
//         a4 · letter = 그 용지 한가운데에 사진을 맞춰 넣어요
//   방향: auto = 사진이 가로로 길면 가로 용지 · portrait · landscape
//   여백: none 0mm · narrow 8mm · normal 18mm

import (
	"errors"
	"math"
	"net/http"
	"os"
	"path/filepath"
)

type imgSpec struct {
	ID string `json:"id"`
	R  int    `json:"r"`
}

func marginMM(m string) float64 {
	switch m {
	case "narrow":
		return 8
	case "normal":
		return 18
	}
	return 0
}

// layoutImages turns the photos into page layouts (mm).
func (a *App) layoutImages(specs []imgSpec, paper, orient, margin string) (*PrintSpec, error) {
	if len(specs) == 0 {
		return nil, errors.New("PDF로 만들 사진을 넣어 주세요")
	}
	if len(specs) > 1000 {
		return nil, errors.New("사진이 너무 많아요 (1000장까지)")
	}
	m := marginMM(margin)
	ps := &PrintSpec{}
	var pages []PrintPage
	maxW, maxH := 0.0, 0.0
	type pageGeo struct{ w, h float64 }
	var geos []pageGeo
	for _, s := range specs {
		it, ok := a.files.Get(s.ID)
		if !ok {
			return nil, errors.New("넣은 사진을 찾지 못했어요. 사진을 다시 넣어 주세요")
		}
		if it.Kind != "image" {
			return nil, errors.New(it.Name + " 은(는) 사진이 아니에요")
		}
		b, err := a.files.itemBytes(it)
		if err != nil {
			return nil, err
		}
		im, err := loadPDFImage(b)
		if err != nil {
			return nil, errors.New(it.Name + " 사진을 읽지 못했어요")
		}
		iw, ih := float64(im.w), float64(im.h)
		if im.orient >= 5 && im.orient <= 8 {
			iw, ih = ih, iw
		}
		r := ((s.R % 360) + 360) % 360
		if r == 90 || r == 270 {
			iw, ih = ih, iw
		}
		land := iw > ih
		switch orient {
		case "portrait":
			land = false
		case "landscape":
			land = true
		}
		var pw, ph float64
		switch paper {
		case "a4":
			pw, ph = 210, 297
		case "letter":
			pw, ph = 215.9, 279.4
		default: // 사진 크기 그대로
			const dpi = 150.0
			w, h := iw/dpi*25.4, ih/dpi*25.4
			long := math.Max(w, h)
			scale := 1.0
			if long > 600 {
				scale = 600 / long
			} else if long < 100 {
				scale = 100 / long
			}
			pw, ph = w*scale+2*m, h*scale+2*m
		}
		if paper == "a4" || paper == "letter" {
			if land {
				pw, ph = ph, pw
			}
		}
		cw, ch := pw-2*m, ph-2*m
		if cw < 10 || ch < 10 {
			return nil, errors.New("여백이 너무 커요")
		}
		sc := math.Min(cw/iw, ch/ih)
		bw, bh := iw*sc, ih*sc
		box := []float64{(pw - bw) / 2, (ph - bh) / 2, bw, bh}
		pages = append(pages, PrintPage{Ops: []PrintOp{{Type: "image", ID: it.ID, Box: box, Rot: r}}})
		geos = append(geos, pageGeo{pw, ph})
		maxW, maxH = math.Max(maxW, pw), math.Max(maxH, ph)
	}
	ps.Pages = pages
	ps.W, ps.H = maxW, maxH
	ps.geo = make([][2]float64, len(geos))
	for i, g := range geos {
		ps.geo[i] = [2]float64{g.w, g.h}
	}
	return ps, nil
}

// POST {items:[{id,r}], paper, orient, margin, name, dir}
func (a *App) handleImg2PDF(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Items  []imgSpec `json:"items"`
		Paper  string    `json:"paper"`
		Orient string    `json:"orient"`
		Margin string    `json:"margin"`
		Name   string    `json:"name"`
		Dir    string    `json:"dir"`
	}
	if err := readJSON(r, &in); err != nil {
		jsonError(w, 400, "bad request")
		return
	}
	spec, err := a.layoutImages(in.Items, in.Paper, in.Orient, in.Margin)
	if err != nil {
		jsonError(w, 400, err.Error())
		return
	}
	first, _ := a.files.Get(in.Items[0].ID)
	dir, err := a.destDir(first, in.Dir)
	if err != nil {
		jsonError(w, 400, err.Error())
		return
	}
	data, n, err := buildPDF(spec, func(id string, _ int) ([]byte, error) {
		it, ok := a.files.Get(id)
		if !ok {
			return nil, errors.New("넣은 사진을 찾지 못했어요")
		}
		return a.files.itemBytes(it)
	})
	if err != nil {
		jsonError(w, 400, err.Error())
		return
	}
	name := pdfName(in.Name)
	if name == "" {
		name = "사진모음.pdf"
	}
	out := uniquePath(dir, name)
	tmp := filepath.Join(dir, "."+filepath.Base(out)+".part")
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		jsonError(w, 500, "PDF를 저장하지 못했어요")
		return
	}
	if err := moveInto(tmp, out); err != nil {
		jsonError(w, 500, err.Error())
		return
	}
	a.finish(w, "img2pdf", out, 1, false, map[string]any{"pages": n})
}
