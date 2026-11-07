package main

// PDF 용량 줄이기
//
// PDF 안의 사진(그림)을 다시 저장해서 용량을 줄여요. 글자 · 선은 그대로라서 화면에서 보기엔 거의 같아요.
//   가볍게: 긴 변 2400px · JPEG 품질 85   (화질 거의 그대로)
//   보통:   긴 변 1700px · JPEG 품질 72   (화면으로 보기엔 차이가 없을 만큼)
//   강하게: 긴 변 1100px · JPEG 품질 55   (메일 첨부용)
// 다시 저장해도 작아지지 않는 그림은 원래대로 둬요. 결과가 원본보다 크면 원본을 그대로 써요.
// 화면이 고르기 전에 세 가지를 미리 만들어 크기를 보여 줘요 (Support/work/compress/<id>/<level>.pdf).

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
	xdraw "golang.org/x/image/draw"
)

type level struct {
	Key     string
	MaxSide int
	Quality int
}

var levels = []level{{"low", 2400, 85}, {"mid", 1700, 72}, {"high", 1100, 55}}

type estimate struct {
	done  chan struct{}
	sizes map[string]int64
	paths map[string]string
	err   error
}

type Compressor struct {
	mu      sync.Mutex
	support string
	jobs    map[string]*estimate
}

func NewCompressor(support string) *Compressor {
	return &Compressor{support: support, jobs: map[string]*estimate{}}
}

// estimate starts (once per file) making all three versions and waits for them.
func (c *Compressor) estimate(it *Item) *estimate {
	c.mu.Lock()
	e, ok := c.jobs[it.ID]
	if !ok {
		e = &estimate{done: make(chan struct{}), sizes: map[string]int64{}, paths: map[string]string{}}
		c.jobs[it.ID] = e
		go func() {
			defer close(e.done)
			defer func() {
				if v := recover(); v != nil {
					log.Printf("compress panic: %v", v)
					e.err = errors.New("PDF를 줄이다가 문제가 생겼어요")
				}
			}()
			dir := filepath.Join(app.files.workDir(), "compress", it.ID)
			os.MkdirAll(dir, 0o755)
			for _, lv := range levels {
				out := filepath.Join(dir, lv.Key+".pdf")
				if err := compressPDF(it.path, out, lv); err != nil {
					e.err = err
					return
				}
				st, err := os.Stat(out)
				if err != nil {
					e.err = errors.New("줄인 파일을 만들지 못했어요")
					return
				}
				e.sizes[lv.Key], e.paths[lv.Key] = st.Size(), out
			}
		}()
	}
	c.mu.Unlock()
	<-e.done
	if e.err != nil { // 다음에 다시 시도할 수 있게
		c.mu.Lock()
		delete(c.jobs, it.ID)
		c.mu.Unlock()
	}
	return e
}

func compressPDF(in, out string, lv level) (err error) {
	defer guard(&err)
	fh, err := os.Open(in)
	if err != nil {
		return errors.New("파일을 열지 못했어요")
	}
	want, err := api.PageCount(fh, pdfConf())
	if err != nil {
		fh.Close()
		return pdfErr(err)
	}
	fh.Seek(0, 0)
	ctx, err := api.ReadContext(fh, pdfConf())
	fh.Close()
	if err != nil {
		return pdfErr(err)
	}
	if err := api.OptimizeContext(ctx); err != nil {
		return pdfErr(err)
	}
	changed := 0
	for nr, e := range ctx.XRefTable.Table {
		if e == nil || e.Free || e.Object == nil {
			continue
		}
		sd, ok := e.Object.(types.StreamDict)
		if !ok {
			continue
		}
		if st := sd.Subtype(); st == nil || *st != "Image" {
			continue
		}
		nsd, ok := recompressImage(ctx, sd, lv)
		if ok {
			e.Object = nsd
			changed++
		}
		_ = nr
	}
	log.Printf("compress %s: %d개 그림을 다시 저장 (%s)", filepath.Base(in), changed, lv.Key)
	tmp := out + ".part"
	if err := api.WriteContextFile(ctx, tmp); err != nil {
		os.Remove(tmp)
		return pdfErr(err)
	}
	if n, err := api.PageCountFile(tmp); err != nil || n != want {
		os.Remove(tmp)
		return errors.New("줄인 파일을 확인하지 못했어요")
	}
	return os.Rename(tmp, out)
}

