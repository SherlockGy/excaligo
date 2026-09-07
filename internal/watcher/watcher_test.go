package watcher

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func awaitPath(t *testing.T, events <-chan string, want string) {
	t.Helper()
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	for {
		select {
		case path := <-events:
			if path == want {
				return
			}
		case <-timer.C:
			t.Fatalf("no event for %s", want)
		}
	}
}

func TestRecursiveWatchReplacementAndShutdown(t *testing.T) {
	events := make(chan string, 100)
	w := New(func(path string) { events <- path }, nil)
	t.Cleanup(func() { _ = w.Close() })
	first, second := t.TempDir(), t.TempDir()
	if err := w.Watch(first); err != nil {
		t.Fatal(err)
	}
	nested := filepath.Join(first, "nested")
	if err := os.Mkdir(nested, 0700); err != nil {
		t.Fatal(err)
	}
	awaitPath(t, events, nested)
	file := filepath.Join(nested, "drawing.excalidraw")
	if err := os.WriteFile(file, []byte("one"), 0600); err != nil {
		t.Fatal(err)
	}
	awaitPath(t, events, file)
	if err := os.WriteFile(file, []byte("two"), 0600); err != nil {
		t.Fatal(err)
	}
	awaitPath(t, events, file)
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	awaitPath(t, events, file)
	if err := w.Watch(second); err != nil {
		t.Fatal(err)
	}
	for len(events) > 0 {
		<-events
	}
	if err := os.WriteFile(file, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	newFile := filepath.Join(second, "new.excalidraw")
	if err := os.WriteFile(newFile, []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	select {
	case path := <-events:
		if path != newFile {
			t.Fatalf("stale watch event: %s", path)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("replacement did not emit")
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestFailedReplacementKeepsExistingWatch(t *testing.T) {
	events := make(chan string, 20)
	w := New(func(path string) { events <- path }, nil)
	defer w.Close()
	dir := t.TempDir()
	if err := w.Watch(dir); err != nil {
		t.Fatal(err)
	}
	if err := w.Watch(filepath.Join(dir, "missing")); err == nil {
		t.Fatal("accepted missing directory")
	}
	file := filepath.Join(dir, "still-watched.excalidraw")
	if err := os.WriteFile(file, []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	awaitPath(t, events, file)
}
