package main

// 그림 → PDF 쓰기 (MSROAD 의 pdfout.go 를 가져와 회전(Rot)을 더했어요)
//
// 페이지마다 '무엇을 어디에' 그릴지 mm 단위로 정해요:
//   image : 넣은 그림(id) · box = 그림이 놓일 자리 · rot = 사용자가 돌린 각도(시계 방향 0/90/180/270)
//   line  : 선 (지금은 안 써요)
// JPEG 은 다시 압축하지 않고 그대로 넣어서(화질 그대로) 빠르고, PNG · GIF · WEBP · TIFF · BMP 는 무손실로 넣어요.
// 휴대폰 사진의 회전 정보(EXIF)도 그대로 따라요.

import (
	"bytes"
	"compress/zlib"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
	"math"
	"strconv"
	"strings"
)

type PrintSpec struct {
	Name  string      `json:"name"`
	W     float64     `json:"w"` // 용지 너비 (mm)
	H     float64     `json:"h"` // 용지 높이 (mm)
	Pages []PrintPage `json:"pages"`
	geo   [][2]float64 // 페이지마다 다른 용지 크기 (mm) — 없으면 W × H
}

type PrintPage struct {
	Ops []PrintOp `json:"ops"`
}

type PrintOp struct {
	Type  string    `json:"type"` // image | line
	ID    string    `json:"id"`   // 라이브러리 악보
	P     int       `json:"p"`    // 악보 안의 파일 번호
	Data  string    `json:"data"` // base64 (JPEG/PNG)
	Box   []float64 `json:"box"`  // x, y, w, h (mm, 왼쪽 위 기준)
	Clip  []float64 `json:"clip"` // x, y, w, h (mm) — 없으면 가리지 않음
	Line  []float64 `json:"line"` // x1, y1, x2, y2 (mm)
	Width float64   `json:"width"`
	Gray  float64   `json:"gray"`
	Rot   int       `json:"rot"`  // 시계 방향 0 | 90 | 180 | 270
}

const ptPerMM = 72.0 / 25.4

type pdfImg struct {
	w, h   int
	comps  int
	filter string
	data   []byte
	smask  []byte // 투명도 (Flate, DeviceGray) — 없으면 nil
	orient int    // EXIF 방향 1~8
	cmyk   bool
}

// loadPDFImage turns JPEG/PNG/GIF bytes into something a PDF can hold.
func loadPDFImage(b []byte) (*pdfImg, error) {
	if len(b) > 3 && b[0] == 0xFF && b[1] == 0xD8 {
		cfg, err := jpeg.DecodeConfig(bytes.NewReader(b))
		if err != nil {
			return nil, fmt.Errorf("JPEG 을 읽지 못했어요: %v", err)
		}
		im := &pdfImg{w: cfg.Width, h: cfg.Height, filter: "DCTDecode", data: b, orient: exifOrientation(b)}
		switch cfg.ColorModel {
		case color.GrayModel:
			im.comps = 1
		case color.CMYKModel:
			im.comps, im.cmyk = 4, true
		default:
			im.comps = 3
		}
		return im, nil
	}
	src, _, err := image.Decode(bytes.NewReader(b))
	if err != nil {
		return nil, fmt.Errorf("그림을 읽지 못했어요: %v", err)
	}
	return rawPDFImage(src)
}

func rawPDFImage(src image.Image) (*pdfImg, error) {
	r := src.Bounds()
	w, h := r.Dx(), r.Dy()
	if w <= 0 || h <= 0 {
		return nil, errors.New("빈 그림이에요")
	}
	n := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.Draw(n, n.Bounds(), src, r.Min, draw.Src)
	gray, opaque := true, true
	for i := 0; i < len(n.Pix); i += 4 {
		if n.Pix[i] != n.Pix[i+1] || n.Pix[i] != n.Pix[i+2] {
			gray = false
		}
		if n.Pix[i+3] != 255 {
			opaque = false
		}
		if !gray && !opaque {
			break
		}
	}
	comps := 3
	if gray {
		comps = 1
	}
	raw := make([]byte, 0, w*h*comps)
	var alpha []byte
	if !opaque {
		alpha = make([]byte, 0, w*h)
	}
	for i := 0; i < len(n.Pix); i += 4 {
		if gray {
			raw = append(raw, n.Pix[i])
		} else {
			raw = append(raw, n.Pix[i], n.Pix[i+1], n.Pix[i+2])
		}
		if alpha != nil {
			alpha = append(alpha, n.Pix[i+3])
		}
	}
	im := &pdfImg{w: w, h: h, comps: comps, filter: "FlateDecode", data: deflate(raw), orient: 1}
	if alpha != nil {
		im.smask = deflate(alpha)
	}
	return im, nil
}

