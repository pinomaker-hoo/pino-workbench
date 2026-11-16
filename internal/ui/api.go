package ui

import (
	"context"
	"fmt"
	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/dialog"
	"fyne.io/fyne/v2/widget"
	"github.com/pinomaker-hoo/pino-workbench/internal/model"
	"github.com/pinomaker-hoo/pino-workbench/internal/runner"
	"io"
	"sort"
	"strconv"
	"strings"
)

func (u *App) apiPage() fyne.CanvasObject {
	draft := model.NewScenario()
	index := 0
	dirty := false
	loading := false
	name := entry(draft.Name)
	issue := entry("")
	u.apiIssue = issue
	requestName := entry("")
	method := widget.NewSelect([]string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"}, nil)
	url := entry("")
	headers := multi("{}", 3)
	body := multi("", 3)
	status := entry("200")
	captures := multi("{}", 2)
	checks := multi("[]", 2)
	variables := multi("", 2)
	variables.Password = true
	variables.SetPlaceHolder(`{"baseUrl":"http://localhost:3000","token":"..."}`)
	keys := wrap("")
	results := multi("Results appear here. Requests are sent only when you click Run.", 5)
	results.Disable()
	savedIDs := []string{}
	stepSelect := widget.NewSelect([]string{}, nil)
	stepSelect.PlaceHolder = "Request"
	snapshot := func() (model.Scenario, error) {
		d := draft
		d.Name = name.Text
		d.IssueKey = issue.Text
		d.Steps = append([]model.Step(nil), draft.Steps...)
		r := d.Steps[index]
		r.Name = requestName.Text
		r.Method = method.Selected
		r.URL = url.Text
		r.Body = body.Text
		n, e := strconv.Atoi(status.Text)
		if e != nil {
			return d, errorf("expected status must be an integer")
		}
		r.ExpectedStatus = n
		if e = decode(headers.Text, &r.Headers); e != nil {
			return d, e
		}
		if e = decode(captures.Text, &r.Captures); e != nil {
			return d, e
		}
		if e = decode(checks.Text, &r.Checks); e != nil {
			return d, e
		}
		d.Steps[index] = r
		return d, nil
	}
	var list *widget.List
	refreshSaved := func() {
		data := u.Store.Snapshot()
		savedIDs = nil
		for id := range data.Scenarios {
			savedIDs = append(savedIDs, id)
		}
		sort.Slice(savedIDs, func(i, j int) bool {
			return data.Scenarios[savedIDs[i]].Scenario.Name < data.Scenarios[savedIDs[j]].Scenario.Name
		})
		if list != nil {
			list.Refresh()
		}
	}
	showStep := func() {
		loading = true
		r := draft.Steps[index]
		requestName.SetText(r.Name)
		method.SetSelected(r.Method)
		url.SetText(r.URL)
		headers.SetText(pretty(r.Headers))
		body.SetText(r.Body)
		status.SetText(strconv.Itoa(r.ExpectedStatus))
		captures.SetText(pretty(r.Captures))
		checks.SetText(pretty(r.Checks))
		labels := []string{}
		for i, s := range draft.Steps {
			labels = append(labels, fmt.Sprintf("%d · %s", i+1, s.Name))
		}
		stepSelect.Options = labels
		stepSelect.SetSelectedIndex(index)
		stepSelect.Refresh()
		loading = false
	}
	load := func(s model.Scenario) {
		draft = s
		index = 0
		loading = true
		name.SetText(s.Name)
		issue.SetText(s.IssueKey)
		variables.SetText("")
		showStep()
		dirty = false
		loading = false
		local := u.Store.Snapshot().Scenarios[s.ID]
		names := []string{}
		for k := range local.Variables {
			names = append(names, k)
		}
		sort.Strings(names)
		keys.SetText("Saved local keys: " + strings.Join(names, ", "))
		results.SetText("Ready. No requests sent.")
	}
	change := func(string) {
		if !loading {
			dirty = true
			results.SetText("Unsaved changes · save or run to apply")
		}
	}
	for _, e := range []*widget.Entry{name, issue, requestName, url, headers, body, status, captures, checks, variables} {
		e.OnChanged = change
	}
	method.OnChanged = change
	discard := func(action func()) {
		if dirty {
			u.confirm("Discard unsaved scenario changes?", action)
		} else {
			action()
		}
	}
	list = widget.NewList(func() int { return len(savedIDs) }, func() fyne.CanvasObject { return widget.NewLabel("Scenario") }, func(id widget.ListItemID, o fyne.CanvasObject) {
		o.(*widget.Label).SetText(u.Store.Snapshot().Scenarios[savedIDs[id]].Scenario.Name)
	})
	list.OnSelected = func(id widget.ListItemID) {
		if u.busy {
			return
		}
		s := u.Store.Snapshot().Scenarios[savedIDs[id]].Scenario
		discard(func() { load(s) })
	}
	stepSelect.OnChanged = func(_ string) {
		if loading {
			return
		}
		next := stepSelect.SelectedIndex()
		if next < 0 || next == index {
			return
		}
		d, e := snapshot()
		if e != nil {
			u.err(e)
			loading = true
			stepSelect.SetSelectedIndex(index)
			loading = false
			return
		}
		draft = d
		index = next
		showStep()
	}
	persist := func(s model.Scenario, vars map[string]string) func() {
		return func() {
			draft = s
			dirty = false
			loading = true
			variables.SetText("")
			loading = false
			refreshSaved()
			names := []string{}
			for k := range u.Store.Snapshot().Scenarios[s.ID].Variables {
				names = append(names, k)
			}
			sort.Strings(names)
			keys.SetText("Saved local keys: " + strings.Join(names, ", "))
		}
	}
	prepare := func() (model.Scenario, map[string]string, error) {
		s, e := snapshot()
		if e != nil {
			return s, nil, e
		}
		if e = s.Validate(); e != nil {
			return s, nil, e
		}
		var vars map[string]string
		if strings.TrimSpace(variables.Text) != "" {
			if e = decode(variables.Text, &vars); e != nil {
				return s, nil, e
			}
			if vars == nil {
				return s, nil, errorf("variables must be an object")
			}
		}
		return s, vars, nil
	}
	save := widget.NewButton("저장", func() {
		s, vars, e := prepare()
		if e != nil {
			u.err(e)
			return
		}
		u.run("Saving scenario…", func(context.Context) (func(), error) { e := u.Store.SaveScenario(s, vars); return persist(s, vars), e })
	})
	run := widget.NewButton("전체 실행", func() {
		s, vars, e := prepare()
		if e != nil {
			u.err(e)
			return
		}
		u.run("Running API scenario…", func(ctx context.Context) (func(), error) {
			if e := u.Store.SaveScenario(s, vars); e != nil {
				return nil, e
			}
			row := u.Store.Snapshot().Scenarios[s.ID]
			var progress strings.Builder
			r := runner.Run(ctx, s, row.Variables, func(r runner.StepResult) {
				state := "PASS"
				if !r.Passed {
					state = "FAIL"
				}
				fmt.Fprintf(&progress, "%s  %s · HTTP %d · %d ms\n%s\n%s\n\n", state, r.Name, r.Status, r.Duration.Milliseconds(), r.Error, r.Body)
				text := progress.String()
				fyne.Do(func() { results.SetText(text) })
			})
			text := progress.String()
			return func() {
				persist(s, vars)()
				summary := "FAILED"
				if r.Passed {
					summary = "PASSED"
				}
				if r.Cancelled {
					summary = "CANCELLED"
				}
				results.SetText(summary + "\n\n" + text)
				u.status.SetText("API scenario " + summary)
			}, nil
		})
	})
	share := widget.NewButton("공유 파일", func() {
		if dirty {
			u.err(errorf("save changes before sharing"))
			return
		}
		row, ok := u.Store.Snapshot().Scenarios[draft.ID]
		if !ok {
			u.err(errorf("save the scenario first"))
			return
		}
		b, e := model.Export(row.Scenario)
		if e != nil {
			u.err(e)
			return
		}
		u.saveFile("scenario.pino-api.json", b)
	})
	importFile := widget.NewButton("가져오기", func() {
		discard(func() {
			dialog.ShowFileOpen(func(r fyne.URIReadCloser, e error) {
				if e != nil {
					u.err(e)
					return
				}
				if r == nil {
					return
				}
				defer r.Close()
				b, e := io.ReadAll(io.LimitReader(r, (2<<20)+1))
				if e != nil {
					u.err(e)
					return
				}
				s, e := model.Import(b)
				if e != nil {
					u.err(e)
					return
				}
				u.run("Importing without local variables…", func(context.Context) (func(), error) {
					e := u.Store.SaveScenario(s, map[string]string{})
					return func() { refreshSaved(); load(s); u.status.SetText("Imported; configure your variables before running") }, e
				})
			}, u.Window)
		})
	})
	newButton := widget.NewButton("새 시나리오", func() { discard(func() { load(model.NewScenario()) }) })
	remove := widget.NewButton("시나리오 삭제", func() {
		id := draft.ID
		u.confirm("Delete this scenario and its local variables?", func() {
			u.run("Deleting…", func(context.Context) (func(), error) {
				e := u.Store.DeleteScenario(id)
				return func() { refreshSaved(); load(model.NewScenario()) }, e
			})
		})
	})
	add := widget.NewButton("요청 추가", func() {
		d, e := snapshot()
		if e != nil {
			u.err(e)
			return
		}
		if len(d.Steps) >= 30 {
			u.err(errorf("maximum 30 requests"))
			return
		}
		draft = d
		draft.Steps = append(draft.Steps, model.NewStep())
		index = len(draft.Steps) - 1
		showStep()
		dirty = true
	})
	move := func(delta int) {
		if index+delta < 0 || index+delta >= len(draft.Steps) {
			return
		}
		d, e := snapshot()
		if e != nil {
			u.err(e)
			return
		}
		d.Steps[index], d.Steps[index+delta] = d.Steps[index+delta], d.Steps[index]
		draft = d
		index += delta
		showStep()
		dirty = true
	}
	deleteStep := widget.NewButton("요청 삭제", func() {
		if len(draft.Steps) == 1 {
			return
		}
		draft.Steps = append(draft.Steps[:index], draft.Steps[index+1:]...)
		index = 0
		showStep()
		dirty = true
	})
	attach := widget.NewButton("현재 이슈 연결", func() { issue.SetText(u.IssueKey) })
	editor := container.NewVBox(container.NewGridWithColumns(2, formEntry("Scenario name", name), formEntry("Jira issue key", container.NewBorder(nil, nil, nil, attach, issue))), container.NewBorder(nil, nil, nil, container.NewHBox(add, widget.NewButton("↑", func() { move(-1) }), widget.NewButton("↓", func() { move(1) }), deleteStep), stepSelect), formEntry("Request name", requestName), container.NewBorder(nil, nil, method, nil, url), container.NewGridWithColumns(2, formEntry("Headers · JSON object", headers), formEntry("Body · raw text / JSON", body)), container.NewGridWithColumns(3, formEntry("Expected status", status), formEntry("Response → variables", captures), formEntry("JSON assertions", checks)), wrap(`Variables: {{baseUrl}}, {{token}}. Captures: {"userId":"data.id"}. Checks: [{"path":"ok","equals":true}].`), widget.NewSeparator(), formEntry("Local variables · encrypted, never shared", variables), widget.NewCheck("Show local variable input", func(on bool) { variables.Password = !on; variables.Refresh() }), keys, wrap("Blank keeps saved values; {} clears them. Literal URL/header/body values ARE shared. Store tokens in local variables."), wrap("Real requests · stop on first failure · 15s/request · 1 MB response · no automatic redirects"))
	refreshSaved()
	load(draft)
	left := container.NewBorder(container.NewVBox(newButton, importFile, widget.NewSeparator()), wrap("Local scenarios\nNo automatic network sync"), nil, nil, list)
	right := container.NewVSplit(container.NewBorder(nil, container.NewHBox(save, run, share, remove), nil, nil, container.NewVScroll(editor)), container.NewBorder(header("RUN RESULTS", "Captured/local variable strings are masked. Other response data is shown."), nil, nil, nil, results))
	right.Offset = .68
	split := container.NewHSplit(left, right)
	split.Offset = .19
	return container.NewBorder(header("API 시나리오", "순차 요청 → 응답 변수 전달 → 검증 → 파일 공유"), nil, nil, nil, split)
}
