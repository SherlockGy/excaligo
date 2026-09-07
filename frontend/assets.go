// Package frontend embeds the production React application.
package frontend

import "embed"

// Assets is populated by npm run build before compiling the desktop binary.
//
//go:embed all:dist
var Assets embed.FS
