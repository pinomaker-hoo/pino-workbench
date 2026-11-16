import { z } from "zod";
import { readFile, writeFile, rename, unlink, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ApiScenario, ApiSaved, ApiRunResult } from "../src/api-types";
const dictionary = z.record(
  z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .max(100),
  z.string().max(50000),
);
export const scenarioSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    issueKey: z.string().max(100),
    steps: z
      .array(
        z.object({
          id: z.string().uuid(),
          name: z.string().trim().min(1).max(200),
          method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]),
          url: z.string().min(1).max(8000),
          headers: z.record(z.string().max(200), z.string().max(8000)),
          body: z.string().max(100000),
          expectedStatus: z.number().int().min(100).max(599),
          captures: dictionary,
          checks: z
            .array(z.object({ path: z.string().max(300), equals: z.json() }))
            .max(30),
        }),
      )
      .min(1)
      .max(30),
  })
  .superRefine((s, ctx) => {
    if (new Set(s.steps.map((x) => x.id)).size !== s.steps.length)
      ctx.addIssue({ code: "custom", message: "요청 ID가 중복됩니다." });
  });
const savedSchema = z
  .array(z.object({ scenario: scenarioSchema, variables: dictionary }))
  .max(100);
type Stored = z.infer<typeof savedSchema>[number];
interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
}
export class ScenarioStore {
  private entries: Stored[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private ready = false;
  constructor(
    readonly path: string,
    private cipher: Cipher,
  ) {}
  async load() {
    try {
      this.entries = savedSchema.parse(
        JSON.parse(this.cipher.decryptString(await readFile(this.path))),
      );
      this.ready = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        this.ready = true;
        return;
      }
      throw new Error("API 설정을 읽을 수 없습니다. 기존 파일은 보존했습니다.");
    }
  }
  list(): ApiSaved[] {
    this.ensure();
    return this.entries.map((x) => ({
      scenario: structuredClone(x.scenario),
      variableNames: Object.keys(x.variables),
    }));
  }
  get(id: string) {
    this.ensure();
    z.string().uuid().parse(id);
    const row = this.entries.find((x) => x.scenario.id === id);
    if (!row) throw new Error("먼저 시나리오를 저장하세요.");
    return structuredClone(row);
  }
  private ensure() {
    if (!this.ready) throw new Error("로컬 API 설정을 읽지 못했습니다.");
  }
  private mutate(update: () => Stored[]) {
    const task = this.queue.then(async () => {
      this.ensure();
      if (!this.cipher.isEncryptionAvailable())
        throw new Error("OS 암호화 저장소를 사용할 수 없습니다.");
      const next = savedSchema.parse(update());
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = this.path + ".tmp";
      try {
        await writeFile(tmp, this.cipher.encryptString(JSON.stringify(next)), {
          mode: 0o600,
        });
        await rename(tmp, this.path);
      } finally {
        await unlink(tmp).catch(() => {});
      }
      this.entries = next;
      return this.list();
    });
    this.queue = task.catch(() => {});
    return task;
  }
  save(input: unknown) {
    const { scenario, variables } = z
      .object({ scenario: scenarioSchema, variables: dictionary.optional() })
      .parse(input);
    return this.mutate(() => [
      ...this.entries.filter((x) => x.scenario.id !== scenario.id),
      {
        scenario,
        variables:
          variables ??
          this.entries.find((x) => x.scenario.id === scenario.id)?.variables ??
          {},
      },
    ]);
  }
  remove(id: string) {
    z.string().uuid().parse(id);
    return this.mutate(() => this.entries.filter((x) => x.scenario.id !== id));
  }
}
export function interpolate(value: string, variables: Record<string, string>) {
  return value.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_, key) => {
    if (!Object.hasOwn(variables, key))
      throw new Error(`변수 ${key} 값을 로컬에 설정하세요.`);
    return variables[key];
  });
}
export function jsonPath(body: unknown, path: string): unknown {
  let value: any = body;
  for (const key of path.split(".").filter(Boolean)) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new Error("지원하지 않는 JSON 경로입니다.");
    if (
      value === null ||
      typeof value !== "object" ||
      !Object.hasOwn(value, key)
    )
      throw new Error(`응답 경로 ${path}를 찾을 수 없습니다.`);
    value = value[key];
  }
  return value;
}
export function shareScenario(scenario: ApiScenario) {
  return {
    format: "pino-api-scenario",
    version: 1,
    scenario: scenarioSchema.parse(scenario),
  };
}
export function parseShared(input: unknown): ApiScenario {
  const data = z
    .object({
      format: z.literal("pino-api-scenario"),
      version: z.literal(1),
      scenario: scenarioSchema,
    })
    .strict()
    .parse(input);
  return {
    ...data.scenario,
    id: randomUUID(),
    steps: data.scenario.steps.map((s) => ({ ...s, id: randomUUID() })),
  };
}
const MAX_RESPONSE = 1024 * 1024;
function mask(text: string, values: Iterable<string>) {
  for (const value of [...values]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length))
    text = text.split(value).join("[local value]");
  return text;
}
export async function runScenario(
  scenario: ApiScenario,
  initial: Record<string, string>,
  signal: AbortSignal,
): Promise<ApiRunResult> {
  scenarioSchema.parse(scenario);
  const variables = Object.assign(Object.create(null), initial) as Record<
    string,
    string
  >;
  const sensitive = new Set(Object.values(initial));
  const steps: ApiRunResult["steps"] = [];
  for (const step of scenario.steps) {
    if (signal.aborted) break;
    const start = performance.now();
    let status: number | undefined;
    let body = "";
    try {
      const target = new URL(interpolate(step.url, variables));
      if (
        !["http:", "https:"].includes(target.protocol) ||
        target.username ||
        target.password
      )
        throw new Error(
          "HTTP/HTTPS 주소만 지원하며 URL 내 인증 정보는 허용하지 않습니다.",
        );
      const headers = Object.fromEntries(
        Object.entries(step.headers).map(([key, value]) => [
          key,
          interpolate(value, variables),
        ]),
      );
      const bodyValue = interpolate(step.body, variables);
      if (["GET", "HEAD"].includes(step.method) && bodyValue)
        throw new Error("GET/HEAD 요청에는 본문을 사용할 수 없습니다.");
      const response = await fetch(target, {
        method: step.method,
        headers,
        body: bodyValue || undefined,
        redirect: "manual",
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      });
      status = response.status;
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > MAX_RESPONSE) {
            await reader.cancel();
            throw new Error("응답 크기가 1MB를 초과했습니다.");
          }
          chunks.push(part.value);
        }
      }
      body = Buffer.concat(chunks).toString("utf8");
      let parsed: unknown;
      if (step.checks.length || Object.keys(step.captures).length) {
        try {
          parsed = JSON.parse(body);
        } catch {
          throw new Error(
            "응답이 JSON이 아니어서 검증/변수 추출을 할 수 없습니다.",
          );
        }
      }
      // Extract values for masking even if a later assertion fails. Never return captured values separately.
      const captured: Record<string, string> = Object.create(null);
      for (const [key, path] of Object.entries(step.captures)) {
        const value = jsonPath(parsed, path);
        if (!["string", "number", "boolean"].includes(typeof value))
          throw new Error(
            `추출 변수 ${key}는 문자열·숫자·불리언이어야 합니다.`,
          );
        captured[key] = String(value);
        sensitive.add(String(value));
      }
      if (status !== step.expectedStatus)
        throw new Error(
          `예상 상태 ${step.expectedStatus}, 실제 상태 ${status}`,
        );
      for (const check of step.checks)
        if (!isDeepStrictEqual(jsonPath(parsed, check.path), check.equals))
          throw new Error(`응답 경로 ${check.path}의 값이 예상과 다릅니다.`);
      Object.assign(variables, captured);
      steps.push({
        id: step.id,
        name: step.name,
        status,
        durationMs: Math.round(performance.now() - start),
        passed: true,
        body: mask(body, sensitive),
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      const safe =
        /^(변수 |HTTP\/HTTPS|GET\/HEAD|응답 |추출 변수 |예상 상태 |지원하지 않는 JSON)/.test(
          raw,
        )
          ? raw
          : signal.aborted
            ? "실행을 중단했습니다. 이미 전송한 요청은 되돌리지 않습니다."
            : "요청 실패 또는 15초 시간 초과. 주소·인증·서버를 확인하세요.";
      steps.push({
        id: step.id,
        name: step.name,
        status,
        durationMs: Math.round(performance.now() - start),
        passed: false,
        body: mask(body, sensitive),
        error: mask(safe, sensitive),
      });
      break;
    }
  }
  return {
    steps,
    passed:
      steps.length === scenario.steps.length && steps.every((s) => s.passed),
    cancelled: signal.aborted,
  };
}
