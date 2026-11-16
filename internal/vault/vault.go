package vault

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/gofrs/flock"
	"github.com/natefinch/atomic"
	"github.com/pinomaker-hoo/pino-workbench/internal/model"
	"github.com/zalando/go-keyring"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sync"
)

const keyService = "dev.pino.workbench"

type Data struct {
	Profiles   map[string]model.Profile       `json:"profiles"`
	Scenarios  map[string]model.SavedScenario `json:"scenarios"`
	Repository string                         `json:"repository"`
}
type Store struct {
	lock *flock.Flock
	mu   sync.Mutex
	path string
	key  []byte
	data Data
}

func empty() Data {
	return Data{Profiles: map[string]model.Profile{}, Scenarios: map[string]model.SavedScenario{}}
}

// OpenOS never falls back to an unencrypted file or overwrites a missing key.
func OpenOS() (store *Store, err error) {
	root, e := os.UserConfigDir()
	if e != nil {
		return nil, e
	}
	path := filepath.Join(root, "pino-workbench", "vault.enc")
	if e = os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return nil, e
	}
	lock := flock.New(path + ".lock")
	locked, e := lock.TryLock()
	if e != nil || !locked {
		return nil, errors.New("Pino Workbench is already open, or the settings directory cannot be locked")
	}
	defer func() {
		if store == nil {
			_ = lock.Unlock()
		}
	}()

	_, statErr := os.Stat(path)
	raw, e := keyring.Get(keyService, "vault-key-v1")
	if errors.Is(e, keyring.ErrNotFound) && errors.Is(statErr, os.ErrNotExist) {
		key := make([]byte, 32)
		if _, e = rand.Read(key); e != nil {
			return nil, e
		}
		raw = base64.StdEncoding.EncodeToString(key)
		e = keyring.Set(keyService, "vault-key-v1", raw)
	}
	if e != nil {
		return nil, errors.New("OS credential store unavailable. Existing data is preserved; unlock your keychain and restart")
	}
	key, e := base64.StdEncoding.DecodeString(raw)
	if e != nil || len(key) != 32 {
		return nil, errors.New("invalid OS vault key; existing data preserved")
	}
	store, err = Open(path, key)
	if store != nil {
		store.lock = lock
	}
	return store, err
}
func Open(path string, key []byte) (*Store, error) {
	if len(key) != 32 {
		return nil, errors.New("32-byte encryption key required")
	}
	s := &Store{path: path, key: append([]byte(nil), key...), data: empty()}
	b, e := os.ReadFile(path)
	if errors.Is(e, os.ErrNotExist) {
		return s, nil
	}
	if e != nil {
		return nil, e
	}
	block, e := aes.NewCipher(key)
	if e != nil {
		return nil, e
	}
	a, e := cipher.NewGCM(block)
	if e != nil {
		return nil, e
	}
	if len(b) < a.NonceSize() {
		return nil, errors.New("invalid vault; preserved")
	}
	plain, e := a.Open(nil, b[:a.NonceSize()], b[a.NonceSize():], []byte(keyService))
	if e != nil {
		return nil, errors.New("cannot decrypt vault; preserved")
	}
	if e = json.Unmarshal(plain, &s.data); e != nil || s.data.Profiles == nil || s.data.Scenarios == nil {
		return nil, errors.New("invalid vault format; preserved")
	}
	return s, nil
}
func clone(d Data) Data {
	b, _ := json.Marshal(d)
	var out Data
	_ = json.Unmarshal(b, &out)
	return out
}
func (s *Store) Snapshot() Data { s.mu.Lock(); defer s.mu.Unlock(); return clone(s.data) }
func (s *Store) Path() string   { return s.path }
func (s *Store) update(f func(*Data) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := clone(s.data)
	if e := f(&next); e != nil {
		return e
	}
	b, e := json.Marshal(next)
	if e != nil {
		return e
	}
	if len(b) > 20<<20 {
		return errors.New("vault exceeds 20 MB")
	}
	block, _ := aes.NewCipher(s.key)
	a, _ := cipher.NewGCM(block)
	nonce := make([]byte, a.NonceSize())
	if _, e = io.ReadFull(rand.Reader, nonce); e != nil {
		return e
	}
	encrypted := a.Seal(nonce, nonce, b, []byte(keyService))
	if e = os.MkdirAll(filepath.Dir(s.path), 0700); e != nil {
		return e
	}
	if e = atomic.WriteFile(s.path, bytes.NewReader(encrypted)); e != nil {
		return e
	}
	_ = os.Chmod(s.path, 0600)
	s.data = next
	return nil
}
func (s *Store) SaveProfile(p model.Profile, secrets map[string]string) error {
	if e := p.Validate(); e != nil {
		return e
	}
	return s.update(func(d *Data) error {
		old, ok := d.Profiles[p.ID]
		if secrets == nil && ok && len(old.Secrets) > 0 && (p.Transport != old.Transport || p.Endpoint != old.Endpoint || p.Command != old.Command || !reflect.DeepEqual(p.Args, old.Args)) {
			return errors.New("destination changed: re-enter authentication values or {} to clear")
		}
		if secrets == nil {
			p.Secrets = old.Secrets
		} else {
			p.Secrets = secrets
		}
		d.Profiles[p.ID] = p
		return nil
	})
}
func (s *Store) DeleteProfile(id string) error {
	return s.update(func(d *Data) error { delete(d.Profiles, id); return nil })
}
func (s *Store) SaveScenario(sc model.Scenario, vars map[string]string) error {
	if e := sc.Validate(); e != nil {
		return e
	}
	if e := model.ValidateVariables(vars); e != nil {
		return e
	}
	return s.update(func(d *Data) error {
		if len(d.Scenarios) >= 100 {
			if _, ok := d.Scenarios[sc.ID]; !ok {
				return errors.New("maximum 100 scenarios")
			}
		}
		if vars == nil {
			vars = d.Scenarios[sc.ID].Variables
		}
		d.Scenarios[sc.ID] = model.SavedScenario{Scenario: sc, Variables: vars}
		return nil
	})
}
func (s *Store) DeleteScenario(id string) error {
	return s.update(func(d *Data) error { delete(d.Scenarios, id); return nil })
}
func (s *Store) SetRepository(path string) error {
	return s.update(func(d *Data) error { d.Repository = path; return nil })
}

func (s *Store) Close() error {
	if s.lock != nil {
		return s.lock.Unlock()
	}
	return nil
}
