// Package preferences persists application preferences independently of the UI.
package preferences

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sync"

	"github.com/SherlockGy/excaligo/internal/storage"
)

type Preferences struct {
	LastDirectory     *string  `json:"last_directory"`
	RecentDirectories []string `json:"recent_directories"`
	Theme             string   `json:"theme"`
	Language          string   `json:"language"`
	SidebarVisible    bool     `json:"sidebar_visible"`
	ShowDecorations   bool     `json:"show_decorations"`
}

func Default() Preferences {
	return Preferences{RecentDirectories: []string{}, Theme: "system", Language: "en", SidebarVisible: true, ShowDecorations: true}
}

type Store struct {
	mu     sync.Mutex
	path   string
	logger *slog.Logger
}

func New(path string, logger *slog.Logger) *Store {
	if logger == nil {
		logger = slog.Default()
	}
	return &Store{path: path, logger: logger}
}

func (s *Store) Load() (Preferences, error) {
	logPrefix := fmt.Sprintf("[LoadPreferences 加载偏好设置][path=%s]", s.path)
	s.mu.Lock()
	defer s.mu.Unlock()
	prefs := Default()
	data, err := os.ReadFile(s.path)
	if errors.Is(err, fs.ErrNotExist) {
		return prefs, nil
	}
	if err != nil {
		return prefs, err
	}
	// Keep the source application's envelope and snake_case schema.
	envelope := struct {
		Preferences json.RawMessage `json:"preferences"`
	}{}
	if err := json.Unmarshal(data, &envelope); err != nil {
		s.logger.Warn(logPrefix, "error", err)
		return prefs, fmt.Errorf("read preferences: %w", err)
	}
	if len(envelope.Preferences) != 0 {
		data = envelope.Preferences
	}
	if err := json.Unmarshal(data, &prefs); err != nil {
		return Default(), fmt.Errorf("decode preferences: %w", err)
	}
	if err := validate(&prefs); err != nil {
		return Default(), err
	}
	return prefs, nil
}

func validate(p *Preferences) error {
	if p.Language == "" {
		p.Language = "en"
	} // Backward-compatible preferences.
	if p.Language != "en" && p.Language != "zh" {
		return errors.New("invalid language")
	}
	if p.Theme != "system" && p.Theme != "light" && p.Theme != "dark" {
		return errors.New("invalid theme")
	}
	recent := make([]string, 0, 10)
	seen := make(map[string]bool)
	for _, dir := range p.RecentDirectories {
		if dir != "" && !seen[dir] {
			recent = append(recent, dir)
			seen[dir] = true
		}
		if len(recent) == 10 {
			break
		}
	}
	p.RecentDirectories = recent
	return nil
}

func (s *Store) Save(prefs Preferences) error {
	logPrefix := fmt.Sprintf("[SavePreferences 保存偏好设置][path=%s]", s.path)
	if err := validate(&prefs); err != nil {
		return err
	}
	data, err := json.MarshalIndent(struct {
		Preferences Preferences `json:"preferences"`
	}{prefs}, "", "  ")
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return err
	}
	defer root.Close()
	if err := storage.WriteAtomic(root, filepath.Base(s.path), data, 0600); err != nil {
		s.logger.Error(logPrefix, "error", err)
		return err
	}
	s.logger.Debug(logPrefix)
	return nil
}