func dictInt(ctx *model.Context, d types.Dict, key string) (int, bool) {
	o, ok := d.Find(key)
	if !ok {
		return 0, false
	}
	i, err := ctx.XRefTable.DereferenceInteger(o)
	if err != nil || i == nil {
		return 0, false
	}
	return i.Value(), true
}

// recompressImage returns a smaller JPEG version of an image stream, or ok=false to keep it as it is.
func recompressImage(ctx *model.Context, sd types.StreamDict, lv level) (types.StreamDict, bool) {
	d := sd.Dict
	if _, ok := d.Find("ImageMask"); ok {
		return sd, false
	}
	if _, ok := d.Find("Decode"); ok {
		return sd, false
	}
	if _, ok := d.Find("Mask"); ok { // 색으로 가리는 그림은 JPEG 으로 바꾸면 경계가 망가져요
		return sd, false
	}
	bpc, _ := dictInt(ctx, d, "BitsPerComponent")
	w, _ := dictInt(ctx, d, "Width")
	h, _ := dictInt(ctx, d, "Height")
	if w < 16 || h < 16 || w*h > 80_000_000 {
		return sd, false
	}
	_, hasSMask := d.Find("SMask")
	comps := 0
	csObj, _ := d.Find("ColorSpace")
	csObj, _ = ctx.XRefTable.Dereference(csObj)
	switch cs := csObj.(type) {
	case types.Name:
		switch cs {
		case "DeviceRGB":
			comps = 3
		case "DeviceGray":
			comps = 1
		}
	case types.Array:
		if len(cs) == 2 {
			if n, ok := cs[0].(types.Name); ok && n == "ICCBased" {
				if icc, _, err := ctx.XRefTable.DereferenceStreamDict(cs[1]); err == nil && icc != nil {
					if n, ok := dictInt(ctx, icc.Dict, "N"); ok && (n == 1 || n == 3) {
						comps = n
					}
				}
			}
		}
	}
	if comps == 0 || len(sd.FilterPipeline) != 1 {
		return sd, false
	}
	var img image.Image
	switch sd.FilterPipeline[0].Name {
	case "DCTDecode":
		if len(sd.Raw) == 0 {
			return sd, false
		}
		im, err := jpeg.Decode(bytes.NewReader(sd.Raw))
		if err != nil {
			return sd, false
		}
		if _, cmyk := im.(*image.CMYK); cmyk {
			return sd, false
		}
		img = im
	case "FlateDecode":
		if bpc != 8 {
			return sd, false
		}
		if err := sd.Decode(); err != nil || len(sd.Content) < w*h*comps {
			return sd, false
		}
		img = rawToImage(sd.Content, w, h, comps)
	default:
		return sd, false
	}
	b := img.Bounds()
	nw, nh := b.Dx(), b.Dy()
	if !hasSMask { // 투명도(SMask)가 있으면 크기를 바꾸지 않아요 (SMask 와 크기가 같아야 해요)
		if long := max(nw, nh); long > lv.MaxSide {
			nw = max(1, nw*lv.MaxSide/long)
			nh = max(1, nh*lv.MaxSide/long)
		}
	}
	var dst image.Image = img
	if nw != b.Dx() || nh != b.Dy() {
		if comps == 1 {
			g := image.NewGray(image.Rect(0, 0, nw, nh))
			xdraw.CatmullRom.Scale(g, g.Bounds(), img, b, xdraw.Src, nil)
			dst = g
		} else {
			c := image.NewRGBA(image.Rect(0, 0, nw, nh))
			xdraw.CatmullRom.Scale(c, c.Bounds(), img, b, xdraw.Src, nil)
			dst = c
		}
	} else if comps == 1 {
		if _, ok := img.(*image.Gray); !ok {
			g := image.NewGray(b)
			xdraw.Copy(g, b.Min, img, b, xdraw.Src, nil)
			dst = g
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: lv.Quality}); err != nil {
		return sd, false
	}
	old := int64(len(sd.Raw))
	if sd.StreamLength != nil && *sd.StreamLength > 0 {
		old = *sd.StreamLength
	}
	if int64(buf.Len()) >= old*9/10 {
		return sd, false
	}
	nd := types.Dict{}
	for k, v := range d {
		nd[k] = v
	}
	nd.Delete("DecodeParms")
	nd.Delete("Length")
	nd.Update("Filter", types.Name("DCTDecode"))
	nd.Update("Width", types.Integer(nw))
	nd.Update("Height", types.Integer(nh))
	nd.Update("BitsPerComponent", types.Integer(8))
	l := int64(buf.Len())
	nd.Update("Length", types.Integer(l))
	nsd := types.StreamDict{Dict: nd, StreamLength: &l, FilterPipeline: []types.PDFFilter{{Name: "DCTDecode"}}, Raw: buf.Bytes()}
	return nsd, true
}

