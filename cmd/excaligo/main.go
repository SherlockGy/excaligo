package main

import (
	"log/slog"
	"os"

	"github.com/SherlockGy/excaligo/internal/desktop"
)

func main() {
	logPrefix := "[main 桌面应用入口][app=excaligo]"
	if err := desktop.Run(); err != nil {
		slog.Error(logPrefix, "error", err)
		os.Exit(1)
	}
}
