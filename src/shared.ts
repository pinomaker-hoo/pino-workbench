import type { ApiBridge } from "./api-types";
export interface Issue {
  key: string;
  title: string;
  status: string;
  priority: string;
  assignee: string;
  description: string;
  url: string;
}
export interface Page {
  id: string;
  title: string;
  text: string;
  url: string;
}
export interface Bridge {
  api: ApiBridge;
  settings(): Promise<LocalSettings>;
  saveProfile(input: ProfileInput): Promise<LocalSettings>;
  deleteProfile(id: Service): Promise<LocalSettings>;
  testProfile(id: Service): Promise<ToolInfo[]>;
  issues(jql: string): Promise<Issue[]>;
  pages(title: string): Promise<Page[]>;
  repository(): Promise<string | null>;
  exportContext(input: { issue: Issue; pages: Page[] }): Promise<string>;
}
declare global {
  interface Window {
    pino: Bridge;
  }
}

export type Service =
  "jira" | "confluence" | "github" | "notion" | "google" | "claude" | "codex";
export interface Profile {
  id: Service;
  transport: "stdio" | "http" | "cli";
  endpoint: string;
  command: string;
  args: string[];
  tool: string;
  arguments: Record<string, unknown>;
  resultPath: string;
  baseUrl: string;
}
export interface PublicProfile extends Profile {
  secretKeys: string[];
}
export interface ProfileInput {
  profile: Profile;
  secrets?: Record<string, string>;
}
export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}
export interface LocalSettings {
  profiles: PublicProfile[];
  storagePath: string;
}
