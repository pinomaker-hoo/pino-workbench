import { z } from "zod";
import { readFile, writeFile, rename, unlink, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Profile, ProfileInput, PublicProfile } from "../src/shared";
export const serviceSchema = z.enum([
  "jira",
  "confluence",
  "github",
  "notion",
  "google",
  "claude",
  "codex",
]);
const record = z.record(z.string().min(1).max(128), z.string().max(16000));
function validEndpoint(value: string) {
  try {
    const u = new URL(value);
    return (
      !u.username &&
      !u.password &&
      !u.hash &&
      (u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
    );
  } catch {
    return false;
  }
}
export const profileSchema = z
  .object({
    id: serviceSchema,
    transport: z.enum(["stdio", "http", "cli"]),
    endpoint: z.string().max(4000),
    command: z.string().max(4000),
    args: z.array(z.string().max(4000)).max(100),
    tool: z.string().max(200),
    arguments: z.record(z.string(), z.unknown()),
    resultPath: z.string().max(200),
    baseUrl: z.string().max(4000),
  })
  .superRefine((p, ctx) => {
    if (p.transport === "http" && !validEndpoint(p.endpoint))
      ctx.addIssue({
        code: "custom",
        message: "MCP 주소는 HTTPS 또는 localhost HTTP 주소여야 합니다.",
      });
    if (p.transport !== "http" && !p.command.trim())
      ctx.addIssue({
        code: "custom",
        message: "실행 파일 또는 명령을 입력하세요.",
      });
    if (["claude", "codex"].includes(p.id) !== (p.transport === "cli"))
      ctx.addIssue({
        code: "custom",
        message: "AI는 CLI 설정, 서비스는 MCP 연결을 사용하세요.",
      });
    if (p.baseUrl && !validEndpoint(p.baseUrl))
      ctx.addIssue({
        code: "custom",
        message: "원문 기본 주소는 HTTPS 또는 localhost HTTP 주소여야 합니다.",
      });
  });
export const profileInputSchema = z.object({
  profile: profileSchema,
  secrets: record.optional(),
});
export type StoredProfile = Profile & { secrets: Record<string, string> };
interface Cipher {
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  isEncryptionAvailable(): boolean;
}
export class ProfileStore {
  private profiles: StoredProfile[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly path: string,
    private cipher: Cipher,
  ) {}
  async load() {
    let data: Buffer;
    try {
      data = await readFile(this.path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new Error("로컬 연결 설정을 읽을 수 없습니다.");
    }
    try {
      this.profiles = z
        .array(z.object({ profile: profileSchema, secrets: record }))
        .max(7)
        .parse(JSON.parse(this.cipher.decryptString(data)))
        .map(({ profile, secrets }) => ({ ...profile, secrets }));
    } catch {
      throw new Error(
        "로컬 연결 설정을 복호화할 수 없습니다. 기존 파일은 보존되었습니다.",
      );
    }
  }
  public(): PublicProfile[] {
    return this.profiles.map(({ secrets, ...p }) => ({
      ...p,
      secretKeys: Object.keys(secrets),
    }));
  }
  get(id: string) {
    const p = this.profiles.find((p) => p.id === id);
    if (!p) throw new Error("먼저 이 서비스의 연결 설정을 저장하세요.");
    return structuredClone(p);
  }
  private mutate(fn: () => StoredProfile[]) {
    const task = this.queue.then(async () => {
      if (!this.cipher.isEncryptionAvailable())
        throw new Error(
          "운영체제의 안전한 암호화 저장소를 사용할 수 없습니다.",
        );
      const next = fn();
      const encoded = this.cipher.encryptString(
        JSON.stringify(
          next.map(({ secrets, ...profile }) => ({ profile, secrets })),
        ),
      );
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = this.path + ".tmp";
      try {
        await writeFile(temporary, encoded, { mode: 0o600 });
        await rename(temporary, this.path);
      } finally {
        await unlink(temporary).catch(() => {});
      }
      this.profiles = next;
    });
    this.queue = task.catch(() => {});
    return task;
  }
  save(raw: ProfileInput) {
    const { profile, secrets } = profileInputSchema.parse(raw);
    return this.mutate(() => {
      const old = this.profiles.find((p) => p.id === profile.id);
      const changedDestination =
        old &&
        (old.transport !== profile.transport ||
          old.endpoint !== profile.endpoint ||
          old.command !== profile.command ||
          JSON.stringify(old.args) !== JSON.stringify(profile.args));
      if (
        changedDestination &&
        secrets === undefined &&
        Object.keys(old.secrets).length
      )
        throw new Error(
          "서버 주소나 실행 명령을 변경하면 인증 값을 다시 입력하세요. 비우려면 {}를 입력하세요.",
        );
      return [
        ...this.profiles.filter((p) => p.id !== profile.id),
        { ...profile, secrets: secrets ?? old?.secrets ?? {} },
      ];
    });
  }
  delete(id: string) {
    serviceSchema.parse(id);
    return this.mutate(() => this.profiles.filter((p) => p.id !== id));
  }
}
