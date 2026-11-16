package ui

import (
	"context"
	"fmt"
	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/dialog"
	"fyne.io/fyne/v2/widget"
	"github.com/pinomaker-hoo/pino-workbench/internal/connectors"
	"github.com/pinomaker-hoo/pino-workbench/internal/model"
	"strings"
)

func (u *App) workPage() fyne.CanvasObject {
	issues := []model.Issue{{Key: "PINO-24", Title: "업무 맥락을 하나의 작업 공간으로 연결하기", Status: "Demo", Assignee: "You", Description: "이 데이터는 데모입니다.\n\n서비스 연결에서 Jira와 Confluence MCP를 설정하세요.\n관련 문서를 선택한 뒤 작업 맥락을 Markdown으로 저장할 수 있습니다.\nAPI 시나리오와 이슈를 연결하여 실제 요청 흐름을 검증하세요.", URL: "https://example.atlassian.net/browse/PINO-24"}}
	pages := []model.Page{{ID: "demo", Title: "Pino Workbench · 제품 방향", Text: "Windows와 macOS를 위한 Go + Fyne 로컬 개발 워크스페이스. 웹 UI나 WebView를 사용하지 않습니다.", URL: "https://example.atlassian.net/wiki/pages/viewpage.action?pageId=1"}}
	selected := 0
	u.IssueKey = issues[0].Key
	jql := entry("assignee = currentUser() ORDER BY updated DESC")
	query := entry("")
	query.SetPlaceHolder("Confluence search query")
	detail := multi("", 15)
	detail.Disable()
	refs := widget.NewCheckGroup([]string{}, nil)
	preview := multi("Select reference documents to preview their contents.", 10)
	preview.Disable()
	show := func() {
		if selected < 0 || selected >= len(issues) {
			detail.SetText("Select an issue")
			return
		}
		i := issues[selected]
		u.IssueKey = i.Key
		detail.SetText(fmt.Sprintf("%s · %s\n\n%s\n\nAssignee: %s    Priority: %s\n\n%s\n\nSource: %s", i.Key, i.Status, i.Title, i.Assignee, i.Priority, i.Description, i.URL))
	}
	refLabels := func() {
		options := []string{}
		for _, p := range pages {
			options = append(options, p.ID+" · "+p.Title)
		}
		refs.Options = options
		refs.SetSelected([]string{})
		refs.Refresh()
	}
	refLabels()
	refs.OnChanged = func(labels []string) {
		var text []string
		for _, p := range pages {
			for _, label := range labels {
				if label == p.ID+" · "+p.Title {
					text = append(text, p.Title+"\n"+p.Text+"\n"+p.URL)
				}
			}
		}
		preview.SetText(strings.Join(text, "\n\n"))
	}
	list := widget.NewList(func() int { return len(issues) }, func() fyne.CanvasObject {
		return container.NewVBox(widget.NewLabelWithStyle("KEY", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}), widget.NewLabel("Title"))
	}, func(id widget.ListItemID, obj fyne.CanvasObject) {
		c := obj.(*fyne.Container)
		c.Objects[0].(*widget.Label).SetText(issues[id].Key + " · " + issues[id].Status)
		label := c.Objects[1].(*widget.Label)
		label.Truncation = fyne.TextTruncateEllipsis
		label.SetText(issues[id].Title)
	})
	list.OnSelected = func(id widget.ListItemID) {
		if u.busy {
			return
		}
		selected = id
		refs.SetSelected([]string{})
		show()
	}
	show()
	search := widget.NewButton("Jira 검색", func() {
		p, ok := u.Store.Snapshot().Profiles["jira"]
		if !ok {
			u.err(errorf("configure Jira MCP under 서비스 연결"))
			return
		}
		q := jql.Text
		u.run("Searching Jira…", func(ctx context.Context) (func(), error) {
			rows, e := connectors.Search(ctx, p, q)
			if e != nil {
				return nil, e
			}
			out := []model.Issue{}
			for _, row := range rows {
				i, e := connectors.Issue(row, p.BaseURL)
				if e != nil {
					return nil, e
				}
				out = append(out, i)
			}
			return func() {
				issues = out
				selected = -1
				list.UnselectAll()
				list.Refresh()
				refs.SetSelected([]string{})
				if len(issues) > 0 {
					list.Select(0)
				} else {
					show()
					u.IssueKey = ""
				}
			}, nil
		})
	})
	pageSearch := widget.NewButton("문서 검색", func() {
		p, ok := u.Store.Snapshot().Profiles["confluence"]
		if !ok {
			u.err(errorf("configure Confluence MCP first"))
			return
		}
		q := query.Text
		u.run("Searching Confluence…", func(ctx context.Context) (func(), error) {
			rows, e := connectors.Search(ctx, p, q)
			if e != nil {
				return nil, e
			}
			out := []model.Page{}
			for _, row := range rows {
				page, e := connectors.Page(row, p.BaseURL)
				if e != nil {
					return nil, e
				}
				out = append(out, page)
			}
			return func() { pages = out; refLabels(); preview.SetText("Select references to preview.") }, nil
		})
	})
	repo := wrap(u.Store.Snapshot().Repository)
	if repo.Text == "" {
		repo.SetText("No repository selected")
	}
	repository := widget.NewButton("Git 저장소 선택", func() {
		dialog.ShowFolderOpen(func(uri fyne.ListableURI, e error) {
			if e != nil {
				u.err(e)
				return
			}
			if uri == nil {
				return
			}
			path := uri.Path()
			u.run("Validating Git repository…", func(ctx context.Context) (func(), error) {
				root, e := connectors.Repository(ctx, path)
				if e != nil {
					return nil, e
				}
				if e = u.Store.SetRepository(root); e != nil {
					return nil, e
				}
				return func() { repo.SetText(root) }, nil
			})
		}, u.Window)
	})
	export := widget.NewButton("작업 맥락 저장", func() {
		if selected < 0 || selected >= len(issues) {
			u.err(errorf("select an issue"))
			return
		}
		chosen := []model.Page{}
		for _, p := range pages {
			for _, label := range refs.Selected {
				if label == p.ID+" · "+p.Title {
					chosen = append(chosen, p)
				}
			}
		}
		u.saveFile("context.md", []byte(connectors.Markdown(issues[selected], chosen)))
	})
	left := container.NewBorder(container.NewVBox(wrap("MY ISSUES · up to 50"), jql, search), nil, nil, nil, list)
	middle := container.NewBorder(header("요구사항", "Selected issue and source"), container.NewVBox(repo, container.NewHBox(repository, export)), nil, nil, detail)
	right := container.NewBorder(container.NewVBox(header("참고 자료", "Select related Confluence documents"), query, pageSearch, refs), nil, nil, nil, preview)
	split := container.NewHSplit(left, middle)
	split.Offset = .28
	all := container.NewHSplit(split, right)
	all.Offset = .76
	return container.NewBorder(header("업무에서 코드까지.", "MCP로 맥락을 모으고, 로컬에서 개발을 준비합니다. 처음에는 데모 자료가 표시됩니다."), nil, nil, nil, all)
}
