import { describe, expect, it } from "vitest";
import { PHASES, type Phase } from "../types/run.js";
import {
  DEFAULT_PHASE_MODELS,
  THINKING_LEVELS,
  mergePhaseModels,
  type PhaseModelConfig,
} from "./phase-models.js";

describe("DEFAULT_PHASE_MODELS", () => {
  it("has an entry for every Phase", () => {
    for (const phase of PHASES) {
      const cfg = DEFAULT_PHASE_MODELS[phase];
      expect(cfg, `missing default for phase: ${phase}`).toBeDefined();
      expect(cfg.provider.length).toBeGreaterThan(0);
      expect(cfg.model.length).toBeGreaterThan(0);
      expect(THINKING_LEVELS).toContain(cfg.thinkingLevel);
      expect(cfg.maxTurns).toBeGreaterThan(0);
    }
  });
});

describe("mergePhaseModels", () => {
  it("returns the default when overrides is empty", () => {
    expect(mergePhaseModels({}, "brainstorm")).toEqual(DEFAULT_PHASE_MODELS.brainstorm);
  });

  it("returns the default when the phase has no override entry", () => {
    expect(
      mergePhaseModels({ plan: { thinkingLevel: "off" } }, "brainstorm"),
    ).toEqual(DEFAULT_PHASE_MODELS.brainstorm);
  });

  it("merges a partial override field-by-field with the default", () => {
    const merged = mergePhaseModels(
      { brainstorm: { thinkingLevel: "high" } },
      "brainstorm",
    );
    const expected: PhaseModelConfig = {
      ...DEFAULT_PHASE_MODELS.brainstorm,
      thinkingLevel: "high",
    };
    expect(merged).toEqual(expected);
  });

  it("allows overriding every field at once", () => {
    const override: PhaseModelConfig = {
      provider: "openai",
      model: "gpt-x",
      thinkingLevel: "off",
      maxTurns: 99,
    };
    expect(mergePhaseModels({ brainstorm: override }, "brainstorm")).toEqual(override);
  });

  it("does not mutate the input overrides object", () => {
    const overrides: Partial<Record<Phase, Partial<PhaseModelConfig>>> = {
      brainstorm: { maxTurns: 7 },
    };
    const snapshot = JSON.stringify(overrides);
    mergePhaseModels(overrides, "brainstorm");
    expect(JSON.stringify(overrides)).toEqual(snapshot);
  });
});
