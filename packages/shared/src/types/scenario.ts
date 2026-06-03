// A scenario is a textual brief consumed by the verifier agent. `type` is a
// free-string arena hint (ui | api | db | cli | ...); `description` carries the
// instruction and the acceptance criterion in prose. See schemas/scenario.ts.
export type Scenario = {
  id: string;
  type: string;
  name: string;
  description: string;
  requirementRefs?: string[] | undefined;
  blastRadiusRefs?: string[] | undefined;
};

export type ScenarioFile = { scenarios: Scenario[] };
