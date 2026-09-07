package storage

import (
	"fmt"
	"os"
	"path/filepath"
)

// MoveNoReplace resolves both parent directories through the capability before
// using a platform rename that atomically refuses an existing destination.
// It never falls back to copy/delete, so failed moves leave the source intact.
func MoveNoReplace(root *os.Root, source, destination string) error {
	sourceDir, err := root.Open(filepath.Dir(source))
	if err != nil {
		return err
	}
	defer sourceDir.Close()
	targetDir, err := root.Open(filepath.Dir(destination))
	if err != nil {
		return err
	}
	defer targetDir.Close()
	for _, dir := range []*os.File{sourceDir, targetDir} {
		info, err := dir.Stat()
		if err != nil {
			return err
		}
		if !info.IsDir() {
			return fmt.Errorf("move parent is not a directory: %s", dir.Name())
		}
	}
	if err := moveNoReplace(sourceDir, filepath.Base(source), targetDir, filepath.Base(destination)); err != nil {
		return &os.LinkError{Op: "move", Old: source, New: destination, Err: err}
	}
	return nil
}
