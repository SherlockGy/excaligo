package drawing

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestMoveFilePreservesBytesMetadataAndCanReturnToRoot(t *testing.T) {
	r, dir := workspace(t)
	file, err := r.CreateFile(dir, "设计 图")
	if err != nil {
		t.Fatal(err)
	}
	folder, err := r.CreateFolder(dir, "目标")
	if err != nil {
		t.Fatal(err)
	}
	content := DefaultContent + "\n  "
	if err := os.WriteFile(file, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	modified := time.Unix(1700000000, 0)
	if err := os.Chtimes(file, modified, modified); err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	moved, err := r.MoveFile(file, folder)
	if err != nil {
		t.Fatal(err)
	}
	if moved != filepath.Join(folder, filepath.Base(file)) {
		t.Fatal(moved)
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatalf("source still exists: %v", err)
	}
	after, err := os.Stat(moved)
	if err != nil {
		t.Fatal(err)
	}
	if !before.ModTime().Equal(after.ModTime()) || before.Mode() != after.Mode() {
		t.Fatal("move changed metadata")
	}
	read, err := r.Read(moved)
	if err != nil || read.Content != content {
		t.Fatalf("bytes changed: %v", err)
	}
	returned, err := r.MoveFile(moved, dir)
	if err != nil || returned != file {
		t.Fatalf("return to root: %s %v", returned, err)
	}
	if noOp, err := r.MoveFile(file, dir); err != nil || noOp != file {
		t.Fatalf("same directory: %s %v", noOp, err)
	}
}

func TestMoveRejectsCollisionsAndInvalidTargets(t *testing.T) {
	r, dir := workspace(t)
	file, _ := r.CreateFile(dir, "source")
	folder, _ := r.CreateFolder(dir, "target")
	destination, _ := r.CreateFile(folder, "source")
	const marker = "do not overwrite"
	if err := os.WriteFile(destination, []byte(marker), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := r.MoveFile(file, folder); err == nil {
		t.Fatal("overwrote collision")
	}
	data, err := os.ReadFile(destination)
	if err != nil || string(data) != marker {
		t.Fatal("destination changed", err)
	}
	outside := t.TempDir()
	for _, target := range []string{outside, file, filepath.Join(dir, "missing")} {
		if _, err := r.MoveFile(file, target); err == nil {
			t.Fatalf("accepted %s", target)
		}
	}
	if _, err := r.MoveFile(folder, dir); err == nil {
		t.Fatal("moved directory through file API")
	}
	if _, err := r.MoveFile(filepath.Join(dir, "missing.excalidraw"), folder); err == nil {
		t.Fatal("moved missing file")
	}
	if _, err := r.AllowDirectory(outside); err != nil {
		t.Fatal(err)
	}
	if _, err := r.MoveFile(file, outside); err == nil {
		t.Fatal("moved across workspace capabilities")
	}
	if _, err := r.Read(file); err != nil {
		t.Fatal("source lost after failed move", err)
	}
}

func TestMoveRejectsSymlinksAndEscape(t *testing.T) {
	r, dir := workspace(t)
	file, _ := r.CreateFile(dir, "source")
	folder, _ := r.CreateFolder(dir, "target")
	outside := t.TempDir()
	link := filepath.Join(dir, "escape")
	if err := os.Symlink(outside, link); err != nil {
		t.Skip(err)
	}
	if _, err := r.MoveFile(file, link); err == nil {
		t.Fatal("followed symlink target")
	}
	if _, err := r.MoveFile(file, filepath.Join(link, "nested")); err == nil {
		t.Fatal("escaped root")
	}
	fileLink := filepath.Join(dir, "linked.excalidraw")
	if err := os.Symlink(file, fileLink); err != nil {
		t.Fatal(err)
	}
	if _, err := r.MoveFile(fileLink, folder); err == nil {
		t.Fatal("moved symbolic link")
	}
	if _, err := r.Read(file); err != nil {
		t.Fatal("source changed", err)
	}
}
