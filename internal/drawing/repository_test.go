package drawing

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func workspace(t *testing.T) (*Repository, string) {
	t.Helper()
	r := NewRepository(nil)
	dir, err := r.AllowDirectory(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := r.Close(); err != nil {
			t.Error(err)
		}
	})
	return r, dir
}

func TestFileLifecycleAndLosslessRoundTrip(t *testing.T) {
	r, dir := workspace(t)
	file, err := r.CreateFile(dir, "设计")
	if err != nil {
		t.Fatal(err)
	}
	original, err := r.Read(file)
	if err != nil {
		t.Fatal(err)
	}
	if original.Content != DefaultContent || original.ContentHash != Hash(DefaultContent) {
		t.Fatal("invalid new drawing")
	}
	content := `{"type":"excalidraw","version":2,"elements":[{"id":"图1","x":1}],"files":{"img":{"dataURL":"data:image/png;base64,AAAA"}},"custom":"preserve"}`
	saved, err := r.Save(file, content, original.ContentHash)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := r.Read(file)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Content != content || loaded.ContentHash != saved.ContentHash || saved.Conflict {
		t.Fatal("round trip changed content")
	}
	if _, err := r.Save(file, `{broken`, loaded.ContentHash); err == nil {
		t.Fatal("accepted invalid content")
	}
	loaded, _ = r.Read(file)
	if loaded.Content != content {
		t.Fatal("invalid write destroyed original")
	}
	if _, err := r.Save(file, DefaultContent, loaded.ContentHash); err != nil {
		t.Fatal(err)
	}
	renamed, err := r.RenameFile(file, "renamed.json")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(renamed, "renamed.excalidraw") {
		t.Fatal(renamed)
	}
	if err := r.DeleteFile(renamed); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(renamed); !os.IsNotExist(err) {
		t.Fatal("file still exists")
	}
}

func TestTreeAndFolderLifecycle(t *testing.T) {
	r, dir := workspace(t)
	folder, err := r.CreateFolder(dir, "z-folder")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = r.CreateFile(folder, "nested")
	_, _ = r.CreateFile(dir, "a")
	if err := os.Mkdir(filepath.Join(dir, ".hidden"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{".hidden/secret.excalidraw", ".secret.excalidraw", "notes.txt"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(DefaultContent), 0600); err != nil {
			t.Fatal(err)
		}
	}
	tree, err := r.Tree(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(tree) != 2 || !tree[0].IsDirectory || len(tree[0].Children) != 1 || tree[1].Name != "a.excalidraw" {
		t.Fatalf("tree=%+v", tree)
	}
	files, err := r.List(dir)
	if err != nil || len(files) != 2 || files[0].Name != "a.excalidraw" {
		t.Fatalf("files=%+v, err=%v", files, err)
	}
	renamed, err := r.RenameFolder(folder, "renamed")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.Read(filepath.Join(renamed, "nested.excalidraw")); err != nil {
		t.Fatal(err)
	}
	if err := r.DeleteFolder(renamed); err != nil {
		t.Fatal(err)
	}
	if err := r.DeleteFolder(dir); err == nil {
		t.Fatal("allowed root deletion")
	}
}

func TestUniqueNamesAndConcurrentCreate(t *testing.T) {
	r, dir := workspace(t)
	const count = 12
	paths := make(chan string, count)
	failures := make(chan error, count)
	var wg sync.WaitGroup
	for i := 0; i < count; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); path, err := r.CreateFile(dir, "same"); paths <- path; failures <- err }()
	}
	wg.Wait()
	close(paths)
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	seen := map[string]bool{}
	for path := range paths {
		if seen[path] {
			t.Fatal("duplicate path")
		}
		seen[path] = true
	}
	if len(seen) != count {
		t.Fatal("lost files")
	}
	first, err := r.CreateFolder(dir, "folder")
	if err != nil {
		t.Fatal(err)
	}
	second, err := r.CreateFolder(dir, "folder")
	if err != nil || second != first+"-1" {
		t.Fatalf("%s %v", second, err)
	}
	if _, err := r.RenameFile(filepath.Join(dir, "same.excalidraw"), "same-1"); err == nil {
		t.Fatal("rename overwrote file")
	}
}

