package desktop

import (
	"fmt"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type MenuCommand struct {
	Command string `json:"command"`
	Data    any    `json:"data,omitempty"`
}

func (s *Service) refreshMenu() {
	s.menuMu.Lock()
	defer s.menuMu.Unlock()
	menu := s.app.Menu.New()
	if !s.menuVisible {
		s.app.Menu.Set(menu)
		s.window.HideMenuBar()
		return
	}
	if runtime.GOOS == "darwin" {
		menu.AddRole(application.AppMenu)
	}
	add := func(m *application.Menu, label, command, accelerator string) {
		item := m.Add(label).OnClick(func(*application.Context) { s.app.Event.Emit("menu-command", MenuCommand{Command: command}) })
		if accelerator != "" {
			item.SetAccelerator(accelerator)
		}
	}
	file := menu.AddSubmenu("File")
	add(file, "Open Directory", "open_directory", "CmdOrCtrl+O")
	add(file, "New File", "new_file", "CmdOrCtrl+N")
	add(file, "New Folder", "new_folder", "CmdOrCtrl+Shift+N")
	file.AddSeparator()
	add(file, "Save", "save", "CmdOrCtrl+S")
	add(file, "Save As...", "save_as", "CmdOrCtrl+Shift+S")
	file.AddSeparator()
	recent := file.AddSubmenu("Recent Directories")
	prefs, err := s.prefs.Load()
	if err == nil {
		for i, dir := range prefs.RecentDirectories {
			command := fmt.Sprintf("recent_dir_%d", i)
			recent.Add(shortenPath(dir)).OnClick(func(*application.Context) {
				if _, err := s.files.AllowDirectory(dir); err != nil {
					s.Message(err.Error(), DialogOptions{Title: "Open Directory", Kind: "error"})
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
	view := menu.AddSubmenu("View")
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
	theme := view.AddSubmenu("Theme")
	for _, item := range []struct{ label, value string }{{"Light", "light"}, {"Dark", "dark"}, {"System", "system"}} {
		theme.AddRadio(item.label, prefs.Theme == item.value).OnClick(func(*application.Context) {
			s.app.Event.Emit("menu-command", MenuCommand{Command: "theme", Data: item.value})
		})
	}
	window := menu.AddSubmenu("Window")
	add(window, "Minimize", "minimize", "CmdOrCtrl+M")
	add(window, "Close Tab", "close_tab", "CmdOrCtrl+W")
	add(window, "Close Window", "close_window", "CmdOrCtrl+Shift+W")
	help := menu.AddSubmenu("Help")
	add(help, "Keyboard Shortcuts", "keyboard_shortcuts", "")
	help.AddSeparator()
	help.Add("About Excaligo").OnClick(func(*application.Context) { s.app.Menu.ShowAbout() })
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
