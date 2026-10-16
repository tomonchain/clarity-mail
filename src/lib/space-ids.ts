import { SEED_SPACES } from "./seed";

/** Prerendered inbox routes. Spaces created later are rendered on demand. */
export const PRERENDERED_SPACE_IDS = ["all", ...SEED_SPACES.map((s) => s.id)];