func deflate(b []byte) []byte {
	var buf bytes.Buffer
	zw, _ := zlib.NewWriterLevel(&buf, zlib.BestSpeed)
	zw.Write(b)
	zw.Close()
	return buf.Bytes()
}

// exifOrientation reads the EXIF orientation tag (1 = 그대로) from a JPEG.
func exifOrientation(b []byte) int {
	i := 2
	for i+4 <= len(b) && b[i] == 0xFF {
		marker := b[i+1]
		if marker == 0xD8 || (marker >= 0xD0 && marker <= 0xD7) || marker == 0x01 {
			i += 2
			continue
		}
		if marker == 0xDA || marker == 0xD9 {
			break
		}
		size := int(binary.BigEndian.Uint16(b[i+2:]))
		if size < 2 || i+2+size > len(b) {
			break
		}
		seg := b[i+4 : i+2+size]
		if marker == 0xE1 && len(seg) > 14 && string(seg[:6]) == "Exif\x00\x00" {
			if o := tiffOrientation(seg[6:]); o >= 1 && o <= 8 {
				return o
			}
		}
		i += 2 + size
	}
	return 1
}

func tiffOrientation(t []byte) int {
	if len(t) < 8 {
		return 1
	}
	var bo binary.ByteOrder
	switch string(t[:2]) {
	case "II":
		bo = binary.LittleEndian
	case "MM":
		bo = binary.BigEndian
	default:
		return 1
	}
	off := int(bo.Uint32(t[4:]))
	if off+2 > len(t) {
		return 1
	}
	n := int(bo.Uint16(t[off:]))
	for k := 0; k < n; k++ {
		e := off + 2 + k*12
		if e+12 > len(t) {
			break
		}
		if bo.Uint16(t[e:]) == 0x0112 {
			return int(bo.Uint16(t[e+8:]))
		}
	}
	return 1
}

// orientMatrix maps the stored image's unit square to the upright (displayed) unit square.
func orientMatrix(o int) [6]float64 {
	switch o {
	case 2:
		return [6]float64{-1, 0, 0, 1, 1, 0}
	case 3:
		return [6]float64{-1, 0, 0, -1, 1, 1}
	case 4:
		return [6]float64{1, 0, 0, -1, 0, 1}
	case 5:
		return [6]float64{0, -1, -1, 0, 1, 1}
	case 6:
		return [6]float64{0, -1, 1, 0, 0, 1}
	case 7:
		return [6]float64{0, 1, 1, 0, 0, 0}
	case 8:
		return [6]float64{0, 1, -1, 0, 1, 0}
	}
	return [6]float64{1, 0, 0, 1, 0, 0}
}

// rotMatrix turns the (upright) unit square clockwise by r degrees.
func rotMatrix(r int) ([6]float64, bool) {
	switch ((r % 360) + 360) % 360 {
	case 90:
		return [6]float64{0, -1, 1, 0, 0, 1}, true
	case 180:
		return [6]float64{-1, 0, 0, -1, 1, 1}, true
	case 270:
		return [6]float64{0, 1, -1, 0, 1, 0}, true
	}
	return [6]float64{}, false
}

func fnum(v float64) string {
	if math.Abs(v) < 0.00005 {
		return "0"
	}
	s := strconv.FormatFloat(v, 'f', 4, 64)
	s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	if s == "-0" {
		return "0"
	}
	return s
}

