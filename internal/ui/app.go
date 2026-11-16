package ui

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/dialog"
	"fyne.io/fyne/v2/layout"
	"fyne.io/fyne/v2/theme"
	"fyne.io/fyne/v2/widget"
	"github.com/pinomaker-hoo/pino-workbench/assets"
	"github.com/pinomaker-hoo/pino-workbench/internal/vault"
	"image/color"
	"io"
	"strings"
)

type pineTheme struct{}

var font = fyne.NewStaticResource("NotoSansKR-Regular.otf", assets.Font)

func (pineTheme) Font(s fyne.TextStyle) fyne.Resource {
	if s.Bold {
		return fyne.NewStaticResource("NotoSansKR-Bold.otf", assets.BoldFont)
	}
	return font
}
func (pineTheme) Icon(n fyne.ThemeIconName) fyne.Resource { return theme.DefaultTheme().Icon(n) }
func (pineTheme) Size(n fyne.ThemeSizeName) float32       { return theme.DefaultTheme().Size(n) }
func (pineTheme) Color(n fyne.ThemeColorName, v fyne.ThemeVariant) color.Color {
	switch n {
	case theme.ColorNameBackground:
		return color.NRGBA{18, 25, 21, 255}
	case theme.ColorNameInputBackground:
		return color.NRGBA{24, 34, 28, 255}
	case theme.ColorNamePrimary:
		return color.NRGBA{177, 205, 144, 255}
	case theme.ColorNameDisabled:
		return color.NRGBA{160, 173, 153, 255}
	case theme.ColorNameForeground:
		return color.NRGBA{222, 230, 216, 255}
	case theme.ColorNameButton:
		return color.NRGBA{40, 54, 43, 255}
	case theme.ColorNameSelection:
		return color.NRGBA{65, 86, 54, 255}
	}
	return theme.DefaultTheme().Color(n, theme.VariantDark)
}

type App struct {
	Window       fyne.Window
	Store        *vault.Store
	root         *fyne.Container
	status       *widget.Label
	cancelButton *widget.Button
	cancel       context.CancelFunc
	busy         bool
	IssueKey     string
	apiIssue     *widget.Entry
	navigate     func(string)
}

