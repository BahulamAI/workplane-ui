import { describe, expect, it } from "vitest";
import { LocalAuthority, MemoryStorage } from "@bahulam/workplane-ui";
import {
  createDemoDocument,
  DEMO_DOCUMENT_ID,
  DEMO_POLICY,
  runGatewayConformance,
  type ConformanceReport,
} from "@bahulam/workplane-ui/testkit";

function report(r: ConformanceReport): string {
  return r.checks
    .filter((c) => c.status === "fail")
    .map((c) => `  ${c.id} (${c.requirement}): ${c.detail}`)
    .join("\n");
}

describe("CommandGateway conformance", () => {
  it("LocalAuthority passes every check", async () => {
    const result = await runGatewayConformance("LocalAuthority", async () => ({
      gateway: new LocalAuthority({
        storage: new MemoryStorage(createDemoDocument()),
        policy: DEMO_POLICY,
      }),
      documentId: DEMO_DOCUMENT_ID,
    }));

    expect(report(result), `\n${report(result)}`).toBe("");
    expect(result.failed).toBe(0);
    expect(result.passed).toBeGreaterThanOrEqual(14);
  });

  it("detects a gateway that silently swallows a stale revision", async () => {
    // Guards the suite itself: a deliberately broken gateway must FAIL, or the
    // suite is decorative rather than a contract.
    class IgnoresRevision extends LocalAuthority {
      override async commit(transaction: never, actor: never) {
        const current = await this.snapshot(DEMO_DOCUMENT_ID);
        return super.commit({ ...(transaction as object), expectedRevision: current?.revision ?? 0 } as never, actor);
      }
    }
    const result = await runGatewayConformance("IgnoresRevision", async () => ({
      gateway: new IgnoresRevision({
        storage: new MemoryStorage(createDemoDocument()),
        policy: DEMO_POLICY,
      }),
      documentId: DEMO_DOCUMENT_ID,
    }));
    expect(result.failed).toBeGreaterThan(0);
    expect(result.checks.find((c) => c.id === "stale-revision-conflicts")?.status).toBe("fail");
  });
});
