package icons

import (
	"bytes"
	"debug/pe"
	"encoding/binary"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"testing"
)

func read(t *testing.T, path string) []byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func checkPNG(t *testing.T, data []byte, size int) image.Image {
	t.Helper()
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != size || img.Bounds().Dy() != size {
		t.Fatalf("unexpected PNG size: %v", img.Bounds())
	}
	for _, point := range []image.Point{{0, 0}, {size - 1, 0}, {0, size - 1}, {size - 1, size - 1}} {
		_, _, _, a := img.At(point.X, point.Y).RGBA()
		if a != 0 {
			t.Fatal("icon corners must be transparent")
		}
	}
	return img
}

func TestCanonicalIcon(t *testing.T) {
	img := checkPNG(t, read(t, "icon.png"), 1024)
	partial, clear, opaque := 0, 0, 0
	for y := 0; y < 1024; y++ {
		for x := 0; x < 1024; x++ {
			_, _, _, alpha := img.At(x, y).RGBA()
			switch alpha {
			case 0:
				clear++
			case 65535:
				opaque++
			default:
				partial++
			}
		}
	}
	if partial < 1000 || clear < 100000 || opaque < 400000 {
		t.Fatalf("bad icon alpha: partial=%d clear=%d opaque=%d", partial, clear, opaque)
	}
	// White facial details and the drawing mark must not be removed with the background.
	for _, p := range []image.Point{{370, 250}, {501, 411}, {510, 760}} {
		_, _, _, a := img.At(p.X, p.Y).RGBA()
		if a != 65535 {
			t.Fatalf("interior detail unexpectedly transparent at %v", p)
		}
	}
	checkPNG(t, read(t, "../../frontend/public/excaliapp-icon.png"), 256)
}

func icoImages(t *testing.T, data []byte) [][]byte {
	t.Helper()
	if len(data) < 6 || binary.LittleEndian.Uint16(data[0:2]) != 0 || binary.LittleEndian.Uint16(data[2:4]) != 1 {
		t.Fatal("invalid ICO header")
	}
	count := int(binary.LittleEndian.Uint16(data[4:6]))
	if len(data) < 6+16*count {
		t.Fatal("truncated ICO directory")
	}
	var images [][]byte
	var sizes []int
	for i := 0; i < count; i++ {
		e := data[6+16*i : 6+16*(i+1)]
		size := int(e[0])
		if size == 0 {
			size = 256
		}
		length, offset := int(binary.LittleEndian.Uint32(e[8:12])), int(binary.LittleEndian.Uint32(e[12:16]))
		if length <= 0 || offset < 6+16*count || offset+length > len(data) {
			t.Fatal("invalid ICO payload")
		}
		payload := data[offset : offset+length]
		checkPNG(t, payload, size)
		images = append(images, payload)
		sizes = append(sizes, size)
	}
	slices.Sort(sizes)
	if !slices.Equal(sizes, []int{16, 24, 32, 48, 64, 96, 128, 256}) {
		t.Fatalf("missing ICO sizes: %v", sizes)
	}
	return images
}

func TestWindowsIconSizes(t *testing.T) { icoImages(t, read(t, "icon.ico")) }

func TestMacIconSizes(t *testing.T) {
	data := read(t, "icon.icns")
	if len(data) < 8 || string(data[:4]) != "icns" || int(binary.BigEndian.Uint32(data[4:8])) != len(data) {
		t.Fatal("invalid ICNS header")
	}
	expected := map[string]int{"ic10": 1024, "ic14": 512, "ic09": 512, "ic13": 256, "ic08": 256, "ic07": 128, "ic12": 64, "ic11": 32}
	for p := 8; p < len(data); {
		if p+8 > len(data) {
			t.Fatal("truncated ICNS chunk")
		}
		typeID := string(data[p : p+4])
		n := int(binary.BigEndian.Uint32(data[p+4 : p+8]))
		if n < 8 || p+n > len(data) {
			t.Fatal("invalid ICNS chunk")
		}
		if size, ok := expected[typeID]; ok {
			checkPNG(t, data[p+8:p+n], size)
			delete(expected, typeID)
		}
		p += n
	}
	if len(expected) != 0 {
		t.Fatalf("missing ICNS representations: %v", expected)
	}
}

