package drawing

import (
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"

	"github.com/SherlockGy/excaligo/internal/storage"
)

func (r *Repository) MoveFile(path, directory string) (string, error) {
	logPrefix := fmt.Sprintf("[MoveFile 移动绘图文件][filePath=%s][directory=%s]", path, directory)
	r.mu.Lock()
	defer r.mu.Unlock()
	root, source, err := r.locate(path)
	if err != nil {
		return "", err
	}
	if err := checkTarget(root, source, false); err != nil {
		return "", err
	}
	targetRoot, target, err := r.locate(directory)
	if err != nil {
		return "", err
	}
	if targetRoot != root {
		return "", errors.New("destination must be inside the same opened workspace")
	}
	info, err := root.Lstat(target)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&fs.ModeSymlink != 0 {
		return "", errors.New("destination must be a regular directory, not a symbolic link")
	}
	destination := filepath.Join(target, filepath.Base(source))
	if source == destination {
		return filepath.Join(root.Name(), source), nil
	}
	if _, err := root.Lstat(destination); err == nil {
		return "", errors.New("a file or folder with that name already exists")
	} else if !errors.Is(err, fs.ErrNotExist) {
		return "", err
	}
	if err := storage.MoveNoReplace(root, source, destination); err != nil {
		r.logger.Error(logPrefix, "error", err)
		return "", err
	}
	r.logger.Info(logPrefix)
	return filepath.Join(root.Name(), destination), nil
}
