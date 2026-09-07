package storage

import (
	"os"
	"testing"
)

func TestWriteAtomicPreservesExistingOnFailure(t *testing.T) {
	root, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err := WriteAtomic(root, "drawing.excalidraw", []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := WriteAtomic(root, "drawing.excalidraw", []byte("replacement"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := WriteAtomic(root, "missing/drawing.excalidraw", []byte("bad"), 0600); err == nil {
		t.Fatal("expected write error")
	}
	got, err := root.ReadFile("drawing.excalidraw")
	if err != nil || string(got) != "replacement" {
		t.Fatalf("%q %v", got, err)
	}
	entries, err := os.ReadDir(root.Name())
	if err != nil || len(entries) != 1 {
		t.Fatalf("leaked temporary files: %v %v", entries, err)
	}
}
