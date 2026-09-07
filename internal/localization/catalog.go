// Package localization shares app-shell messages with the React frontend.
package localization

import (
	"embed"
	"encoding/json"
)

//go:embed locales/*.json
var catalogs embed.FS

var messages = loadCatalogs()

func loadCatalogs() map[string]map[string]string {
	result := make(map[string]map[string]string)
	for _, language := range []string{"en", "zh"} {
		data, err := catalogs.ReadFile("locales/" + language + ".json")
		if err != nil {
			panic(err)
		}
		var catalog map[string]string
		if err := json.Unmarshal(data, &catalog); err != nil {
			panic(err)
		}
		result[language] = catalog
	}
	return result
}

// Text falls back to English for old preferences and unknown language values.
func Text(language, key string) string {
	if value := messages[language][key]; value != "" {
		return value
	}
	if value := messages["en"][key]; value != "" {
		return value
	}
	return key
}
