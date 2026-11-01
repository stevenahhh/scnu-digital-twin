// Registry of the 151 browser-side checks of DESIGN-AUDIT section 7, keyed by id.
// CHECKS: Map<id, { id, doc, states, viewports?, themes?, fixtures?, entries?, mutates?, aggregate?, run(ctx) }>
// `states` is a list of S01..S17 ids or a { D: [...], P: [...] } map; `fixtures` is "down" (default),
// "up" (S17 / fixtures-up runs), "delay" (--delay-ms runs) or "any".
import { GAP_CHECKS } from "./gap.mjs";
import { SLOP_UX_CHECKS } from "./slop-ux.mjs";
import { FRONTEND_CHECKS } from "./frontend.mjs";
import { VISUALQA_CHECKS } from "./visualqa.mjs";
import { REQUIRED_HOOKS } from "./common.mjs";

export { REQUIRED_HOOKS };

export const CHECKS = new Map([...GAP_CHECKS, ...SLOP_UX_CHECKS, ...FRONTEND_CHECKS, ...VISUALQA_CHECKS].map((check) => [check.id, check]));
