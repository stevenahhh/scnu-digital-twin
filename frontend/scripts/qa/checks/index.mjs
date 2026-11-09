// Registry of the 151 browser-side checks of DESIGN-AUDIT section 7, keyed by id.
// CHECKS: Map<id, { id, doc, states, viewports?, themes?, fixtures?, entries?, mutates?, aggregate?, run(ctx) }>
// `states` is a list of S01..S17 ids or a { D: [...], P: [...] } map; `fixtures` is "down" (default),
// "up" (S17 / fixtures-up runs), "delay" (--delay-ms runs) or "any".
import { GAP_CHECKS } from "./gap.mjs";
import { SLOP_UX_CHECKS } from "./slop-ux.mjs";
import { FRONTEND_CHECKS } from "./frontend.mjs";
import { VISUALQA_CHECKS } from "./visualqa.mjs";
import { REQUIRED_HOOKS } from "./common.mjs";
import { IDEAL_CHECKS } from "./ideal.mjs";

export { REQUIRED_HOOKS };
// The ideal-state rows IS-01..IS-40 (.omo/ui-hig-2026-11-09/audit/ideal-state.md section 6.2). Kept apart from CHECKS,
// which holds exactly the audit rows; lib/registry.mjs loads both.
export { IDEAL_CHECKS };

export const CHECKS = new Map([...GAP_CHECKS, ...SLOP_UX_CHECKS, ...FRONTEND_CHECKS, ...VISUALQA_CHECKS].map((check) => [check.id, check]));
