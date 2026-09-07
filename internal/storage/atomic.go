// Package storage provides durable replacement of files relative to an os.Root.
package storage

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// WriteAtomic leaves the previous file intact unless the complete replacement
// has been written, synced and closed. The temporary file is in the same folder.
func WriteAtomic(root *os.Root, name string, content []byte, mode fs.FileMode) (err error) {
	var id [12]byte
	if _, err = rand.Read(id[:]); err != nil {
		return err
	}
	tmp := filepath.Join(filepath.Dir(name), ".excaligo-"+hex.EncodeToString(id[:])+".tmp")
	f, err := root.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return fmt.Errorf("create temporary file: %w", err)
	}
	defer func() { _ = f.Close(); _ = root.Remove(tmp) }()
	if _, err = f.Write(content); err != nil {
		return fmt.Errorf("write file: %w", err)
	}
	if err = f.Sync(); err != nil {
		return fmt.Errorf("sync file: %w", err)
	}
	if err = f.Close(); err != nil {
		return fmt.Errorf("close file: %w", err)
	}
	if err = root.Rename(tmp, name); err != nil {
		return fmt.Errorf("replace file: %w", err)
	}
	return nil
}
