//go:build !darwin && !windows && !linux

package storage

import (
	"errors"
	"os"
)

func moveNoReplace(*os.File, string, *os.File, string) error {
	return errors.New("safe file moves are not supported on this platform")
}
