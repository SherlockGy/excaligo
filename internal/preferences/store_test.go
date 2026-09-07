package preferences

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultsPersistenceAndLegacySchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config", "preferences.json")
	store := New(path, nil)
	got, err := store.Load()
	if err != nil || got.Theme != "system" || !got.ShowDecorations || !got.SidebarVisible || got.RecentDirectories == nil {
		t.Fatalf("%+v %v", got, err)
	}
	dir := "/workspace"
	prefs := Preferences{LastDirectory: &dir, RecentDirectories: []string{dir, dir}, Theme: "dark", ShowDecorations: false, SidebarVisible: false}
	if err := store.Save(prefs); err != nil {
		t.Fatal(err)
	}
	got, err = New(path, nil).Load()
	if err != nil || got.ShowDecorations || got.SidebarVisible || got.Theme != "dark" || len(got.RecentDirectories) != 1 {
		t.Fatalf("%+v %v", got, err)
	}
	legacy := `{"preferences":{"last_directory":null,"recent_directories":null,"theme":"system","sidebar_visible":false}}`
	if err := os.WriteFile(path, []byte(legacy), 0600); err != nil {
		t.Fatal(err)
	}
	got, err = store.Load()
	if err != nil || !got.ShowDecorations || got.SidebarVisible || got.RecentDirectories == nil {
		t.Fatalf("legacy=%+v %v", got, err)
	}
}

func TestInvalidPreferencesDoNotOverwrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "preferences.json")
	store := New(path, nil)
	if err := store.Save(Default()); err != nil {
		t.Fatal(err)
	}
	prefs := Default()
	prefs.Theme = "invalid"
	if err := store.Save(prefs); err == nil {
		t.Fatal("accepted invalid theme")
	}
	got, err := store.Load()
	if err != nil || got.Theme != "system" {
		t.Fatal("damaged preferences", err)
	}
	if err := os.WriteFile(path, []byte("broken JSON"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Load(); err == nil {
		t.Fatal("silently accepted corrupt preferences")
	}
}

func TestLanguageAndThemePersistence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "preferences.json")
	s := New(path, nil)
	for _, language := range []string{"zh", "en"} {
		for _, theme := range []string{"light", "dark", "system"} {
			p := Default()
			p.Language, p.Theme = language, theme
			if err := s.Save(p); err != nil {
				t.Fatal(err)
			}
			got, err := New(path, nil).Load()
			if err != nil || got.Language != language || got.Theme != theme {
				t.Fatalf("%+v %v", got, err)
			}
		}
	}
	invalid := Default()
	invalid.Language = "fr"
	if err := s.Save(invalid); err == nil {
		t.Fatal("accepted unsupported language")
	}
	got, _ := s.Load()
	if got.Language != "en" {
		t.Fatal("invalid write damaged preferences")
	}
	if err := os.WriteFile(path, []byte(`{"preferences":{"theme":"dark"}}`), 0600); err != nil {
		t.Fatal(err)
	}
	got, err := s.Load()
	if err != nil || got.Language != "en" || got.Theme != "dark" {
		t.Fatalf("legacy: %+v %v", got, err)
	}
}
