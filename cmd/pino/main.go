package main

import (
	"crypto/rand"
	"flag"
	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/app"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/widget"
	"github.com/pinomaker-hoo/pino-workbench/internal/ui"
	"github.com/pinomaker-hoo/pino-workbench/internal/vault"
	"image/png"
	"log"
	"os"
	"path/filepath"
	"time"
)

func main() {
	smoke := flag.String("smoke-output", "", "capture native window with isolated temporary settings, then exit")
	page := flag.String("smoke-page", "work", "work, api or settings (smoke mode only)")
	flag.Parse()
	a := app.NewWithID("dev.pino.workbench")
	var s *vault.Store
	var e error
	if *smoke != "" {
		dir, err := os.MkdirTemp("", "pino-native-smoke-")
		if err != nil {
			log.Fatal(err)
		}
		defer os.RemoveAll(dir)
		key := make([]byte, 32)
		if _, e = rand.Read(key); e != nil {
			log.Fatal(e)
		}
		s, e = vault.Open(filepath.Join(dir, "vault.enc"), key)
	} else {
		s, e = vault.OpenOS()
	}
	if e != nil {
		w := a.NewWindow("Pino Workbench · local storage")
		msg := widget.NewLabel(e.Error())
		msg.Wrapping = fyne.TextWrapWord
		w.SetContent(container.NewVBox(msg, widget.NewButton("Quit", a.Quit)))
		w.Resize(fyne.NewSize(640, 220))
		w.ShowAndRun()
		return
	}
	defer s.Close()
	u := ui.New(a, s)
	if *smoke != "" {
		u.ShowPage(*page)
	}
	if *smoke != "" {
		go func() {
			time.Sleep(3 * time.Second)
			fyne.Do(func() {
				f, e := os.Create(*smoke)
				if e != nil {
					log.Print(e)
				} else {
					e = png.Encode(f, u.Window.Canvas().Capture())
					_ = f.Close()
					if e != nil {
						log.Print(e)
					}
				}
				a.Quit()
			})
		}()
	}
	u.Window.ShowAndRun()
}
