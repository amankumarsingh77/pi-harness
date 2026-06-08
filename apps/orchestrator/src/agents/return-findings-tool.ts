import { Type, type Static, type TSchema } from "typebox";

type ToolResult<T> = {
  readonly content: { readonly type: "text"; readonly text: string }[];
  readonly details: T;
};

type ToolLike<TParams extends TSchema, TDetails> = {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: TParams;
  readonly execute: (
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: never,
  ) => Promise<ToolResult<TDetails>>;
};

const ReturnFindingsParams = Type.Object({
  body: Type.String({ minLength: 1 }),
});

export type ReturnedFindingsState = {
  body: string | null;
};

export type ReturnFindingsDetails =
  | { readonly ok: true; readonly bytes: number }
  | { readonly ok: false; readonly error: string };

export function makeReturnFindingsTool(
  state: ReturnedFindingsState,
): ToolLike<typeof ReturnFindingsParams, ReturnFindingsDetails> {
  return {
    name: "return_findings",
    label: "Return findings",
    description:
      "Return your final markdown findings to the parent planner. Accepts a single `body` argument. This does not write a file.",
    parameters: ReturnFindingsParams,
    async execute(_id, params) {
      const body = params.body.trim();
      if (body.length === 0) {
        return {
          content: [{ type: "text", text: "findings body must not be empty" }],
          details: { ok: false, error: "findings body must not be empty" },
        };
      }
      state.body = body;
      return {
        content: [{ type: "text", text: `returned ${body.length} bytes of findings` }],
        details: { ok: true, bytes: body.length },
      };
    },
  };
}
