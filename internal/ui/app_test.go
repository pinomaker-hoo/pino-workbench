package ui

import (
	"crypto/rand"
	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/test"
	"fyne.io/fyne/v2/widget"
	"github.com/pinomaker-hoo/pino-workbench/internal/vault"
	"path/filepath"
	"testing"
)

func walk(o fyne.CanvasObject, fn func(fyne.CanvasObject)) {
	fn(o)
	switch c := o.(type) {
	case *fyne.Container:
		for _, child := range c.Objects {
			walk(child, fn)
		}
	case *container.Scroll:
		walk(c.Content, fn)
	case *container.Split:
		walk(c.Leading, fn)
		walk(c.Trailing, fn)
	}
}
func button(root fyne.CanvasObject, label string) *widget.Button {
	var found *widget.Button
	walk(root, func(o fyne.CanvasObject) {
		if b, ok := o.(*widget.Button); ok && b.Text == label {
			found = b
		}
	})
	return found
}
func TestNativeNavigationAndRequestEditing(t *testing.T) {
	a := test.NewApp()
	defer a.Quit()
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	s, e := vault.Open(filepath.Join(t.TempDir(), "vault.enc"), key)
	if e != nil {
		t.Fatal(e)
	}
	u := New(a, s)
	u.Window.Resize(fyne.NewSize(1360, 900))
	u.Window.Show()
	defer u.Window.Close()
	if u.IssueKey != "PINO-24" {
		t.Fatal("demo not selected")
	}
	api := button(u.Window.Content(), "API 시나리오")
	if api == nil {
		t.Fatal("missing navigation")
	}
	test.Tap(api)
	add := button(u.Window.Content(), "요청 추가")
	if add == nil {
		t.Fatal("API page missing")
	}
	test.Tap(add)
	count := 0
	walk(u.Window.Content(), func(o fyne.CanvasObject) {
		if s, ok := o.(*widget.Select); ok && len(s.Options) == 2 && s.Options[0] == "1 · Health check" {
			count = len(s.Options)
		}
	})
	if count != 2 {
		t.Fatal("request editor did not add a request")
	}
	test.Tap(button(u.Window.Content(), "현재 이슈 연결"))
	if u.apiIssue.Text != "PINO-24" {
		t.Fatal("issue link missing")
	}
	test.Tap(button(u.Window.Content(), "서비스 연결"))
	if button(u.Window.Content(), "MCP 연결 테스트") == nil {
		t.Fatal("settings not shown")
	}
	if len(s.Snapshot().Profiles) != 0 || len(s.Snapshot().Scenarios) != 0 {
		t.Fatal("navigation caused persistence or background work")
	}
}