func validRect(r []float64) bool {
	if len(r) != 4 {
		return false
	}
	for _, v := range r {
		if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > 10000 {
			return false
		}
	}
	return r[2] > 0 && r[3] > 0
}

// buildPDF writes the whole document. resolve returns the file bytes (JPEG/PNG/GIF) of a library page.
func buildPDF(spec *PrintSpec, resolve func(id string, p int) ([]byte, error)) ([]byte, int, error) {
	if spec.W < 20 || spec.H < 20 || spec.W > 2000 || spec.H > 2000 {
		return nil, 0, errors.New("용지 크기가 이상해요")
	}
	if len(spec.Pages) == 0 {
		return nil, 0, errors.New("PDF로 만들 그림이 없어요")
	}
	if len(spec.Pages) > 500 {
		return nil, 0, errors.New("페이지가 너무 많아요")
	}
	pw, ph := spec.W*ptPerMM, spec.H*ptPerMM

	var out bytes.Buffer
	var offsets []int
	newObj := func() int { offsets = append(offsets, 0); return len(offsets) }
	writeObj := func(n int, body string, stream []byte) {
		offsets[n-1] = out.Len()
		fmt.Fprintf(&out, "%d 0 obj\n%s", n, body)
		if stream != nil {
			out.WriteString("\nstream\n")
			out.Write(stream)
			out.WriteString("\nendstream")
		}
		out.WriteString("\nendobj\n")
	}
	out.WriteString("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")
	catalog, pagesObj := newObj(), newObj()

	type imgRef struct {
		obj  int
		name string
		im   *pdfImg
	}
	images := map[string]*imgRef{}
	getImage := func(op *PrintOp) (*imgRef, error) {
		var key string
		var raw []byte
		if op.Data != "" {
			d := op.Data
			if i := strings.Index(d, ","); i >= 0 && strings.HasPrefix(d, "data:") {
				d = d[i+1:]
			}
			b, err := base64.StdEncoding.DecodeString(d)
			if err != nil {
				return nil, errors.New("그림 데이터가 잘못됐어요")
			}
			h := sha1.Sum(b)
			key = "d:" + hex.EncodeToString(h[:])
			raw = b
		} else {
			key = "l:" + op.ID + ":" + strconv.Itoa(op.P)
		}
		if r, ok := images[key]; ok {
			return r, nil
		}
		if raw == nil {
			b, err := resolve(op.ID, op.P)
			if err != nil {
				return nil, err
			}
			raw = b
		}
		im, err := loadPDFImage(raw)
		if err != nil {
			return nil, err
		}
		n := newObj()
		var smaskObj int
		if im.smask != nil {
			smaskObj = newObj()
			writeObj(smaskObj, fmt.Sprintf("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length %d >>", im.w, im.h, len(im.smask)), im.smask)
		}
		cs := map[int]string{1: "/DeviceGray", 3: "/DeviceRGB", 4: "/DeviceCMYK"}[im.comps]
		extra := ""
		if im.cmyk {
			extra = " /Decode [1 0 1 0 1 0 1 0]" // Adobe 방식 CMYK JPEG 은 값이 뒤집혀 있어요
		}
		if smaskObj != 0 {
			extra += fmt.Sprintf(" /SMask %d 0 R", smaskObj)
		}
		writeObj(n, fmt.Sprintf("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s /BitsPerComponent 8 /Filter /%s%s /Length %d >>", im.w, im.h, cs, im.filter, extra, len(im.data)), im.data)
		r := &imgRef{obj: n, name: "Im" + strconv.Itoa(len(images)+1), im: im}
		images[key] = r
		return r, nil
	}

	var pageObjs []int
	for pi, pg := range spec.Pages {
		pw, ph := pw, ph
		if pi < len(spec.geo) {
			pw, ph = spec.geo[pi][0]*ptPerMM, spec.geo[pi][1]*ptPerMM
		}
		var cs strings.Builder
		used := map[string]int{}
		for i := range pg.Ops {
			op := &pg.Ops[i]
			switch op.Type {
			case "image":
				if !validRect(op.Box) {
					continue
				}
				ref, err := getImage(op)
				if err != nil {
					return nil, 0, err
				}
				used[ref.name] = ref.obj
				cs.WriteString("q\n")
				if validRect(op.Clip) {
					x, y, w, h := op.Clip[0]*ptPerMM, ph-(op.Clip[1]+op.Clip[3])*ptPerMM, op.Clip[2]*ptPerMM, op.Clip[3]*ptPerMM
					fmt.Fprintf(&cs, "%s %s %s %s re W n\n", fnum(x), fnum(y), fnum(w), fnum(h))
				}
				bx, by := op.Box[0]*ptPerMM, ph-(op.Box[1]+op.Box[3])*ptPerMM
				bw, bh := op.Box[2]*ptPerMM, op.Box[3]*ptPerMM
				fmt.Fprintf(&cs, "%s 0 0 %s %s %s cm\n", fnum(bw), fnum(bh), fnum(bx), fnum(by))
				if rm, ok := rotMatrix(op.Rot); ok {
					fmt.Fprintf(&cs, "%s %s %s %s %s %s cm\n", fnum(rm[0]), fnum(rm[1]), fnum(rm[2]), fnum(rm[3]), fnum(rm[4]), fnum(rm[5]))
				}
				if ref.im.orient != 1 {
					m := orientMatrix(ref.im.orient)
					fmt.Fprintf(&cs, "%s %s %s %s %s %s cm\n", fnum(m[0]), fnum(m[1]), fnum(m[2]), fnum(m[3]), fnum(m[4]), fnum(m[5]))
				}
				fmt.Fprintf(&cs, "/%s Do\nQ\n", ref.name)
			case "line":
				if len(op.Line) != 4 {
					continue
				}
				w := op.Width
				if w <= 0 || w > 5 {
					w = 0.3
				}
				g := math.Max(0, math.Min(1, op.Gray))
				fmt.Fprintf(&cs, "q %s G %s w %s %s m %s %s l S Q\n", fnum(g), fnum(w*ptPerMM),
					fnum(op.Line[0]*ptPerMM), fnum(ph-op.Line[1]*ptPerMM), fnum(op.Line[2]*ptPerMM), fnum(ph-op.Line[3]*ptPerMM))
			}
		}
		content := deflate([]byte(cs.String()))
		cobj := newObj()
		writeObj(cobj, fmt.Sprintf("<< /Filter /FlateDecode /Length %d >>", len(content)), content)
		var res strings.Builder
		res.WriteString("<< /XObject <<")
		for name, obj := range used {
			fmt.Fprintf(&res, " /%s %d 0 R", name, obj)
		}
		res.WriteString(" >> /ProcSet [/PDF /ImageB /ImageC] >>")
		pobj := newObj()
		writeObj(pobj, fmt.Sprintf("<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %s %s] /Resources %s /Contents %d 0 R >>", pagesObj, fnum(pw), fnum(ph), res.String(), cobj), nil)
		pageObjs = append(pageObjs, pobj)
	}
	kids := make([]string, len(pageObjs))
	for i, n := range pageObjs {
		kids[i] = strconv.Itoa(n) + " 0 R"
	}
	writeObj(pagesObj, fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), len(pageObjs)), nil)
	writeObj(catalog, fmt.Sprintf("<< /Type /Catalog /Pages %d 0 R >>", pagesObj), nil)
	info := newObj()
	writeObj(info, "<< /Producer (PaperROAD) /Creator (PaperROAD - made by. Nevertheless_D) >>", nil)

	xref := out.Len()
	fmt.Fprintf(&out, "xref\n0 %d\n0000000000 65535 f \n", len(offsets)+1)
	for _, o := range offsets {
		fmt.Fprintf(&out, "%010d 00000 n \n", o)
	}
	fmt.Fprintf(&out, "trailer\n<< /Size %d /Root %d 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets)+1, catalog, info, xref)
	return out.Bytes(), len(pageObjs), nil
}
