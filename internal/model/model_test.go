package model

import (
	"encoding/json"
	"testing"
)

func TestShareCompatibility(t *testing.T) {
	s := NewScenario()
	s.IssueKey = "PINO-24"
	s.Steps[0].Headers = map[string]string{"Authorization": "Bearer {{token}}"}
	b, e := Export(s)
	if e != nil {
		t.Fatal(e)
	}
	copy, e := Import(b)
	if e != nil {
		t.Fatal(e)
	}
	if copy.ID == s.ID || copy.Steps[0].ID == s.Steps[0].ID || copy.IssueKey != s.IssueKey {
		t.Fatal("import must re-identify while keeping context")
	}
	var raw map[string]any
	_ = json.Unmarshal(b, &raw)
	raw["variables"] = map[string]any{"token": "secret"}
	bad, _ := json.Marshal(raw)
	if _, e = Import(bad); e == nil {
		t.Fatal("foreign private fields must not import")
	}
	if _, e = Import(append(b, []byte(" {}")...)); e == nil {
		t.Fatal("trailing JSON accepted")
	}
}
func TestValidation(t *testing.T) {
	for _, endpoint := range []string{"http://company.test/mcp", "https://user:pass@company.test/mcp", "file:///tmp/a"} {
		if ValidURL(endpoint, true) == nil {
			t.Fatal(endpoint)
		}
	}
	for _, endpoint := range []string{"https://company.test/mcp", "http://127.0.0.1:3000/mcp"} {
		if e := ValidURL(endpoint, true); e != nil {
			t.Fatal(e)
		}
	}
	s := NewScenario()
	s.Steps = append(s.Steps, s.Steps[0])
	if s.Validate() == nil {
		t.Fatal("duplicate IDs accepted")
	}
}
func TestPaths(t *testing.T) {
	v := map[string]any{"data": []any{map[string]any{"id": float64(7)}}}
	got, e := Path(v, "data.0.id")
	if e != nil || got != float64(7) {
		t.Fatal(got, e)
	}
	if _, e = Path(v, "data.2.id"); e == nil {
		t.Fatal("missing path accepted")
	}
}
