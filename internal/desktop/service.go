// Package desktop adapts domain operations to Wails v3 services and native UI.
package desktop

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/SherlockGy/excaligo/internal/drawing"
	"github.com/SherlockGy/excaligo/internal/localization"
	"github.com/SherlockGy/excaligo/internal/preferences"
	"github.com/SherlockGy/excaligo/internal/storage"
	"github.com/SherlockGy/excaligo/internal/watcher"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type Service struct {
	app           *application.App
	window        *application.WebviewWindow
	files         *drawing.Repository
	prefs         *preferences.Store
	watcher       *watcher.Watcher
	logger        *slog.Logger
	allowClose    atomic.Bool
	closePending  atomic.Bool
	menuVisible   bool
	menuMu        sync.Mutex
	menu          *application.Menu
	menuSignature string
	pendingMu     sync.Mutex
	pendingFiles  []string
}

func (s *Service) ServiceStartup(context.Context, application.ServiceOptions) error { return nil }
func (s *Service) ServiceShutdown() error                                           { return errors.Join(s.watcher.Close(), s.files.Close()) }

func (s *Service) SelectDirectory() (*string, error) {
	tr := s.translator()
	path, err := s.app.Dialog.OpenFile().CanChooseFiles(false).CanChooseDirectories(true).
		SetTitle(tr("Open Directory")).SetButtonText(tr("Select Directory")).AttachToWindow(s.window).PromptForSingleSelection()
	if err != nil || path == "" {
		return nil, err
	}
	canonical, err := s.files.AllowDirectory(path)
	if err != nil {
		return nil, err
	}
	return &canonical, nil
}

func (s *Service) ListExcalidrawFiles(directory string) ([]drawing.File, error) {
	return s.files.List(directory)
}
func (s *Service) GetFileTree(directory string) ([]drawing.Node, error) {
	return s.files.Tree(directory)
}
func (s *Service) ReadFile(filePath string) (string, error) {
	result, err := s.files.Read(filePath)
	return result.Content, err
}
func (s *Service) ReadFileWithHash(filePath string) (drawing.Content, error) {
	return s.files.Read(filePath)
}
func (s *Service) HashFileContent(filePath string) (string, error) { return s.files.HashFile(filePath) }
func (s *Service) SaveFile(filePath, content string) (string, error) {
	return s.files.Save(filePath, content)
}
func (s *Service) CreateNewFile(directory, fileName string) (string, error) {
	return s.files.CreateFile(directory, fileName)
}
func (s *Service) CreateNewFolder(directory, folderName string) (string, error) {
	return s.files.CreateFolder(directory, folderName)
}
func (s *Service) RenameFile(oldPath, newName string) (string, error) {
	return s.files.RenameFile(oldPath, newName)
}
func (s *Service) RenameFolder(oldPath, newName string) (string, error) {
	return s.files.RenameFolder(oldPath, newName)
}
func (s *Service) DeleteFile(filePath string) error     { return s.files.DeleteFile(filePath) }
func (s *Service) DeleteFolder(folderPath string) error { return s.files.DeleteFolder(folderPath) }

func (s *Service) SaveFileAs(content string) (*string, error) {
	if err := drawing.Validate(content); err != nil {
		return nil, err
	}
	tr := s.translator()
	path, err := s.app.Dialog.SaveFile().SetFilename(tr("Untitled.excalidraw")).SetMessage(tr("Save As...")).SetButtonText(tr("Save")).
		AddFilter("Excalidraw", "*.excalidraw").AttachToWindow(s.window).PromptForSingleSelection()
	if err != nil || path == "" {
		return nil, err
	}
	if !strings.HasSuffix(path, drawing.Extension) {
		path += drawing.Extension
	}
	canonicalDir, err := s.files.AllowDirectory(filepath.Dir(path))
	if err != nil {
		return nil, err
	}
	path = filepath.Join(canonicalDir, filepath.Base(path))
	if _, err := s.files.SaveAs(path, content); err != nil {
		return nil, err
	}
	return &path, nil
}

func (s *Service) GetPreferences() (preferences.Preferences, error) { return s.prefs.Load() }
func (s *Service) SavePreferences(prefs preferences.Preferences) error {
	if err := s.prefs.Save(prefs); err != nil {
		return err
	}
	s.refreshMenu()
	return nil
}

func (s *Service) WatchDirectory(directory string) error {
	if _, err := s.files.Tree(directory); err != nil {
		return err
	}
	return s.watcher.Watch(directory)
}

