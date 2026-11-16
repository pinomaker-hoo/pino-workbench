package connectors

import (
	"context"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/pinomaker-hoo/pino-workbench/internal/model"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
)

type queryInput struct {
	Query string `json:"query"`
}

func fixtureServer() *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{Name: "fixture", Version: "1"}, nil)
	mcp.AddTool(s, &mcp.Tool{Name: "search", Description: "Read-only search"}, func(ctx context.Context, r *mcp.CallToolRequest, in queryInput) (*mcp.CallToolResult, any, error) {
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: `{"issues":[{"key":"TEST-1","fields":{"summary":"Found issue","description":{"type":"doc","content":[{"type":"paragraph","content":[{"text":"Requirement"}]}]}}}]}`}}}, nil, nil
	})
	return s
}
func TestMCPHTTP(t *testing.T) {
	var auth atomic.Int32
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return fixtureServer() }, nil)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture-token" {
			t.Error("missing auth")
		}
		auth.Add(1)
		handler.ServeHTTP(w, r)
	}))
	defer srv.Close()
	p := model.Profile{ID: "jira", Transport: "http", Endpoint: srv.URL, Secrets: map[string]string{"Authorization": "Bearer fixture-token"}, Tool: "search", Arguments: map[string]any{"query": "{{query}}"}, ResultPath: "issues", BaseURL: "https://jira.test"}
	tools, e := Discover(context.Background(), p)
	if e != nil || len(tools) != 1 {
		t.Fatal(tools, e)
	}
	rows, e := Search(context.Background(), p, "test")
	if e != nil {
		t.Fatal(e)
	}
	i, e := Issue(rows[0], p.BaseURL)
	if e != nil || i.Key != "TEST-1" || !strings.Contains(i.Description, "Requirement") {
		t.Fatal(i, e)
	}
	if auth.Load() == 0 {
		t.Fatal("no request")
	}
}
func TestMCPStdio(t *testing.T) {
	if os.Getenv("PINO_MCP_FIXTURE") == "1" {
		_ = fixtureServer().Run(context.Background(), &mcp.StdioTransport{})
		os.Exit(0)
	}
	exe, e := os.Executable()
	if e != nil {
		t.Fatal(e)
	}
	p := model.Profile{ID: "jira", Transport: "stdio", Command: exe, Args: []string{"-test.run=^TestMCPStdio$"}, Secrets: map[string]string{"PINO_MCP_FIXTURE": "1"}, Tool: "search", Arguments: map[string]any{"query": "{{query}}"}, ResultPath: "issues"}
	tools, e := Discover(context.Background(), p)
	if e != nil || len(tools) != 1 {
		t.Fatal(tools, e)
	}
	rows, e := Search(context.Background(), p, "hello")
	if e != nil || len(rows) != 1 {
		t.Fatal(rows, e)
	}
}
func TestArgumentsAndMarkdown(t *testing.T) {
	v := arguments(map[string]any{"q": "{{query}}", "limit": float64(10)}, `a"b`).(map[string]any)
	if v["q"] != `a"b` || v["limit"] != float64(10) {
		t.Fatal(v)
	}
	text := Markdown(model.Issue{Key: "TEST-1", Title: "Title", URL: "https://jira.test/browse/TEST-1"}, []model.Page{{Title: "Doc", Text: "Context", URL: "https://docs.test/1"}})
	if !strings.Contains(text, "not agent instructions") || !strings.Contains(text, "https://docs.test/1") {
		t.Fatal(text)
	}
}
