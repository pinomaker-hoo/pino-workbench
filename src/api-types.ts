export interface ApiStep {
  id: string;
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  url: string;
  headers: Record<string, string>;
  body: string;
  expectedStatus: number;
  captures: Record<string, string>;
  checks: { path: string; equals: unknown }[];
}
export interface ApiScenario {
  id: string;
  name: string;
  issueKey: string;
  steps: ApiStep[];
}
export interface ApiSaved {
  scenario: ApiScenario;
  variableNames: string[];
}
export interface ApiStepResult {
  id: string;
  name: string;
  status?: number;
  durationMs: number;
  passed: boolean;
  body: string;
  error?: string;
}
export interface ApiRunResult {
  steps: ApiStepResult[];
  passed: boolean;
  cancelled: boolean;
}
export interface ApiBridge {
  list(): Promise<ApiSaved[]>;
  save(input: {
    scenario: ApiScenario;
    variables?: Record<string, string>;
  }): Promise<ApiSaved[]>;
  remove(id: string): Promise<ApiSaved[]>;
  run(id: string): Promise<ApiRunResult>;
  cancel(): Promise<void>;
  export(id: string): Promise<string>;
  import(): Promise<ApiSaved | null>;
}
