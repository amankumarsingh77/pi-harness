import { describe, it, expect } from "vitest";
import type { Scenario } from "@pi-harness/shared";
import {
  runApiScenario,
  runUiScenario,
  runUiVisualScenario,
} from "../../src/agents/verify-runner.js";

// The deterministic runners were retired when scenarios became textual briefs.
// Until the agentic verifier lands, every runner returns ok:false with an
// explicit reason — never a false pass. See TODO(agentic-verify) in the source.
const scenario: Scenario = {
  id: "S-001",
  type: "ui",
  name: "filter dropdown closes",
  description: "Open the filter dropdown, click outside, verify it is dismissed.",
};

describe("verify-runner stubs (agentic verifier pending)", () => {
  for (const [label, run] of [
    ["runApiScenario", runApiScenario],
    ["runUiScenario", runUiScenario],
    ["runUiVisualScenario", runUiVisualScenario],
  ] as const) {
    it(`${label} reports ok:false with a not-implemented reason`, async () => {
      const result = await run({ scenario, proofDir: "/tmp/unused" });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not yet implemented/i);
      expect(result.id).toBe("S-001");
    });
  }
});