func TestPathTraversalAndSymlinkEscape(t *testing.T) {
	r, dir := workspace(t)
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret.excalidraw")
	if err := os.WriteFile(secret, []byte(DefaultContent), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Read(secret); err == nil {
		t.Fatal("read outside root")
	}
	if _, err := r.Save(secret, DefaultContent, Hash(DefaultContent)); err == nil {
		t.Fatal("wrote outside root")
	}
	if err := os.Symlink(outside, filepath.Join(dir, "escape")); err != nil {
		t.Skip(err)
	}
	if _, err := r.Read(filepath.Join(dir, "escape", "secret.excalidraw")); err == nil {
		t.Fatal("followed symlink escape")
	}
	if err := r.DeleteFolder(filepath.Join(dir, "escape")); err == nil {
		t.Fatal("deleted symlink target")
	}
	if _, err := r.CreateFile(filepath.Join(dir, "escape"), "new"); err == nil {
		t.Fatal("created outside root")
	}
	if _, err := r.Tree(dir); err != nil {
		t.Fatal("tree should skip symlinks:", err)
	}
	if _, err := os.Stat(secret); err != nil {
		t.Fatal("damaged outside file")
	}
	if _, err := r.RenameFolder(dir, "root"); err == nil {
		t.Fatal("renamed root")
	}
}

func TestSaveAsAndExhaustion(t *testing.T) {
	r, dir := workspace(t)
	path := filepath.Join(dir, "copy.excalidraw")
	if _, err := r.Save(path, DefaultContent, Hash(DefaultContent)); err == nil {
		t.Fatal("regular save created missing file")
	}
	if _, err := r.SaveAs(path, DefaultContent); err != nil {
		t.Fatal(err)
	}
	if _, err := r.SaveAs(filepath.Join(dir, "copy.txt"), DefaultContent); err == nil {
		t.Fatal("accepted wrong extension")
	}
	for i := 0; i <= 100; i++ {
		name := "full.excalidraw"
		if i > 0 {
			name = fmt.Sprintf("full-%d.excalidraw", i)
		}
		if err := os.WriteFile(filepath.Join(dir, name), []byte(DefaultContent), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := r.CreateFile(dir, "full"); err == nil {
		t.Fatal("expected collision limit")
	}
}

func TestSourceExamples(t *testing.T) {
	r, dir := workspace(t)
	entries, err := os.ReadDir("../../examples")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) != Extension {
			continue
		}
		t.Run(entry.Name(), func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join("../../examples", entry.Name()))
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(dir, entry.Name())
			hash, err := r.SaveAs(path, string(data))
			if err != nil {
				t.Fatal(err)
			}
			got, err := r.Read(path)
			if err != nil || got.Content != string(data) || got.ContentHash != hash {
				t.Fatal("source example changed", err)
			}
		})
	}
}

func TestOverlappingDirectoryCapabilities(t *testing.T) {
	for _, parentFirst := range []bool{true, false} {
		t.Run(fmt.Sprint(parentFirst), func(t *testing.T) {
			r := NewRepository(nil)
			defer r.Close()
			parent := t.TempDir()
			parent, err := filepath.EvalSymlinks(parent)
			if err != nil {
				t.Fatal(err)
			}
			child := filepath.Join(parent, "child")
			if err := os.Mkdir(child, 0700); err != nil {
				t.Fatal(err)
			}
			dirs := []string{parent, child}
			if !parentFirst {
				dirs = []string{child, parent}
			}
			for _, dir := range dirs {
				if _, err := r.AllowDirectory(dir); err != nil {
					t.Fatal(err)
				}
			}
			if len(r.roots) != 1 {
				t.Fatalf("overlapping capabilities: %d", len(r.roots))
			}
			if _, err := r.CreateFile(child, "drawing"); err != nil {
				t.Fatal(err)
			}
			renamed, err := r.RenameFolder(child, "renamed")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := r.Read(filepath.Join(renamed, "drawing.excalidraw")); err != nil {
				t.Fatal(err)
			}
			if err := r.DeleteFolder(renamed); err != nil {
				t.Fatal(err)
			}
		})
	}
}
