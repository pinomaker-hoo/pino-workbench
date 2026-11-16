.PHONY: run build test vet package-mac
run:
	go run ./cmd/pino
build:
	go build -trimpath -o build/ ./cmd/pino
test:
	go test ./...
vet:
	go vet ./...
package-mac: build
	go run fyne.io/tools/cmd/fyne@v1.7.4 package --os darwin --exe build/pino --name "Pino Workbench" --app-id dev.pino.workbench --app-version 0.2.0 --icon assets/icon.png
