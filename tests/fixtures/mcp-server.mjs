import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const server = new McpServer({ name: "pino-test", version: "1.0.0" });
server.registerTool(
  "jira_search",
  {
    description: "Read Jira issues",
    inputSchema: { jql: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ jql }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          issues: [
            {
              key: "TEST-1",
              fields: {
                summary: jql,
                description: "Fixture requirement",
                status: { name: "Open" },
                priority: { name: "High" },
              },
            },
          ],
        }),
      },
    ],
  }),
);
server.registerTool(
  "confluence_search",
  { inputSchema: { query: z.string() }, annotations: { readOnlyHint: true } },
  async ({ query }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          results: [{ id: "42", title: query, text: "Fixture document" }],
        }),
      },
    ],
  }),
);
await server.connect(new StdioServerTransport());
