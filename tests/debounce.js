// Tests for the pacing of whole-document work.
//
// The property that matters is the duty cycle. Everything else here -- the
// floor, the ceiling, the decay -- is comfort, and can be retuned by taste.
// The cap cannot: the extension host is one thread shared with every other
// extension, and exceeding it means TJSON conversion is taking time from
// windows that have nothing to do with TJSON. So the ceiling is checked to be
// a preference that yields, rather than a limit that overrides.
//
// Time is injected rather than waited on. A test that measured real durations
// would be pacing itself by the machine it runs on, which is the very thing
// the module exists to stop the extension from doing badly.

const {
    createPacer,
    FLOOR_MS,
    CEILING_MS,
    MAX_DUTY_CYCLE,
    UNMEASURED_MS,
} = require('../src/debounce');

const failures = [];
const check = (label, condition, detail) => {
    if (!condition) failures.push(`${label}${detail ? `\n      ${detail}` : ''}`);
};

/** A pacer that has observed `cost` ms of work, `times` times, on one key. */
function after(cost, times = 1) {
    const pacer = createPacer();
    const real = Date.now;
    let clock = 0;
    Date.now = () => clock;
    try {
        for (let i = 0; i < times; i++) {
            pacer.measure('k', () => { clock += cost; });
        }
    } finally {
        Date.now = real;
    }
    return pacer;
}

const waitAfter = (cost, times = 1) => after(cost, times).delayFor('k');

// ── the cap ──────────────────────────────────────────────────────────────────

// Across four orders of magnitude, including costs far past the ceiling.
const costs = [0.2, 1, 10, 63, 100, 320, 807, 1000, 2500, 5000, 12000, 60000];
const breaches = costs
    .map((cost) => [cost, waitAfter(cost)])
    .filter(([cost, wait]) => cost / (cost + wait) > MAX_DUTY_CYCLE + 1e-9);
check('the work never occupies more of the host than the cap allows',
    breaches.length === 0,
    breaches.map(([c, w]) => `cost ${c}ms -> wait ${w}ms`).join('\n      '));

// The ceiling is a preference. Past the point where honouring it would breach
// the cap, the cap has to win -- this is the case a fixed maximum gets wrong,
// and it is the slow machine that lands in it.
check('the ceiling gives way rather than breaching the cap',
    waitAfter(12000) > CEILING_MS,
    `wait ${waitAfter(12000)}ms is not past the ${CEILING_MS}ms ceiling`);

check('but the ceiling still applies while there is room for it',
    waitAfter(400) === CEILING_MS,
    `expected ${CEILING_MS}, got ${waitAfter(400)}`);

// ── the ends ─────────────────────────────────────────────────────────────────

check('work that costs nothing waits the floor and no longer',
    waitAfter(0) === FLOOR_MS, `got ${waitAfter(0)}`);

check('an unmeasured document is assumed expensive, not cheap',
    createPacer().delayFor('never-seen') === UNMEASURED_MS,
    `got ${createPacer().delayFor('never-seen')}`);

// The guess must not be recorded, or a small document would spend several
// keystrokes easing down from it before becoming responsive.
check('the first real measurement replaces the guess outright',
    waitAfter(1, 1) === waitAfter(1, 8),
    `one sample ${waitAfter(1, 1)}ms vs eight ${waitAfter(1, 8)}ms`);

// ── adapting ─────────────────────────────────────────────────────────────────

// Rising has to be immediate: the cost of underestimating is passes stacking
// on each other, which is the failure this whole module exists to prevent.
const rising = createPacer();
{
    const real = Date.now;
    let clock = 0;
    Date.now = () => clock;
    rising.measure('k', () => { clock += 10; });
    const quick = rising.delayFor('k');
    rising.measure('k', () => { clock += 1000; });
    const slow = rising.delayFor('k');
    Date.now = real;
    check('a slower sample is adopted at once', slow > quick * 10, `${quick}ms -> ${slow}ms`);
}

