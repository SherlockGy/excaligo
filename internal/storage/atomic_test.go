package storage

import (
	"errors"
	"os"
	"testing"
)

func TestWriteAtomicCheckedAbortsAndCleansUp(t *testing.T) {
	root, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	changed := errors.New("changed after preparing temporary file")
	err = WriteAtomicChecked(root, "drawing.excalidraw", []byte("local"), 0600, func() error {
		// Simulate an external writer finishing while the temp file is prepared.
		if err := WriteAtomic(root, "drawing.excalidraw", []byte("external"), 0600); err != nil {
			t.Fatal(err)
		}
		return changed
	})
	if !errors.Is(err, changed) {
		t.Fatalf("check not honored: %v", err)
	}
	if data, _ := root.ReadFile("drawing.excalidraw"); string(data) != "external" {
		t.Fatal("overwrote external file")
	}
	entries, err := os.ReadDir(root.Name())
	if err != nil || len(entries) != 1 {
		t.Fatalf("temporary file leaked: %v %v", entries, err)
	}
}

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
