// Package drawing owns Excalidraw document validation and filesystem operations.
// It does not depend on a desktop runtime.
package drawing

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"lukechampine.com/blake3"
)

const Extension = ".excalidraw"

type File struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Modified bool   `json:"modified"`
}

type Node struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	IsDirectory bool   `json:"is_directory"`
	Modified    bool   `json:"modified"`
	Children    []Node `json:"children"`
}

type Content struct {
	Content     string `json:"content"`
	ContentHash string `json:"content_hash"`
}

type SaveResult struct {
	ContentHash string `json:"content_hash"`
	Conflict    bool   `json:"conflict"`
}

func Hash(content string) string {
	sum := blake3.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

// Validate checks the same required fields as the source application, retaining
// arbitrary element, appState and binary-file fields for lossless round trips.
func Validate(content string) error {
	if !utf8.ValidString(content) {
		return errors.New("content is not valid UTF-8")
	}
	var value map[string]json.RawMessage
	if err := json.Unmarshal([]byte(content), &value); err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}
	if value == nil {
		return errors.New("content is not a JSON object")
	}
	var kind string
	if json.Unmarshal(value["type"], &kind) != nil || kind != "excalidraw" {
		return errors.New("type must be 'excalidraw'")
	}
	var version any
	if err := json.Unmarshal(value["version"], &version); err != nil {
		return errors.New("version must be a number")
	}
	if _, ok := version.(float64); !ok {
		return errors.New("version must be a number")
	}
	var elements []json.RawMessage
	if json.Unmarshal(value["elements"], &elements) != nil || elements == nil {
		return errors.New("elements must be an array")
	}
	return nil
}

func SafeName(name string) (string, error) {
	name = strings.NewReplacer("/", "_", "\\", "_", "..", "_").Replace(strings.TrimSpace(name))
	if name == "" || name == "." || strings.ContainsRune(name, 0) {
		return "", errors.New("invalid filename")
	}
	return name, nil
}

func validateExtension(name string) error {
	if filepath.Ext(name) != Extension {
		return errors.New("file must have the .excalidraw extension")
	}
	return nil
}

const DefaultContent = `{
  "type": "excalidraw",
  "version": 2,
  "source": "ExcaliApp",
  "elements": [],
  "appState": { "gridSize": null, "viewBackgroundColor": "#ffffff" },
  "files": {}
}`