func New(a fyne.App, s *vault.Store) *App {
	a.Settings().SetTheme(pineTheme{})
	w := a.NewWindow("Pino Workbench")
	w.Resize(fyne.NewSize(1360, 900))
	w.SetIcon(fyne.NewStaticResource("icon.png", assets.Icon))
	u := &App{Window: w, Store: s, status: widget.NewLabel("Local workspace · Go + Fyne")}
	u.cancelButton = widget.NewButtonWithIcon("Stop", theme.MediaStopIcon(), func() {
		if u.cancel != nil {
			u.cancel()
			u.status.SetText("Stopping… already sent requests are not rolled back")
		}
	})
	u.cancelButton.Disable()
	work := u.workPage()
	api := u.apiPage()
	settings := u.settingsPage()
	content := container.NewStack(work)
	title := widget.NewLabelWithStyle("WORKSPACE / 업무 공간", fyne.TextAlignLeading, fyne.TextStyle{Bold: true})
	u.navigate = func(page string) {
		switch page {
		case "api":
			title.SetText("WORKSPACE / API 시나리오")
			content.Objects = []fyne.CanvasObject{api}
		case "settings":
			title.SetText("LOCAL CONNECTIONS / 서비스 연결")
			content.Objects = []fyne.CanvasObject{settings}
		default:
			title.SetText("WORKSPACE / 업무 공간")
			content.Objects = []fyne.CanvasObject{work}
		}
		content.Refresh()
	}
	logo := canvas.NewImageFromResource(fyne.NewStaticResource("icon.png", assets.Icon))
	logo.FillMode = canvas.ImageFillContain
	logo.SetMinSize(fyne.NewSize(90, 90))
	sidebar := container.NewVBox(logo, widget.NewLabelWithStyle("Pino Workbench", fyne.TextAlignCenter, fyne.TextStyle{Bold: true}), widget.NewLabel("LOCAL · NATIVE · OPEN"), widget.NewSeparator(), widget.NewButtonWithIcon("업무 공간", theme.HomeIcon(), func() {
		title.SetText("WORKSPACE / 업무 공간")
		content.Objects = []fyne.CanvasObject{work}
		content.Refresh()
	}), widget.NewButtonWithIcon("API 시나리오", theme.MediaPlayIcon(), func() {
		title.SetText("WORKSPACE / API 시나리오")
		content.Objects = []fyne.CanvasObject{api}
		content.Refresh()
	}), widget.NewButtonWithIcon("서비스 연결", theme.SettingsIcon(), func() {
		title.SetText("LOCAL CONNECTIONS / 서비스 연결")
		content.Objects = []fyne.CanvasObject{settings}
		content.Refresh()
	}), widget.NewSeparator(), wrap("Jira · Confluence\nGitHub · Notion · Google\nClaude · Codex"), layout.NewSpacer(), wrap("v0.2.0\nNo browser. No WebView.\n설정은 이 컴퓨터에 저장됩니다."))
	side := container.NewBorder(nil, nil, nil, nil, sidebar)
	side.Resize(fyne.NewSize(210, 800))
	split := container.NewHSplit(container.NewPadded(side), container.NewBorder(container.NewVBox(title, widget.NewSeparator()), nil, nil, nil, container.NewPadded(content)))
	split.Offset = .17
	u.root = container.NewStack(split)
	w.SetContent(container.NewBorder(nil, container.NewBorder(nil, nil, nil, u.cancelButton, u.status), nil, nil, u.root))
	w.SetCloseIntercept(func() {
		if u.cancel != nil {
			u.cancel()
		}
		w.SetCloseIntercept(nil)
		w.Close()
	})
	return u
}
func wrap(s string) *widget.Label      { w := widget.NewLabel(s); w.Wrapping = fyne.TextWrapWord; return w }
func entry(value string) *widget.Entry { e := widget.NewEntry(); e.SetText(value); return e }
func multi(value string, rows int) *widget.Entry {
	e := widget.NewMultiLineEntry()
	e.Wrapping = fyne.TextWrapWord
	e.SetMinRowsVisible(rows)
	e.SetText(value)
	return e
}
func pretty(v any) string { b, _ := json.MarshalIndent(v, "", "  "); return string(b) }
func decode(s string, v any) error {
	d := json.NewDecoder(strings.NewReader(s))
	if e := d.Decode(v); e != nil {
		return errors.New("invalid JSON; check the expected object or array")
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return errors.New("only one JSON value is allowed")
	}
	return nil
}
func (u *App) err(e error) {
	if e != nil {
		dialog.ShowError(e, u.Window)
	}
}
func (u *App) run(label string, task func(context.Context) (func(), error)) {
	if u.busy {
		return
	}
	u.busy = true
	ctx, cancel := context.WithCancel(context.Background())
	u.cancel = cancel
	u.status.SetText(label)
	u.cancelButton.Enable()
	// Freeze editable widgets while a snapshot is processed. Stop remains available.
	disabled := []fyne.Disableable{}
	var visit func(fyne.CanvasObject)
	visit = func(o fyne.CanvasObject) {
		if d, ok := o.(fyne.Disableable); ok && !d.Disabled() {
			d.Disable()
			disabled = append(disabled, d)
		}
		switch c := o.(type) {
		case *fyne.Container:
			for _, child := range c.Objects {
				visit(child)
			}
		case *container.Scroll:
			visit(c.Content)
		case *container.Split:
			visit(c.Leading)
			visit(c.Trailing)
		}
	}
	visit(u.root)
	go func() {
		done, e := task(ctx)
		fyne.Do(func() {
			cancel()
			u.cancel = nil
			u.busy = false
			for _, d := range disabled {
				d.Enable()
			}
			u.cancelButton.Disable()
			if e != nil {
				u.status.SetText("Operation failed")
				u.err(e)
			} else {
				u.status.SetText("Ready · local workspace")
				if done != nil {
					done()
				}
			}
		})
	}()
}
func (u *App) saveFile(name string, data []byte) {
	d := dialog.NewFileSave(func(w fyne.URIWriteCloser, e error) {
		if e != nil {
			u.err(e)
			return
		}
		if w == nil {
			return
		}
		_, e = w.Write(data)
		closeErr := w.Close()
		if e == nil {
			e = closeErr
		}
		if e != nil {
			u.err(e)
		} else {
			u.status.SetText("Saved: " + w.URI().Path())
		}
	}, u.Window)
	d.SetFileName(name)
	d.Show()
}
func (u *App) confirm(message string, action func()) {
	dialog.ShowConfirm("Pino Workbench", message, func(ok bool) {
		if ok {
			action()
		}
	}, u.Window)
}
func header(title, subtitle string) fyne.CanvasObject {
	return container.NewVBox(widget.NewLabelWithStyle(title, fyne.TextAlignLeading, fyne.TextStyle{Bold: true}), wrap(subtitle), widget.NewSeparator())
}
func formEntry(label string, o fyne.CanvasObject) fyne.CanvasObject {
	return container.NewVBox(widget.NewLabel(label), o)
}
func errorf(format string, a ...any) error { return fmt.Errorf(format, a...) }

func (u *App) ShowPage(page string) {
	if !u.busy {
		u.navigate(page)
	}
}
