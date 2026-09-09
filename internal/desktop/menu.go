package desktop

import (
	"encoding/json"
	"fmt"
	"runtime"

	"github.com/SherlockGy/excaligo/internal/localization"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type MenuCommand struct {
	Command string `json:"command"`
	Data    any    `json:"data,omitempty"`
}

func (s *Service) refreshMenu() {
	s.menuMu.Lock()
	defer s.menuMu.Unlock()
	prefs, err := s.prefs.Load()
	tr := func(key string) string { return localization.Text(prefs.Language, key) }
	signature, _ := json.Marshal([]any{s.menuVisible, prefs.Theme, prefs.Language, prefs.RecentDirectories})
	if s.menu != nil && s.menuSignature == string(signature) {
		return
	}
	previous := s.menu
	menu := s.app.Menu.New()
	s.menu, s.menuSignature = menu, string(signature)
	defer func() {
		if previous != nil {
			application.InvokeAsync(previous.Destroy)
		}
	}()
	if !s.menuVisible {
		s.app.Menu.Set(menu)
		if runtime.GOOS != "darwin" {
			s.window.SetMenu(menu)
		}
		s.window.HideMenuBar()
		return
	}
	if runtime.GOOS == "darwin" {
		menu.AddRole(application.AppMenu)
	}
	add := func(m *application.Menu, label, command, accelerator string) {
		item := m.Add(tr(label)).OnClick(func(*application.Context) { s.app.Event.Emit("menu-command", MenuCommand{Command: command}) })
		if accelerator != "" {
			item.SetAccelerator(accelerator)
		}
	}
	file := menu.AddSubmenu(tr("File"))
	add(file, "Open Directory", "open_directory", "CmdOrCtrl+O")
	add(file, "New File", "new_file", "CmdOrCtrl+N")
	add(file, "New Folder", "new_folder", "CmdOrCtrl+Shift+N")
	file.AddSeparator()
	add(file, "Save", "save", "CmdOrCtrl+S")
	add(file, "Save As...", "save_as", "CmdOrCtrl+Shift+S")
	file.AddSeparator()
	recent := file.AddSubmenu(tr("Recent Directories"))
	if err == nil {
		for i, dir := range prefs.RecentDirectories {
			command := fmt.Sprintf("recent_dir_%d", i)
			recent.Add(shortenPath(dir)).OnClick(func(*application.Context) {
				if _, err := s.files.AllowDirectory(dir); err != nil {
					s.Message(err.Error(), DialogOptions{Title: tr("Open Directory"), Kind: "error"})
					return
				}
				s.app.Event.Emit("menu-command", MenuCommand{Command: command, Data: map[string]string{"directory": dir}})
			})
		}
		if len(prefs.RecentDirectories) > 0 {
			recent.AddSeparator()
			add(recent, "Clear Recent", "clear_recent", "")
		}
	}
	file.AddSeparator()
	add(file, "Quit", "quit", "CmdOrCtrl+Q")
	menu.AddRole(application.EditMenu)
	view := menu.AddSubmenu(tr("View"))
	add(view, "Toggle Sidebar", "toggle_sidebar", "CmdOrCtrl+B")
	view.AddSeparator()
	add(view, "Zoom In", "zoom_in", "CmdOrCtrl+=")
	add(view, "Zoom Out", "zoom_out", "CmdOrCtrl+-")
	add(view, "Reset Zoom", "reset_zoom", "CmdOrCtrl+0")
	view.AddSeparator()
	fullscreen := "F11"
	if runtime.GOOS == "darwin" {
		fullscreen = "Ctrl+Cmd+F"
	}
	add(view, "Toggle Fullscreen", "fullscreen", fullscreen)
	add(view, "Presentation Mode", "presentation", "F5")
	add(view, "Toggle Window Decorations", "toggle_decorations", "CmdOrCtrl+Shift+D")
	theme := view.AddSubmenu(tr("Theme"))
	for _, item := range []struct{ label, value string }{{"Light", "light"}, {"Dark", "dark"}, {"System", "system"}} {
		theme.AddRadio(tr(item.label), prefs.Theme == item.value).OnClick(func(*application.Context) {
			s.app.Event.Emit("menu-command", MenuCommand{Command: "theme", Data: item.value})
		})
	}
	language := view.AddSubmenu(tr("Language"))
	for _, item := range []struct{ label, value string }{{"中文", "zh"}, {"English", "en"}} {
		language.AddRadio(item.label, prefs.Language == item.value).OnClick(func(*application.Context) {
			s.app.Event.Emit("menu-command", MenuCommand{Command: "language", Data: item.value})
		})
	}
	window := menu.AddSubmenu(tr("Window"))
	add(window, "Minimize", "minimize", "CmdOrCtrl+M")
	add(window, "Close Tab", "close_tab", "CmdOrCtrl+W")
	add(window, "Close Window", "close_window", "CmdOrCtrl+Shift+W")
	help := menu.AddSubmenu(tr("Help"))
	add(help, "Keyboard Shortcuts", "keyboard_shortcuts", "")
	help.AddSeparator()
	about := func(*application.Context) {
		s.Message("Excaligo · Go + Wails v3\nExcalidraw\n\n"+
			tr("App icon: adapted from the Go Gopher by Renee French (CC BY 4.0).")+
			"\nhttps://go.dev/blog/gopher\nhttps://creativecommons.org/licenses/by/4.0/", DialogOptions{Title: tr("About Excaligo")})
	}
	help.Add(tr("About Excaligo")).OnClick(about)
	for role, label := range map[application.Role]string{
		application.EditMenu: "Edit", application.Undo: "Undo", application.Redo: "Redo",
		application.Cut: "Cut", application.Copy: "Copy", application.Paste: "Paste",
		application.Delete: "Delete", application.SelectAll: "Select All", application.About: "About Excaligo",
		application.Hide: "Hide Excaligo", application.HideOthers: "Hide Others", application.UnHide: "Show All",
		application.Quit: "Quit", application.ServicesMenu: "Services",
		application.PasteAndMatchStyle: "Paste and Match Style", application.SpeechMenu: "Speech",
		application.StartSpeaking: "Start Speaking", application.StopSpeaking: "Stop Speaking",
	} {
		if item := menu.FindByRole(role); item != nil {
			item.SetLabel(tr(label))
		}
	}
	if item := menu.FindByRole(application.About); item != nil {
		item.OnClick(about)
	}
	s.app.Menu.Set(menu)
	if runtime.GOOS != "darwin" {
		s.window.SetMenu(menu)
		s.window.ShowMenuBar()
	}
}

func shortenPath(path string) string {
	runes := []rune(path)
	if len(runes) <= 50 {
		return path
	}
	return "..." + string(runes[len(runes)-47:])
}
