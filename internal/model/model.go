package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"io"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

var Services = []string{"jira", "confluence", "github", "notion", "google", "claude", "codex"}

type Profile struct {
	ID         string            `json:"id"`
	Transport  string            `json:"transport"`
	Endpoint   string            `json:"endpoint"`
	Command    string            `json:"command"`
	Args       []string          `json:"args"`
	Tool       string            `json:"tool"`
	Arguments  map[string]any    `json:"arguments"`
	ResultPath string            `json:"resultPath"`
	BaseURL    string            `json:"baseUrl"`
	Secrets    map[string]string `json:"secrets,omitempty"`
}

func ValidURL(raw string, localHTTPOnly bool) error {
	u, e := url.Parse(raw)
	if e != nil || u.Host == "" || u.User != nil || u.Fragment != "" {
		return errors.New("valid HTTP(S) URL without user credentials required")
	}
	if u.Scheme == "https" {
		return nil
	}
	if u.Scheme == "http" && (!localHTTPOnly || u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1") {
		return nil
	}
	return errors.New("HTTPS required; HTTP is allowed for localhost only")
}
func (p Profile) Validate() error {
	found := false
	for _, s := range Services {
		if p.ID == s {
			found = true
		}
	}
	if !found {
		return errors.New("unknown service")
	}
	ai := p.ID == "claude" || p.ID == "codex"
	if ai != (p.Transport == "cli") {
		return errors.New("AI profiles use CLI; service profiles use MCP")
	}
	switch p.Transport {
	case "http":
		if e := ValidURL(p.Endpoint, true); e != nil {
			return e
		}
	case "stdio", "cli":
		if strings.TrimSpace(p.Command) == "" {
			return errors.New("executable is required")
		}
	default:
		return errors.New("unsupported transport")
	}
	if p.BaseURL != "" {
		return ValidURL(p.BaseURL, true)
	}
	return nil
}

type Check struct {
	Path   string `json:"path"`
	Equals any    `json:"equals"`
}
type Step struct {
	ID             string            `json:"id"`
	Name           string            `json:"name"`
	Method         string            `json:"method"`
	URL            string            `json:"url"`
	Headers        map[string]string `json:"headers"`
	Body           string            `json:"body"`
	ExpectedStatus int               `json:"expectedStatus"`
	Captures       map[string]string `json:"captures"`
	Checks         []Check           `json:"checks"`
}
type Scenario struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	IssueKey string `json:"issueKey"`
	Steps    []Step `json:"steps"`
}
type SavedScenario struct {
	Scenario  Scenario          `json:"scenario"`
	Variables map[string]string `json:"variables"`
}

var varName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,99}$`)

func ValidateVariables(v map[string]string) error {
	if len(v) > 200 {
		return errors.New("maximum 200 variables")
	}
	for k, s := range v {
		if !varName.MatchString(k) || len(s) > 50000 {
			return errors.New("invalid variable name or oversized value")
		}
	}
	return nil
}
func (s Scenario) Validate() error {
	if _, e := uuid.Parse(s.ID); e != nil {
		return errors.New("invalid scenario ID")
	}
	if strings.TrimSpace(s.Name) == "" || len(s.Name) > 200 {
		return errors.New("scenario name required (max 200 bytes)")
	}
	if len(s.Steps) == 0 || len(s.Steps) > 30 {
		return errors.New("use 1–30 requests")
	}
	ids := map[string]bool{}
	for _, r := range s.Steps {
		if _, e := uuid.Parse(r.ID); e != nil || ids[r.ID] {
			return errors.New("invalid or duplicate request ID")
		}
		ids[r.ID] = true
		if strings.TrimSpace(r.Name) == "" || r.URL == "" || len(r.URL) > 8000 || len(r.Body) > 100000 {
			return errors.New("request name/URL required; body limit 100 KB")
		}
		switch r.Method {
		case "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD":
		default:
			return errors.New("unsupported HTTP method")
		}
		if r.ExpectedStatus < 100 || r.ExpectedStatus > 599 || len(r.Checks) > 30 {
			return errors.New("invalid assertion")
		}
		if e := ValidateVariables(r.Captures); e != nil {
			return e
		}
	}
	return nil
}
func NewStep() Step {
	return Step{ID: uuid.NewString(), Name: "Health check", Method: "GET", URL: "{{baseUrl}}/health", Headers: map[string]string{}, ExpectedStatus: 200, Captures: map[string]string{}, Checks: []Check{}}
}
func NewScenario() Scenario {
	return Scenario{ID: uuid.NewString(), Name: "New scenario", Steps: []Step{NewStep()}}
}

type Shared struct {
	Format   string   `json:"format"`
	Version  int      `json:"version"`
	Scenario Scenario `json:"scenario"`
}

func Export(s Scenario) ([]byte, error) {
	if e := s.Validate(); e != nil {
		return nil, e
	}
	return json.MarshalIndent(Shared{"pino-api-scenario", 1, s}, "", "  ")
}
func Import(b []byte) (Scenario, error) {
	var f Shared
	if len(b) > 2<<20 {
		return Scenario{}, errors.New("file exceeds 2 MB")
	}
	d := json.NewDecoder(strings.NewReader(string(b)))
	d.DisallowUnknownFields()
	if e := d.Decode(&f); e != nil {
		return Scenario{}, errors.New("invalid scenario file")
	}
	var trailing any
	if d.Decode(&trailing) != io.EOF {
		return Scenario{}, errors.New("trailing JSON data")
	}
	if f.Format != "pino-api-scenario" || f.Version != 1 {
		return Scenario{}, errors.New("Pino API scenario v1 required")
	}
	if e := f.Scenario.Validate(); e != nil {
		return Scenario{}, e
	}
	f.Scenario.ID = uuid.NewString()
	for i := range f.Scenario.Steps {
		f.Scenario.Steps[i].ID = uuid.NewString()
	}
	return f.Scenario, nil
}
func Path(v any, path string) (any, error) {
	if path == "" {
		return v, nil
	}
	for _, k := range strings.Split(path, ".") {
		switch x := v.(type) {
		case map[string]any:
			var ok bool
			v, ok = x[k]
			if !ok {
				return nil, fmt.Errorf("response path %s not found", path)
			}
		case []any:
			i, e := strconv.Atoi(k)
			if e != nil || i < 0 || i >= len(x) {
				return nil, errors.New("array path out of range")
			}
			v = x[i]
		default:
			return nil, fmt.Errorf("response path %s not found", path)
		}
	}
	return v, nil
}

type Issue struct{ Key, Title, Status, Priority, Assignee, Description, URL string }
type Page struct{ ID, Title, Text, URL string }