func rawToImage(px []byte, w, h, comps int) image.Image {
	if comps == 1 {
		g := image.NewGray(image.Rect(0, 0, w, h))
		copy(g.Pix, px[:w*h])
		return g
	}
	im := image.NewRGBA(image.Rect(0, 0, w, h))
	for i, j := 0, 0; i < w*h; i, j = i+1, j+3 {
		im.Pix[i*4], im.Pix[i*4+1], im.Pix[i*4+2], im.Pix[i*4+3] = px[j], px[j+1], px[j+2], 255
	}
	return im
}

var _ = color.Gray{}

// POST {id} → {original, sizes:{low,mid,high}}
func (a *App) handleCompressEstimate(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID string `json:"id"`
	}
	readJSON(r, &in)
	it, ok := a.files.Get(in.ID)
	if !ok || it.Kind != "pdf" {
		jsonError(w, 400, "넣은 PDF를 찾지 못했어요. 파일을 다시 넣어 주세요")
		return
	}
	e := a.comp.estimate(it)
	if e.err != nil {
		jsonError(w, 400, e.err.Error())
		return
	}
	writeJSON(w, map[string]any{"ok": true, "original": it.Size, "sizes": e.sizes})
}

// POST {id, level, dir}
func (a *App) handleCompressSave(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID    string `json:"id"`
		Level string `json:"level"`
		Dir   string `json:"dir"`
	}
	readJSON(r, &in)
	it, ok := a.files.Get(in.ID)
	if !ok || it.Kind != "pdf" {
		jsonError(w, 400, "넣은 PDF를 찾지 못했어요. 파일을 다시 넣어 주세요")
		return
	}
	e := a.comp.estimate(it)
	if e.err != nil {
		jsonError(w, 400, e.err.Error())
		return
	}
	src, ok := e.paths[in.Level]
	if !ok {
		jsonError(w, 400, "얼마나 줄일지 골라 주세요")
		return
	}
	if e.sizes[in.Level] >= it.Size {
		jsonError(w, 400, "이 파일은 더 줄일 수 없어요. 이미 충분히 작아요")
		return
	}
	dir, err := a.destDir(it, in.Dir)
	if err != nil {
		jsonError(w, 400, err.Error())
		return
	}
	out := uniquePath(dir, it.Base+"_압축.pdf")
	if err := copyPlain(src, out); err != nil {
		os.Remove(out)
		jsonError(w, 500, "결과 파일을 저장하지 못했어요")
		return
	}
	a.finish(w, "compress", out, 1, false, map[string]any{"size": e.sizes[in.Level], "original": it.Size,
		"saved": fmt.Sprintf("%d%%", 100-int(e.sizes[in.Level]*100/max(it.Size, 1)))})
}
