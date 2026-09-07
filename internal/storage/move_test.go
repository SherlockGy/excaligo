package storage

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestMoveNoReplaceConcurrentDestination(t *testing.T) {
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	const count = 12
	for i := 0; i < count; i++ {
		name := fmt.Sprintf("source-%d", i)
		if err := root.WriteFile(name, []byte(name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	var wg sync.WaitGroup
	results := make(chan string, count)
	for i := 0; i < count; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			name := fmt.Sprintf("source-%d", i)
			if err := MoveNoReplace(root, name, "destination"); err == nil {
				results <- name
			}
		}(i)
	}
	wg.Wait()
	close(results)
	var winners []string
	for name := range results {
		winners = append(winners, name)
	}
	if len(winners) != 1 {
		t.Fatalf("wanted one winner, got %v", winners)
	}
	data, err := root.ReadFile("destination")
	if err != nil || string(data) != winners[0] {
		t.Fatal("destination overwritten", err)
	}
	for i := 0; i < count; i++ {
		name := fmt.Sprintf("source-%d", i)
		data, err := root.ReadFile(name)
		if name == winners[0] {
			if !os.IsNotExist(err) {
				t.Fatal("successful source still exists")
			}
		} else if err != nil || string(data) != name {
			t.Fatal("failed source changed", err)
		}
	}
}

func TestMoveNoReplaceRejectsParentEscapeAndKeepsSource(t *testing.T) {
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err := root.WriteFile("source", []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{".", "", filepath.Join("..", "outside"), filepath.Join("missing", "file"), filepath.Join("source", "child")} {
		if err := MoveNoReplace(root, "source", target); err == nil {
			t.Fatalf("accepted %s", target)
		}
	}
	for _, source := range []string{".", "..", "", filepath.Join("source", ".."), filepath.Join(dir, "source")} {
		if err := MoveNoReplace(root, source, "renamed"); err == nil {
			t.Fatalf("accepted non-child source %q", source)
		}
	}
	if data, err := root.ReadFile("source"); err != nil || string(data) != "original" {
		t.Fatal("source changed", err)
	}
}

func TestMoveNoReplaceDirectory(t *testing.T) {
	root, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	for _, name := range []string{"source", "existing"} {
		if err := root.Mkdir(name, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := root.WriteFile("source/drawing.excalidraw", []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := MoveNoReplace(root, "source", "existing"); err == nil {
		t.Fatal("overwrote an existing empty directory")
	}
	if err := MoveNoReplace(root, "source", "新"); err != nil {
		t.Fatal(err)
	}
	if data, err := root.ReadFile("新/drawing.excalidraw"); err != nil || string(data) != "original" {
		t.Fatal("directory content changed", err)
	}
	if _, err := root.Stat("source"); !os.IsNotExist(err) {
		t.Fatal("source directory still exists", err)
	}
}
