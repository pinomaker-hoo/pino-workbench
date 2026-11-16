package runner

import (
	"context"
	"encoding/json"
	"github.com/pinomaker-hoo/pino-workbench/internal/model"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestSequentialRequests(t *testing.T) {
	var count atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count.Add(1)
		if r.URL.Path == "/login" {
			_, _ = w.Write([]byte(`{"token":"captured-secret","data":{"id":42}}`))
			return
		}
		if r.URL.Path != "/users/42" || r.Header.Get("Authorization") != "Bearer captured-secret" {
			t.Error("capture not passed to next request")
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	s := model.NewScenario()
	a := &s.Steps[0]
	a.Method = "POST"
	a.URL = "{{baseUrl}}/login"
	a.Captures = map[string]string{"token": "token", "id": "data.id"}
	b := model.NewStep()
	b.URL = "{{baseUrl}}/users/{{id}}"
	b.Headers = map[string]string{"Authorization": "Bearer {{token}}"}
	b.Checks = []model.Check{{Path: "ok", Equals: true}}
	s.Steps = append(s.Steps, b)
	r := Run(context.Background(), s, map[string]string{"baseUrl": server.URL}, nil)
	if !r.Passed || count.Load() != 2 {
		t.Fatal(r)
	}
	raw, _ := json.Marshal(r)
	if strings.Contains(string(raw), "captured-secret") {
		t.Fatal("capture exposed")
	}
}
func TestFailureRedirectAndLimits(t *testing.T) {
	var count atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count.Add(1)
		switch r.URL.Path {
		case "/redirect":
			w.Header().Set("Location", "/unexpected")
			w.WriteHeader(302)
		case "/large":
			_, _ = w.Write([]byte(strings.Repeat("x", (1<<20)+1)))
		default:
			w.WriteHeader(500)
		}
	}))
	defer server.Close()
	s := model.NewScenario()
	s.Steps = append(s.Steps, model.NewStep())
	r := Run(context.Background(), s, map[string]string{}, nil)
	if count.Load() != 0 || r.Passed {
		t.Fatal("unresolved variable sent")
	}
	s.Steps[0].URL = server.URL + "/fail"
	r = Run(context.Background(), s, nil, nil)
	if count.Load() != 1 || len(r.Steps) != 1 {
		t.Fatal("did not stop on failure")
	}
	s.Steps = s.Steps[:1]
	s.Steps[0].URL = server.URL + "/redirect"
	s.Steps[0].ExpectedStatus = 302
	r = Run(context.Background(), s, nil, nil)
	if !r.Passed || count.Load() != 2 {
		t.Fatal("redirect followed")
	}
	s.Steps[0].URL = server.URL + "/large"
	s.Steps[0].ExpectedStatus = 200
	r = Run(context.Background(), s, nil, nil)
	if r.Passed || !strings.Contains(r.Steps[0].Error, "1 MB") {
		t.Fatal(r)
	}
}
func TestCancellation(t *testing.T) {
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(started); <-r.Context().Done() }))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { <-started; cancel() }()
	s := model.NewScenario()
	s.Steps[0].URL = server.URL
	r := Run(ctx, s, nil, nil)
	if !r.Cancelled || r.Passed {
		t.Fatal(r)
	}
}
func TestJSONAssertionAndTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{"ok":false}`)) }))
	defer server.Close()
	s := model.NewScenario()
	s.Steps[0].URL = server.URL
	s.Steps[0].Checks = []model.Check{{Path: "ok", Equals: true}}
	r := Run(context.Background(), s, nil, nil)
	if r.Passed {
		t.Fatal("assertion ignored")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Nanosecond)
	defer cancel()
	r = Run(ctx, s, nil, nil)
	if r.Passed {
		t.Fatal("expired context passed")
	}
}