// Falling has to be gradual, so one lucky run does not undo the backoff.
{
    const real = Date.now;
    let clock = 0;
    Date.now = () => clock;
    const easing = createPacer();
    easing.measure('k', () => { clock += 1000; });
    const backedOff = easing.costFor('k');
    easing.measure('k', () => { clock += 1; });
    const afterOneFastRun = easing.costFor('k');
    Date.now = real;
    // On the estimate rather than the delay: in this range the delay is
    // pinned to the ceiling, so it cannot show a change the estimate did make.
    check('a faster sample is eased into rather than jumped to',
        afterOneFastRun < backedOff && afterOneFastRun > 1,
        `${backedOff}ms -> ${afterOneFastRun}ms, expected a partial fall toward 1ms`);
}

// ── bookkeeping ──────────────────────────────────────────────────────────────

// Documents outlive nothing here: a pacer that never forgot would hold a
// record for every file opened for the life of the window.
{
    const pacer = after(500);
    pacer.forget('k');
    check('forgetting a document drops its history',
        pacer.costFor('k') === undefined && pacer.delayFor('k') === UNMEASURED_MS);
}

// The measurement has to survive the work throwing, because on an invalid
// document throwing *is* the result -- and an invalid document is the normal
// state of one being typed into.
{
    const pacer = createPacer();
    const real = Date.now;
    let clock = 0;
    Date.now = () => clock;
    try {
        pacer.measure('k', () => { clock += 900; throw new Error('invalid TJSON'); });
    } catch {
        // expected
    }
    Date.now = real;
    check('work that throws is still measured', pacer.costFor('k') === 900,
        `got ${pacer.costFor('k')}`);
}

// Two documents must not pace each other.
{
    const pacer = createPacer();
    const real = Date.now;
    let clock = 0;
    Date.now = () => clock;
    pacer.measure('big', () => { clock += 2000; });
    pacer.measure('small', () => { clock += 1; });
    Date.now = real;
    check('each document is paced by its own cost',
        pacer.delayFor('small') === FLOOR_MS && pacer.delayFor('big') > CEILING_MS,
        `small ${pacer.delayFor('small')}ms, big ${pacer.delayFor('big')}ms`);
}

// ── the cue ──────────────────────────────────────────────────────────────────
//
// The cue exists because of the pacing above: once a wait can reach tens of
// seconds, silence is indistinguishable from a hang. What it must not do is
// appear for the short waits that are the common case, or stay behind after
// the work it described has finished.

{
    const Module = require('module');
    const bar = {
        text: '', tooltip: '', name: '', visible: false,
        show() { this.visible = true; }, hide() { this.visible = false; }, dispose() {},
    };
    const resolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
        return request === 'vscode' ? 'vscode' : resolve.call(this, request, ...rest);
    };
    require.cache.vscode = {
        id: 'vscode', filename: 'vscode', loaded: true,
        exports: {
            StatusBarAlignment: { Left: 1, Right: 2 },
            window: { createStatusBarItem: () => bar },
        },
    };

    const { createActivity, VISIBLE_ABOVE_MS } = require('../src/activity');
    const activity = createActivity();
    activity.register({ subscriptions: [] });

    activity.waiting('a', VISIBLE_ABOVE_MS - 1, 10);
    check('a short wait shows nothing', bar.visible === false);

    activity.waiting('a', VISIBLE_ABOVE_MS, 250);
    check('a long wait shows the cue', bar.visible === true);
    check('the cue says how long and why',
        bar.tooltip.includes('250ms') && /\d+\.\ds/.test(bar.tooltip), bar.tooltip);

    activity.waiting('b', VISIBLE_ABOVE_MS * 2, 500);
    activity.settled('a');
    check('the cue stays while other slow work is outstanding', bar.visible === true);
    activity.settled('b');
    check('the cue clears when the last work settles', bar.visible === false);

    // A document that got faster must clear the cue rather than keep it from
    // whatever it was doing before.
    activity.waiting('c', VISIBLE_ABOVE_MS * 2, 500);
    activity.waiting('c', 100, 5);
    check('dropping below the threshold clears the cue', bar.visible === false);

    // Settling something that was never slow enough to show must not throw or
    // disturb work that is showing.
    activity.waiting('d', VISIBLE_ABOVE_MS * 2, 500);
    activity.settled('never-registered');
    check('settling unknown work leaves the cue alone', bar.visible === true);
    activity.settled('d');
}

const total = 18;
console.log(`debounce: ${total - failures.length}/${total} case(s) pass`);
for (const failure of failures) {
    console.log('');
    console.log(`FAIL  ${failure}`);
}
if (failures.length > 0) process.exitCode = 1;
