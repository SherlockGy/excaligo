package localization

import "testing"

func TestCatalogsAndFallback(t *testing.T) {
	if len(messages["en"]) != len(messages["zh"]) {
		t.Fatal("catalog keys differ")
	}
	for key := range messages["en"] {
		if messages["zh"][key] == "" {
			t.Fatalf("missing Chinese translation: %s", key)
		}
	}
	if Text("zh", "Open Directory") != "打开目录" {
		t.Fatal("native menu translation missing")
	}
	if Text("unknown", "Theme") != "Theme" {
		t.Fatal("English fallback missing")
	}
	if Text("en", "unknown key") != "unknown key" {
		t.Fatal("unknown key fallback missing")
	}
}
