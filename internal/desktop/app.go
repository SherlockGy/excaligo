package desktop

import (
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"

	"github.com/SherlockGy/excaligo/frontend"
	"github.com/SherlockGy/excaligo/internal/drawing"
	"github.com/SherlockGy/excaligo/internal/preferences"
	"github.com/SherlockGy/excaligo/internal/watcher"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Run is the composition root; dependencies are constructed here, not globally.
func Run() error {
	logPrefix := "[Run 启动桌面应用][app=excaligo]"
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	configDir, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	if override := os.Getenv("EXCALIGO_CONFIG_DIR"); override != "" {
		configDir = override
	}
	prefs := preferences.New(filepath.Join(configDir, "excaligo", "preferences.json"), logger)
	initial, err := prefs.Load()
	if err != nil {
		logger.Warn(logPrefix, "error", err)
	}
	repo := drawing.NewRepository(logger)
	for _, dir := range initial.RecentDirectories {
		if _, err := repo.AllowDirectory(dir); err != nil {
			logger.Debug(logPrefix, "directory", dir, "error", err)
		}
	}
	if initial.LastDirectory != nil {
		_, _ = repo.AllowDirectory(*initial.LastDirectory)
	}
	s := &Service{files: repo, prefs: prefs, logger: logger, menuVisible: initial.ShowDecorations}
	assets, err := fs.Sub(frontend.Assets, "dist")
	if err != nil {
		return err
	}
	app := application.New(application.Options{
		Name: "Excaligo", Description: "A local-first Excalidraw desktop editor built with Go and Wails v3",
		Services: []application.Service{application.NewService(s)}, Logger: logger,
		Assets:           application.AssetOptions{Handler: application.BundledAssetFileServer(assets), Middleware: assetHeaders},
		Mac:              application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
		FileAssociations: []string{drawing.Extension},
		ShouldQuit: func() bool {
			if s.allowClose.Load() {
				return true
			}
			s.requestClose()
			return false
		},
	})
	s.app = app
	s.watcher = watcher.New(func(path string) { app.Event.Emit("file-system-change", path) }, logger)
	s.window = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name: "main", Title: "Excaligo", Width: 1600, Height: 900, MinWidth: 1200, MinHeight: 700,
		URL: "/", Frameless: !initial.ShowDecorations,
		BackgroundColour: application.NewRGB(247, 249, 252),
	})
	s.window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if !s.allowClose.Load() {
			event.Cancel()
			s.requestClose()
		}
	})
	app.Event.OnApplicationEvent(events.Common.ApplicationOpenedWithFile, func(event *application.ApplicationEvent) { s.queueOpenFile(event.Context().Filename()) })
	for _, arg := range os.Args[1:] {
		s.queueOpenFile(arg)
	}
	s.refreshMenu()
	logger.Info(logPrefix)
	return app.Run()
}

func assetHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		// The Wails runtime injects initialization scripts. Vite's development
		// websocket is loopback-only; production assets and fonts are embedded.
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:9245; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}
