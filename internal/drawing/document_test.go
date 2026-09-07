package drawing

import "testing"

func TestValidate(t *testing.T) {
	tests := []struct {
		name, content string
		valid         bool
	}{
		{"default", DefaultContent, true},
		{"preserve fields", `{"type":"excalidraw","version":2.5,"elements":[{"id":"a","custom":true}],"files":{"a":{"dataURL":"data:image/png;base64,AA=="}},"unknown":true}`, true},
		{"missing type", `{"version":2,"elements":[]}`, false},
		{"wrong type", `{"type":"other","version":2,"elements":[]}`, false},
		{"string version", `{"type":"excalidraw","version":"2","elements":[]}`, false},
		{"null version", `{"type":"excalidraw","version":null,"elements":[]}`, false},
		{"null elements", `{"type":"excalidraw","version":2,"elements":null}`, false},
		{"object elements", `{"type":"excalidraw","version":2,"elements":{}}`, false},
		{"array root", `[]`, false}, {"null root", `null`, false}, {"trailing data", DefaultContent + "{}", false},
		{"invalid utf8", string([]byte{0xff}), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := Validate(tt.content); (err == nil) != tt.valid {
				t.Fatalf("Validate() = %v; valid=%v", err, tt.valid)
			}
		})
	}
}

func TestHashMatchesBLAKE3Vector(t *testing.T) {
	if got := Hash(""); got != "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262" {
		t.Fatalf("BLAKE3 mismatch: %s", got)
	}
}

func TestSafeName(t *testing.T) {
	for _, tt := range []struct{ in, want string }{{" ../x\\y ", "__x_y"}, {"架构图", "架构图"}, {"a..b", "a_b"}} {
		got, err := SafeName(tt.in)
		if err != nil || got != tt.want {
			t.Fatalf("SafeName(%q)=%q,%v", tt.in, got, err)
		}
	}
	for _, name := range []string{"", " ", ".", "a\x00b"} {
		if _, err := SafeName(name); err == nil {
			t.Fatalf("accepted %q", name)
		}
	}
}
