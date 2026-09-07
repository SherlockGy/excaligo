package storage

import (
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Layout follows FILE_RENAME_INFORMATION; zero ReplaceIfExists refuses
// collisions at the filesystem operation itself, including concurrent creates.
type fileRenameInformation struct {
	ReplaceIfExists uint32
	RootDirectory   windows.Handle
	FileNameLength  uint32
	FileName        [1]uint16
}

func moveNoReplace(sourceDir *os.File, source string, targetDir *os.File, destination string) error {
	name, err := windows.NewNTUnicodeString(source)
	if err != nil {
		return err
	}
	attributes := windows.OBJECT_ATTRIBUTES{
		RootDirectory: windows.Handle(sourceDir.Fd()),
		ObjectName:    name,
		Attributes:    windows.OBJ_CASE_INSENSITIVE | windows.OBJ_DONT_REPARSE,
	}
	attributes.Length = uint32(unsafe.Sizeof(attributes))
	var status windows.IO_STATUS_BLOCK
	var handle windows.Handle
	err = windows.NtCreateFile(&handle, windows.DELETE|windows.SYNCHRONIZE, &attributes, &status,
		nil, 0, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, windows.FILE_OPEN,
		windows.FILE_SYNCHRONOUS_IO_NONALERT, 0, 0)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(handle)
	encoded, err := windows.UTF16FromString(destination)
	if err != nil {
		return err
	}
	byteLength := (len(encoded) - 1) * 2
	var layout fileRenameInformation
	// Include the entire header even for a one-character directory name.
	buffer := make([]byte, max(int(unsafe.Sizeof(layout)), int(unsafe.Offsetof(layout.FileName))+byteLength))
	info := (*fileRenameInformation)(unsafe.Pointer(&buffer[0]))
	info.RootDirectory = windows.Handle(targetDir.Fd())
	info.FileNameLength = uint32(byteLength)
	copy(unsafe.Slice(&info.FileName[0], len(encoded)-1), encoded[:len(encoded)-1])
	return windows.NtSetInformationFile(handle, &status, &buffer[0], uint32(len(buffer)), windows.FileRenameInformation)
}
