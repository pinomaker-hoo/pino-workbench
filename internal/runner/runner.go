package runner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/pinomaker-hoo/pino-workbench/internal/model"
	"io"
	"net/http"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"time"
)

type StepResult struct {
	ID, Name    string
	Status      int
	Duration    time.Duration
	Passed      bool
	Body, Error string
}
type Result struct {
	Steps             []StepResult
	Passed, Cancelled bool
}

var placeholder = regexp.MustCompile(`\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}`)

func Interpolate(value string, vars map[string]string) (string, error) {
	var err error
	out := placeholder.ReplaceAllStringFunc(value, func(token string) string {
		k := token[2 : len(token)-2]
		v, ok := vars[k]
		if !ok {
			err = fmt.Errorf("set local variable %s", k)
		}
		return v
	})
	return out, err
}
func mask(body string, sensitive map[string]bool) string {
	keys := []string{}
	for k := range sensitive {
		if k != "" {
			keys = append(keys, k)
		}
	}
	sort.Slice(keys, func(i, j int) bool { return len(keys[i]) > len(keys[j]) })
	for _, k := range keys {
		body = strings.ReplaceAll(body, k, "[local value]")
	}
	return body
}
func Run(ctx context.Context, s model.Scenario, initial map[string]string, progress func(StepResult)) Result {
	result := Result{}
	if e := s.Validate(); e != nil {
		return Result{Steps: []StepResult{{Error: e.Error()}}}
	}
	vars := map[string]string{}
	secrets := map[string]bool{}
	for k, v := range initial {
		vars[k] = v
		secrets[v] = true
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	defer client.CloseIdleConnections()
	for _, step := range s.Steps {
		if ctx.Err() != nil {
			break
		}
		start := time.Now()
		r := StepResult{ID: step.ID, Name: step.Name}
		func() {
			stepCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
			defer cancel()
			target, e := Interpolate(step.URL, vars)
			if e != nil {
				r.Error = e.Error()
				return
			}
			if e = model.ValidURL(target, false); e != nil {
				r.Error = "HTTP(S) URL without embedded credentials required"
				return
			}
			body, e := Interpolate(step.Body, vars)
			if e != nil {
				r.Error = e.Error()
				return
			}
			if (step.Method == "GET" || step.Method == "HEAD") && body != "" {
				r.Error = "GET/HEAD cannot have a body"
				return
			}
			req, e := http.NewRequestWithContext(stepCtx, step.Method, target, strings.NewReader(body))
			if e != nil {
				r.Error = "invalid request"
				return
			}
			for k, v := range step.Headers {
				h, e := Interpolate(v, vars)
				if e != nil {
					r.Error = e.Error()
					return
				}
				req.Header.Set(k, h)
			}
			res, e := client.Do(req)
			if e != nil {
				r.Error = "request failed or timed out (15s); check URL, credentials and server"
				return
			}
			defer res.Body.Close()
			r.Status = res.StatusCode
			b, e := io.ReadAll(io.LimitReader(res.Body, (1<<20)+1))
			if e != nil {
				r.Error = "response interrupted or timed out"
				return
			}
			if len(b) > 1<<20 {
				r.Error = "response exceeds 1 MB"
				return
			}
			r.Body = string(b)
			var parsed any
			if len(step.Captures) > 0 || len(step.Checks) > 0 {
				if e = json.Unmarshal(b, &parsed); e != nil {
					r.Error = "JSON response required for extraction/assertions"
					return
				}
			}
			captured := map[string]string{}
			for k, path := range step.Captures {
				v, e := model.Path(parsed, path)
				if e != nil {
					r.Error = e.Error()
					return
				}
				switch v.(type) {
				case string, float64, bool:
					captured[k] = fmt.Sprint(v)
					secrets[captured[k]] = true
				default:
					r.Error = "capture requires a string, number or boolean"
					return
				}
			}
			if r.Status != step.ExpectedStatus {
				r.Error = fmt.Sprintf("expected HTTP %d, received %d", step.ExpectedStatus, r.Status)
				return
			}
			for _, check := range step.Checks {
				v, e := model.Path(parsed, check.Path)
				if e != nil {
					r.Error = e.Error()
					return
				}
				if !reflect.DeepEqual(v, check.Equals) {
					r.Error = fmt.Sprintf("assertion failed: %s", check.Path)
					return
				}
			}
			for k, v := range captured {
				vars[k] = v
			}
			r.Passed = true
		}()
		if ctx.Err() != nil {
			r.Passed = false
			r.Error = "cancelled; already sent requests are not rolled back"
		}
		r.Body = mask(r.Body, secrets)
		r.Error = mask(r.Error, secrets)
		r.Duration = time.Since(start)
		result.Steps = append(result.Steps, r)
		if progress != nil {
			progress(r)
		}
		if !r.Passed {
			break
		}
	}
	result.Cancelled = errors.Is(ctx.Err(), context.Canceled)
	result.Passed = !result.Cancelled && len(result.Steps) == len(s.Steps)
	for _, r := range result.Steps {
		result.Passed = result.Passed && r.Passed
	}
	return result
}
