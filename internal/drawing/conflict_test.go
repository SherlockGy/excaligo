package drawing

import (
	"os"
	"testing"
)

func TestSaveRequiresVersionAndRejectsExternalChanges(t *testing.T) {
	r, dir := workspace(t)
	path, err := r.CreateFile(dir, "conflict")
	if err != nil {
		t.Fatal(err)
	}
	local := DefaultContent + "\n"
	external := DefaultContent + "\n\n"
	if _, err := r.Save(path, local, ""); err == nil {
		t.Fatal("accepted unversioned write")
	}
	if err := os.WriteFile(path, []byte(external), 0600); err != nil {
		t.Fatal(err)
	}
	result, err := r.Save(path, local, Hash(DefaultContent))
	if err != nil || !result.Conflict || result.ContentHash != Hash(external) {
		t.Fatalf("missing conflict: %+v %v", result, err)
	}
	if data, _ := os.ReadFile(path); string(data) != external {
		t.Fatal("overwrote external content")
	}
	// External editing continues while the user is considering the first notice.
	newer := external + "\n"
	if err := os.WriteFile(path, []byte(newer), 0600); err != nil {
		t.Fatal(err)
	}
	result, err = r.Save(path, local, result.ContentHash)
	if err != nil || !result.Conflict || result.ContentHash != Hash(newer) {
		t.Fatalf("accepted stale confirmation: %+v %v", result, err)
	}
	result, err = r.Save(path, local, result.ContentHash)
	if err != nil || result.Conflict || result.ContentHash != Hash(local) {
		t.Fatalf("confirmed save failed: %+v %v", result, err)
	}
	if data, _ := os.ReadFile(path); string(data) != local {
		t.Fatal("did not save confirmed local content")
	}
}

func TestSaveDoesNotReplacePartiallyWrittenExternalDocument(t *testing.T) {
	r, dir := workspace(t)
	path, err := r.CreateFile(dir, "partial")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"type":`), 0600); err != nil {
		t.Fatal(err)
	}
	result, err := r.Save(path, DefaultContent, Hash(DefaultContent))
	if err != nil || !result.Conflict {
		t.Fatalf("partial file was not protected: %+v %v", result, err)
	}
	if data, _ := os.ReadFile(path); string(data) != `{"type":` {
		t.Fatal("damaged partial external write")
	}
}
