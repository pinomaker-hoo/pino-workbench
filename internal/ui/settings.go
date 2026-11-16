package ui

import (
	"context"
	"encoding/json"
	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/widget"
	"github.com/pinomaker-hoo/pino-workbench/internal/connectors"
	"github.com/pinomaker-hoo/pino-workbench/internal/model"
	"sort"
	"strings"
)

func (u *App) settingsPage() fyne.CanvasObject {
	service := widget.NewSelect(model.Services, nil)
	transport := widget.NewSelect([]string{"stdio", "http", "cli"}, nil)
	endpoint := entry("")
	command := entry("")
	args := multi("[]", 2)
	secrets := multi("", 3)
	secrets.Password = true
	secrets.SetPlaceHolder("JSON object; blank keeps saved values; {} clears them")
	reveal := widget.NewCheck("Show authentication input", func(on bool) { secrets.Password = !on; secrets.Refresh() })
	keys := wrap("")
	tool := entry("")
	params := multi("{}", 3)
	path := entry("")
	base := entry("")
	output := multi("Test a saved MCP connection to discover tool names and argument schemas.", 8)
	output.Disable()
	load := func(id string) {
		p, ok := u.Store.Snapshot().Profiles[id]
		if !ok {
			p = model.Profile{ID: id, Transport: "stdio", Args: []string{}, Arguments: map[string]any{"query": "{{query}}"}, ResultPath: "results"}
			if id == "jira" {
				p.Arguments = map[string]any{"jql": "{{query}}"}
				p.ResultPath = "issues"
			}
			if id == "claude" || id == "codex" {
				p.Transport = "cli"
				p.Command = id
			}
		}
		transport.SetSelected(p.Transport)
		endpoint.SetText(p.Endpoint)
		command.SetText(p.Command)
		args.SetText(pretty(p.Args))
		tool.SetText(p.Tool)
		params.SetText(pretty(p.Arguments))
		path.SetText(p.ResultPath)
		base.SetText(p.BaseURL)
		secrets.SetText("")
		list := []string{}
		for k := range p.Secrets {
			list = append(list, k)
		}
		sort.Strings(list)
		keys.SetText("Saved secret keys: " + strings.Join(list, ", "))
		output.SetText("Save before testing. Switching services discards unsaved edits.")
	}
	service.OnChanged = load
	service.SetSelected("jira")
	save := widget.NewButton("로컬에 저장", func() {
		p := model.Profile{ID: service.Selected, Transport: transport.Selected, Endpoint: endpoint.Text, Command: command.Text, Tool: tool.Text, ResultPath: path.Text, BaseURL: base.Text}
		if e := decode(args.Text, &p.Args); e != nil {
			u.err(e)
			return
		}
		if e := decode(params.Text, &p.Arguments); e != nil {
			u.err(e)
			return
		}
		var values map[string]string
		if strings.TrimSpace(secrets.Text) != "" {
			if e := decode(secrets.Text, &values); e != nil {
				u.err(e)
				return
			}
			if values == nil {
				u.err(errorf("authentication must be a JSON object"))
				return
			}
		}
		u.run("Encrypting local settings…", func(context.Context) (func(), error) {
			e := u.Store.SaveProfile(p, values)
			return func() { load(p.ID) }, e
		})
	})
	test := widget.NewButton("MCP 연결 테스트", func() {
		id := service.Selected
		p, ok := u.Store.Snapshot().Profiles[id]
		if !ok {
			u.err(errorf("save the connection first"))
			return
		}
		u.run("Connecting to "+id+"…", func(ctx context.Context) (func(), error) {
			tools, e := connectors.Discover(ctx, p)
			if e != nil {
				return nil, e
			}
			b, _ := json.MarshalIndent(tools, "", "  ")
			return func() { output.SetText(string(b)); u.status.SetText("MCP connected · " + id) }, nil
		})
	})
	remove := widget.NewButton("설정 및 인증 삭제", func() {
		id := service.Selected
		u.confirm("Delete this service's local settings and credentials?", func() {
			u.run("Deleting…", func(context.Context) (func(), error) { e := u.Store.DeleteProfile(id); return func() { load(id) }, e })
		})
	})
	fields := container.NewVBox(formEntry("Service", service), formEntry("Transport", transport), formEntry("MCP endpoint (HTTPS or local HTTP)", endpoint), formEntry("Executable / absolute path", command), formEntry("Arguments · JSON array", args), formEntry("Authentication headers (HTTP) / environment (stdio, CLI)", secrets), reveal, keys, wrap("AI: log in using the installed CLI. Pino does not copy its login data. AI execution, browser OAuth and legacy SSE are not implemented."), widget.NewSeparator(), formEntry("Read-only search tool", tool), formEntry("Tool arguments · {{query}} is replaced by the search", params), formEntry("Result array path · issues / results / empty for root", path), formEntry("Source base URL (if results omit URLs)", base), wrap("Saving does not run commands or contact a server. Testing and searching use the saved configuration."), wrap("Encrypted vault: "+u.Store.Path()))
	split := container.NewHSplit(container.NewBorder(nil, container.NewHBox(save, test, remove), nil, nil, container.NewVScroll(fields)), container.NewBorder(header("SERVER TOOLS", "Names and input schemas from your MCP server"), nil, nil, nil, output))
	split.Offset = .55
	return container.NewBorder(header("내 컴퓨터의 연결 설정", "User-managed connections. Authentication stays in the OS-protected local vault."), nil, nil, nil, split)
}
