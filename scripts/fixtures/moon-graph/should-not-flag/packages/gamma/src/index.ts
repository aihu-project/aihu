// A registry range must not pull the same-named local project into Moon's
// build graph. This models the compiler extraction cutover.
import { beta } from '@fixture/beta'

export const gamma = `gamma:${beta}`
