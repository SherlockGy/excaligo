// Package watcher owns a single recursive filesystem subscription per app.
package watcher

import (
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

type session struct {
	watcher *fsnotify.Watcher
	done    chan struct{}
	stopped chan struct{}
}

type Watcher struct {
	mu      sync.Mutex
	current *session
	emit    func(string)
	logger  *slog.Logger
}

func New(emit func(string), logger *slog.Logger) *Watcher {
	if logger == nil {
		logger = slog.Default()
	}
	return &Watcher{emit: emit, logger: logger}
}

func addDirectories(w *fsnotify.Watcher, directory string) error {
	return filepath.WalkDir(directory, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path != directory && strings.HasPrefix(entry.Name(), ".") && entry.IsDir() {
			return filepath.SkipDir
		}
		if entry.IsDir() {
			return w.Add(path)
		}
		return nil
	})
}

func (w *Watcher) Watch(directory string) error {
	logPrefix := fmt.Sprintf("[Watch 监听目录变更][directory=%s]", directory)
	w.mu.Lock()
	defer w.mu.Unlock()
	backend, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	if err := addDirectories(backend, directory); err != nil {
		_ = backend.Close()
		return err
	}
	w.stop()
	s := &session{watcher: backend, done: make(chan struct{}), stopped: make(chan struct{})}
	w.current = s
	go w.run(s, logPrefix)
	w.logger.Info(logPrefix)
	return nil
}

func (w *Watcher) stop() {
	if w.current != nil {
		close(w.current.done)
		_ = w.current.watcher.Close()
		<-w.current.stopped
		w.current = nil
	}
}

func (w *Watcher) Close() error { w.mu.Lock(); defer w.mu.Unlock(); w.stop(); return nil }

func (w *Watcher) run(s *session, logPrefix string) {
	defer close(s.stopped)
	timer := time.NewTimer(time.Hour)
	if !timer.Stop() {
		<-timer.C
	}
	defer timer.Stop()
	pending := make(map[string]bool)
	for {
		select {
		case <-s.done:
			return
		case event, ok := <-s.watcher.Events:
			if !ok {
				return
			}
			if event.Op&(fsnotify.Create|fsnotify.Write|fsnotify.Remove|fsnotify.Rename) == 0 {
				continue
			}
			if strings.HasPrefix(filepath.Base(event.Name), ".") {
				continue
			}
			// Register newly created directory trees before dispatching their event.
			if event.Has(fsnotify.Create) {
				if err := addDirectories(s.watcher, event.Name); err != nil && !errors.Is(err, fs.ErrNotExist) {
					w.logger.Warn(logPrefix, "path", event.Name, "error", err)
				}
			}
			pending[event.Name] = true
			timer.Reset(100 * time.Millisecond)
		case err, ok := <-s.watcher.Errors:
			if !ok {
				return
			}
			w.logger.Error(logPrefix, "error", err)
		case <-timer.C:
			for path := range pending {
				select {
				case <-s.done:
					return
				default:
				}
				if w.emit != nil {
					w.emit(path)
				}
			}
			clear(pending)
		}
	}
}
