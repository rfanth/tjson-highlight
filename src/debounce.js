// How long to wait after a keystroke before doing whole-document work.
//
// Both the diagnostics and the preview re-run over the whole document on a
// change, and both are synchronous wasm on the extension host. The wait is
// therefore not a matter of taste: it is what keeps a large document from
// arriving at the rate of a small one. One flat interval cannot serve both
// ends of that. 500ms read as lag on a file where the check costs under a
// millisecond, and on a 40MB one it started a second pass before the first had
// finished, so the pane spent its life rendering a version already moved past.
//
// Paced by what the work actually took, rather than by a size estimate.
// Conversion cost is close enough to linear in document size that a constant
// like "31ms per megabyte" would fit today's measurements -- but it would be
// measured on one machine, against one build of the parser, and it would be
// wrong on a slower laptop, wrong after the parser gets faster, and wrong for
// a document whose shape converts at a different rate per byte. The work
// reports its own duration for free; nothing has to be assumed about it.
//
// Rise fast, fall slow. A sample slower than the current estimate is adopted
// at once, because the cost of underestimating is thrash -- passes stacking on
// each other. A faster sample is eased into, so one lucky run does not undo
// the backoff. Nothing here needs the editor, which keeps it testable with
// plain numbers.

/** Short enough to read as immediate on a document where the work is free. */
const FLOOR_MS = 120;

/**
 * Long enough that nobody concludes it has stopped working.
 *
 * A preference, not a guarantee: MAX_DUTY_CYCLE outranks it. Capping the wait
 * is only sound while the work is short enough for the cap to leave idle time
 * either side of it, and on a slow machine it is not.
 */
const CEILING_MS = 3000;

/** Wait this many times the observed cost, leaving the host mostly idle. */
const MULTIPLIER = 8;

/**
 * The most of the extension host's time this work may occupy.
 *
 * The real constraint, and the reason the ceiling can be overruled. The
 * extension host is one thread shared with every other extension, so a
 * synchronous conversion running there is time nothing else gets -- felt as
 * lag in windows that have nothing to do with TJSON.
 *
 * MULTIPLIER already implies a duty cycle of 1/(8+1), about 11%, and on any
 * machine where the work is quick that is what happens. This is the backstop
 * for when it is not: a check costing 5s against a 3s ceiling would run 62% of
 * the time, and the slower the computer the worse it would get -- the ceiling
 * would bite hardest exactly where there is least to spare. Holding the duty
 * cycle instead means a slow machine waits longer, which is the correct answer
 * and the opposite of what a fixed cap does.
 */
const MAX_DUTY_CYCLE = 0.25;

/** How much of a faster sample to take on, when easing back down. */
const DECAY = 0.2;

/**
 * What to wait before anything has been measured.
 *
 * Deliberately the slow end. In practice this is rarely reached -- a document
 * is checked when it opens, so by the time anyone types there is a real
 * measurement -- and where it is reached, the document is by definition one
 * nothing is known about.
 */
const UNMEASURED_MS = CEILING_MS;

/**
 * A record of what this kind of work has been costing, per document.
 *
 * One pacer per kind rather than one shared: rendering a reformat preview
 * costs about twice what checking the same document does, and pooling those
 * would pace each by the other's work.
 */
function createPacer() {
  const observed = new Map();

  return {
    /** How long to wait before re-running, given what it cost last time. */
    delayFor(key) {
      const cost = observed.get(key);
      if (cost === undefined) {
        // Nothing measured yet, so guess high and come down. An unmeasured
        // document is not a small one -- it is one of unknown size, and the
        // asymmetry is severe: guessing low on a 40MB file starts a pass every
        // 120ms and stacks them, while guessing high on a small file costs one
        // slow response before the first measurement corrects it. Note that
        // the guess is not recorded, so that correction is immediate: the
        // first real sample is adopted outright rather than eased toward.
        return UNMEASURED_MS;
      }

      // Waiting `cost * (1 - d) / d` leaves the work at exactly d of the
      // cycle. The ceiling applies only while it is the longer of the two, so
      // it shortens a wait that was going to be generous and never one that
      // was holding the load down.
      const forDutyCycle = cost * ((1 - MAX_DUTY_CYCLE) / MAX_DUTY_CYCLE);
      const preferred = Math.min(cost * MULTIPLIER, Math.max(CEILING_MS, forDutyCycle));
      return Math.round(Math.max(preferred, FLOOR_MS));
    },

    /** Run the work, and pace future runs by how long it took. */
    measure(key, work) {
      const started = Date.now();
      try {
        return work();
      } finally {
        const sample = Date.now() - started;
        const previous = observed.get(key);
        observed.set(
          key,
          previous === undefined || sample > previous
            ? sample
            : previous + (sample - previous) * DECAY
        );
      }
    },

    /** Drop a document's history when it closes, so this cannot grow forever. */
    forget(key) {
      observed.delete(key);
    },

    /** For tests and diagnostics: what this document has been costing. */
    costFor(key) {
      return observed.get(key);
    },
  };
}

module.exports = {
  createPacer,
  FLOOR_MS,
  CEILING_MS,
  MULTIPLIER,
  DECAY,
  MAX_DUTY_CYCLE,
  UNMEASURED_MS,
};