// Inspect the linked PE resource tree, not just an ICO sitting next to the EXE.
// Format: https://learn.microsoft.com/windows/win32/debug/pe-format#the-rsrc-section
func TestPackagedWindowsIcon(t *testing.T) {
	path := os.Getenv("EXCALIGO_TEST_WINDOWS_EXE")
	if path == "" && runtime.GOOS == "windows" {
		path = filepath.Join("..", "..", "bin", "excaligo.exe")
	}
	if path == "" {
		t.Skip("Windows executable verification requires a built artifact")
	}
	f, err := pe.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	section := f.Section(".rsrc")
	if section == nil {
		t.Fatal("EXE has no embedded resources")
	}
	data, err := section.Data()
	if err != nil {
		t.Fatal(err)
	}
	var root uint32
	switch h := f.OptionalHeader.(type) {
	case *pe.OptionalHeader64:
		root = h.DataDirectory[2].VirtualAddress
	case *pe.OptionalHeader32:
		root = h.DataDirectory[2].VirtualAddress
	default:
		t.Fatal("invalid PE optional header")
	}
	root -= section.VirtualAddress
	span := func(offset, n uint32) []byte {
		if uint64(offset)+uint64(n) > uint64(len(data)) {
			t.Fatal("truncated PE resource")
		}
		return data[offset : offset+n]
	}
	u32 := func(p uint32) uint32 { return binary.LittleEndian.Uint32(span(p, 4)) }
	resources := map[uint32]map[uint32][]byte{}
	var walk func(uint32, []uint32)
	walk = func(offset uint32, keys []uint32) {
		if len(keys) > 2 {
			t.Fatal("invalid resource nesting")
		}
		start := root + offset
		h := span(start, 16)
		count := uint32(binary.LittleEndian.Uint16(h[12:14])) + uint32(binary.LittleEndian.Uint16(h[14:16]))
		for i := uint32(0); i < count; i++ {
			p := start + 16 + i*8
			id, entry := u32(p), u32(p+4)
			if id&0x80000000 != 0 {
				continue
			}
			next := append(slices.Clone(keys), id)
			if entry&0x80000000 != 0 {
				walk(entry&0x7fffffff, next)
				continue
			}
			if len(next) != 3 {
				t.Fatal("invalid resource leaf")
			}
			leaf := root + entry
			rva, n := u32(leaf), u32(leaf+4)
			if resources[next[0]] == nil {
				resources[next[0]] = map[uint32][]byte{}
			}
			resources[next[0]][next[1]] = span(rva-section.VirtualAddress, n)
		}
	}
	walk(0, nil)
	group := resources[14][3] // Wails loads application icon group ID 3.
	if len(group) < 6 {
		t.Fatal("missing Wails icon group 3")
	}
	count := int(binary.LittleEndian.Uint16(group[4:6]))
	expected := icoImages(t, read(t, "icon.ico"))
	if count != len(expected) || len(group) != 6+count*14 {
		t.Fatal("incomplete embedded icon group")
	}
	for i := 0; i < count; i++ {
		id := uint32(binary.LittleEndian.Uint16(group[6+i*14+12 : 6+i*14+14]))
		actual := resources[3][id]
		found := slices.ContainsFunc(expected, func(candidate []byte) bool { return bytes.Equal(candidate, actual) })
		if !found {
			t.Fatalf("embedded icon %d does not match the app ICO", id)
		}
	}
	if len(resources[24][1]) == 0 || len(resources[16]) == 0 {
		t.Fatal("manifest or version information missing")
	}
}
