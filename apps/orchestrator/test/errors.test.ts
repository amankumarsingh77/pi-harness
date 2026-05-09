import { describe, it, expect } from "vitest";
import {
  HarnessError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
  isHarnessError,
} from "../src/domain/errors.js";

describe("HarnessError", () => {
  it("InvalidTransitionError carries from + to + reason", () => {
    const err = new InvalidTransitionError("backlog", "verifying", "no plan");
    expect(err.status).toBe(409);
    expect(err.code).toBe("invalid_transition");
    expect(err.message).toContain("backlog");
    expect(err.message).toContain("verifying");
  });

  it("NotFoundError is 404", () => {
    expect(new NotFoundError("task", "42").status).toBe(404);
  });

  it("ValidationError is 400", () => {
    expect(new ValidationError("bad payload").status).toBe(400);
  });

  it("isHarnessError narrows", () => {
    const e: unknown = new ValidationError("x");
    if (isHarnessError(e)) {
      expect(e.status).toBe(400);
    } else {
      throw new Error("should narrow");
    }
  });
});