func (s *Service) SetMenuVisible(visible bool) {
	s.menuMu.Lock()
	s.menuVisible = visible
	s.menuMu.Unlock()
	s.refreshMenu()
}
func (s *Service) SetDecorations(visible bool) {
	s.window.SetFrameless(!visible)
	if visible {
		s.window.SetTitle("Excaligo")
	}
	s.SetMenuVisible(visible)
}
func (s *Service) ForceCloseApp() { s.allowClose.Store(true); s.app.Quit() }
func (s *Service) CancelClose()   { s.closePending.Store(false) }

func (s *Service) requestClose() {
	if s.closePending.CompareAndSwap(false, true) {
		s.app.Event.Emit("check-unsaved-before-close")
	}
}

type DialogOptions struct {
	Title       string `json:"title"`
	Kind        string `json:"kind"`
	OKLabel     string `json:"okLabel"`
	CancelLabel string `json:"cancelLabel"`
}

func (s *Service) Ask(ctx context.Context, message string, options DialogOptions) (bool, error) {
	tr := s.translator()
	dialog := s.app.Dialog.Question()
	if options.Kind == "warning" {
		dialog = s.app.Dialog.Warning()
	}
	dialog.SetTitle(options.Title).SetMessage(message).AttachToWindow(s.window)
	result := make(chan bool, 1)
	var once sync.Once
	reply := func(value bool) { once.Do(func() { result <- value }) }
	okLabel, cancelLabel := options.OKLabel, options.CancelLabel
	if okLabel == "" {
		okLabel = tr("OK")
	}
	if cancelLabel == "" {
		cancelLabel = tr("Cancel")
	}
	dialog.AddButton(okLabel).SetAsDefault().OnClick(func() { reply(true) })
	dialog.AddButton(cancelLabel).SetAsCancel().OnClick(func() { reply(false) })
	dialog.Show()
	select {
	case value := <-result:
		return value, nil
	case <-ctx.Done():
		return false, ctx.Err()
	}
}

func (s *Service) Message(message string, options DialogOptions) {
	dialog := s.app.Dialog.Info()
	if options.Kind == "error" {
		dialog = s.app.Dialog.Error()
	}
	if options.Kind == "warning" {
		dialog = s.app.Dialog.Warning()
	}
	dialog.SetTitle(options.Title).SetMessage(message).AttachToWindow(s.window)
	dialog.AddButton(s.translator()("OK")).SetAsDefault().SetAsCancel()
	dialog.Show()
}

// ExportFile supports browser-originated Excalidraw, PNG, SVG and library exports.
// Its destination is always selected in a native dialog, never supplied by JS.
func (s *Service) ExportFile(name, encoded string) error {
	logPrefix := fmt.Sprintf("[ExportFile 导出绘图][name=%s]", name)
	name = filepath.Base(name)
	ext := filepath.Ext(name)
	switch ext {
	case ".png", ".svg", ".excalidraw", ".excalidrawlib", ".json":
	default:
		return errors.New("unsupported export type")
	}
	content, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return err
	}
	tr := s.translator()
	path, err := s.app.Dialog.SaveFile().SetFilename(name).SetMessage(tr("Export")).SetButtonText(tr("Save")).AddFilter(tr("Export"), "*"+ext).
		AttachToWindow(s.window).PromptForSingleSelection()
	if err != nil {
		return err
	}
	if path == "" {
		return errors.New("export cancelled")
	}
	if filepath.Ext(path) != ext {
		path += ext
	}
	root, err := os.OpenRoot(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer root.Close()
	if err := storage.WriteAtomic(root, filepath.Base(path), content, 0600); err != nil {
		return err
	}
	s.logger.Info(logPrefix, "path", path)
	return nil
}

func (s *Service) PendingOpenFiles() []string {
	s.pendingMu.Lock()
	defer s.pendingMu.Unlock()
	files := append([]string{}, s.pendingFiles...)
	s.pendingFiles = nil
	return files
}

func (s *Service) queueOpenFile(path string) {
	logPrefix := fmt.Sprintf("[OpenFile 打开系统关联文件][path=%s]", path)
	if filepath.Ext(path) != drawing.Extension {
		return
	}
	dir, err := s.files.AllowDirectory(filepath.Dir(path))
	if err != nil {
		s.logger.Error(logPrefix, "error", err)
		return
	}
	path = filepath.Join(dir, filepath.Base(path))
	s.pendingMu.Lock()
	s.pendingFiles = append(s.pendingFiles, path)
	s.pendingMu.Unlock()
	s.app.Event.Emit("open-files")
}

func (s *Service) translator() func(string) string {
	prefs, _ := s.prefs.Load()
	return func(key string) string { return localization.Text(prefs.Language, key) }
}
