package vault

import (
	"bytes"
	"crypto/rand"
	"github.com/pinomaker-hoo/pino-workbench/internal/model"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestEncryptedLifecycle(t *testing.T) {
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	path := filepath.Join(t.TempDir(), "vault.enc")
	s, e := Open(path, key)
	if e != nil {
		t.Fatal(e)
	}
	p := model.Profile{ID: "jira", Transport: "stdio", Command: "server", Args: []string{}}
	if e = s.SaveProfile(p, map[string]string{"TOKEN": "hidden-secret"}); e != nil {
		t.Fatal(e)
	}
	sc := model.NewScenario()
	if e = s.SaveScenario(sc, map[string]string{"token": "local-secret"}); e != nil {
		t.Fatal(e)
	}
	raw, _ := os.ReadFile(path)
	if bytes.Contains(raw, []byte("secret")) {
		t.Fatal("plaintext leaked")
	}
	restored, e := Open(path, key)
	if e != nil {
		t.Fatal(e)
	}
	if restored.Snapshot().Profiles["jira"].Secrets["TOKEN"] != "hidden-secret" {
		t.Fatal("not restored")
	}
	p.Command = "different-server"
	if e = restored.SaveProfile(p, nil); e == nil {
		t.Fatal("credentials reused for changed destination")
	}
	if e = restored.SaveProfile(p, map[string]string{}); e != nil {
		t.Fatal(e)
	}
	if e = restored.DeleteScenario(sc.ID); e != nil {
		t.Fatal(e)
	}
	if e = restored.DeleteProfile("jira"); e != nil {
		t.Fatal(e)
	}
	if len(restored.Snapshot().Scenarios) != 0 || len(restored.Snapshot().Profiles) != 0 {
		t.Fatal("delete failed")
	}
	_ = os.WriteFile(path, []byte("corrupt"), 0600)
	if _, e = Open(path, key); e == nil {
		t.Fatal("corrupt vault accepted")
	}
	b, _ := os.ReadFile(path)
	if string(b) != "corrupt" {
		t.Fatal("corruption overwritten")
	}
}
func TestConcurrentSavesAndSnapshotIsolation(t *testing.T) {
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	s, _ := Open(filepath.Join(t.TempDir(), "vault.enc"), key)
	var wg sync.WaitGroup
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if e := s.SaveScenario(model.NewScenario(), nil); e != nil {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	if len(s.Snapshot().Scenarios) != 12 {
		t.Fatal("lost writes")
	}
	snap := s.Snapshot()
	for k := range snap.Scenarios {
		delete(snap.Scenarios, k)
	}
	if len(s.Snapshot().Scenarios) != 12 {
		t.Fatal("snapshot modified store")
	}
}
