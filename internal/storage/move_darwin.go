package storage

import (
	"os"

	"golang.org/x/sys/unix"
)

func moveNoReplace(sourceDir *os.File, source string, targetDir *os.File, destination string) error {
	return unix.RenameatxNp(int(sourceDir.Fd()), source, int(targetDir.Fd()), destination, unix.RENAME_EXCL)
}
