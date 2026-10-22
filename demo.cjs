// Demo mode (`npm run demo`): made-up Claude Code sessions that play out by themselves, so you can try
// Hive without any sessions of your own. All screenshots in the README come from this.
const MIN = 60e3;

module.exports = function demo({ session, sessions, bump }) {
  const ago = m => Date.now() - m * MIN;
  const step = (t, s, i) => ({ t, s, i });

  function build() {
    sessions.clear();

    const auth = Object.assign(session('demo-auth'), {
      name: 'api-auth', cwd: '/home/dev/shop-api', running: true, status: 'busy', startedAt: ago(38), stateSince: ago(34),
    });
    auth.msgs = [
      { role: 'you', at: ago(34), text: 'Move our login from signed cookies to proper session tokens. Keep everyone logged in during the switch.' },
      { role: 'agent', at: ago(33), text: 'Mapping every place that reads the login cookie first.' },
      { role: 'agent', at: ago(29), text: 'Found 14 code paths that read the cookie. Two admin routes skip the auth middleware entirely, so I\'ll fix those as part of this:\n- `/admin/export`\n- `/admin/impersonate`' },
      { role: 'agent', at: ago(21), text: 'The session token table is in, with an index on expiry so cleanup stays fast.' },
      { role: 'agent', at: ago(14), text: 'Sign-in now issues a token and still sets the old cookie, so nobody is logged out halfway through the switch.' },
      { role: 'agent', at: ago(6), text: '38 tests failed after the switch, almost all of them refresh tests that mocked the cookie. Rewriting them against tokens now.' },
    ];
    auth.prog = {
      goal: 'Move login to session tokens', icon: 'key', ask: false, at: ago(5), now: 'Rewriting the token refresh tests',
      steps: [step('Map every login code path', 'done', 'search'), step('Add the session token table', 'done', 'database'),
        step('Issue tokens on sign-in', 'done', 'key'), step('Rewrite token refresh tests', 'now', 'flask-conical'),
        step('Remove the old cookie logic', 'todo', 'trash-2'), step('Run the full test suite', 'todo', 'circle-check')],
      brief: { headline: 'Sign-in issues session tokens; tests being rewritten', you: false, next: 'Finish refresh tests, then remove the old cookies',
        stats: [{ value: '14', label: 'login paths found', i: 'search' }, { value: '38', label: 'tests to rewrite', i: 'flask-conical' }],
        facts: [{ k: 'done', t: 'Session token table added with an expiry index', i: 'database' },
          { k: 'found', t: 'Two admin routes skipped the auth middleware', i: 'shield' },
          { k: 'decided', t: 'Old cookie stays valid until the switch is done', i: 'clock' }] },
      history: [{ goal: 'Fix the flaky checkout test', icon: 'bug', done: 5, total: 5, at: ago(40),
        brief: { headline: 'Checkout test fixed: it raced the payment mock', you: false, next: 'Nothing left open',
          stats: [{ value: '1 in 12', label: 'runs failed before', i: 'activity' }, { value: '0 in 200', label: 'runs fail now', i: 'circle-check' }],
          facts: [{ k: 'found', t: 'The test clicked Pay before the mock was ready', i: 'search' },
            { k: 'done', t: 'Test now waits for the mock to answer', i: 'clock' }] } }],
    };

    const docs = Object.assign(session('demo-docs'), {
      name: 'docs', cwd: '/home/dev/shop-website', running: true, status: 'waiting', startedAt: ago(26), stateSince: ago(3), pending: { name: 'AskUserQuestion' },
    });
    docs.msgs = [
      { role: 'you', at: ago(25), text: 'The docs sidebar is a mess. Regroup it so new users find the setup guide first.' },
      { role: 'agent', at: ago(19), text: 'There are 47 pages. I\'d group them into five sections: **Start**, **Guides**, **API**, **Self-hosting** and **FAQ**, with Start always open.' },
      { role: 'agent', at: ago(3), text: '**Question:** Moving pages changes their addresses. What should happen to the old links?\n- Redirect them: old links keep working, 47 redirects to maintain\n- Keep the addresses: folders change, URLs stay the same\n- Let them break: simplest, but search results show errors for a while' },
    ];
    docs.prog = {
      goal: 'Regroup the docs navigation', icon: 'book-open', ask: true, at: ago(2), now: 'Your turn: redirect, keep or break the old links?',
      steps: [step('Audit the current docs pages', 'done', 'file-text'), step('Group pages into five sections', 'done', 'layers'),
        step('Decide what happens to old links', 'now', 'link'), step('Move pages into the new folders', 'todo', 'folder'),
        step('Update the sidebar', 'todo', 'layout-dashboard')],
      brief: { headline: '47 pages regrouped into 5 sections; old links undecided', you: true, next: 'Choose: redirect, keep or break the old links',
        stats: [{ value: '47', label: 'docs pages', i: 'file-text' }, { value: '5', label: 'new sections', i: 'layers' }],
        facts: [{ k: 'done', t: 'Every page sorted into Start, Guides, API, Self-hosting, FAQ', i: 'layers' },
          { k: 'found', t: '9 pages were duplicates of each other', i: 'search' },
          { k: 'problem', t: 'Moving pages breaks links people bookmarked', i: 'link' }] },
      history: [],
    };

    const perf = Object.assign(session('demo-perf'), {
      name: 'perf', cwd: '/home/dev/shop-app', running: true, status: 'idle', startedAt: ago(70), stateSince: ago(12),
    });
    perf.msgs = [
      { role: 'you', at: ago(64), text: 'The dashboard takes forever on the first visit. Find out why and fix it.' },
      { role: 'agent', at: ago(58), text: 'Profiled a cold load: 4.2 s, with 1.9 MB of JavaScript. Most of it is the chart library, loaded on every page although only Reports uses charts.' },
      { role: 'agent', at: ago(41), text: 'Charts now load only on the Reports page.' },
      { role: 'agent', at: ago(12), text: 'The dashboard\'s first load is down from **4.2 s to 1.1 s**.\n\n| | Before | After |\n|---|---|---|\n| First load | 4.2 s | 1.1 s |\n| JavaScript sent | 1.9 MB | 410 KB |\n| Images | PNG, full size | WebP, sized to fit |\n\nNothing else needs doing; the change is on the `perf-dashboard` branch.' },
    ];
    perf.prog = {
      goal: 'Speed up the dashboard load', icon: 'gauge', ask: false, at: ago(11), now: 'Done: first load down from 4.2 s to 1.1 s',
      steps: [step('Profile a cold first load', 'done', 'activity'), step('Find what blocks the page', 'done', 'search'),
        step('Load charts only where used', 'done', 'chart-line'), step('Serve smaller images', 'done', 'image'), step('Measure again', 'done', 'gauge')],
      brief: { headline: 'First load 4x faster, mostly by deferring charts', you: false, next: 'Nothing left open',
        stats: [{ value: '4.2 → 1.1 s', label: 'first load', i: 'gauge' }, { value: '1.9 MB → 410 KB', label: 'JavaScript sent', i: 'package' }],
        facts: [{ k: 'found', t: 'Chart library loaded on every page', i: 'package' },
          { k: 'done', t: 'Charts now load only on the Reports page', i: 'chart-line' },
          { k: 'done', t: 'Images served as WebP at the right size', i: 'image' }] },
      history: [],
    };

    const ci = Object.assign(session('demo-ci'), {
      name: 'ci-speed', cwd: '/home/dev/shop-api', running: true, status: 'busy', startedAt: ago(9), stateSince: ago(8),
    });
    ci.msgs = [
      { role: 'you', at: ago(8), text: 'CI takes 11 minutes per push. Cache the dependencies so it gets faster.' },
      { role: 'agent', at: ago(4), text: 'Each run spends 6 minutes reinstalling the same packages. Adding a cache keyed on the lockfile.' },
    ];
    ci.prog = {
      goal: 'Cache dependencies in CI', icon: 'rocket', ask: false, at: ago(4), now: 'Adding a dependency cache to the workflow',
      steps: [step('Time each CI stage', 'done', 'clock'), step('Cache dependencies by lockfile', 'now', 'package'),
        step('Cache the build output', 'todo', 'hard-drive'), step('Run CI twice to compare', 'todo', 'refresh-cw')],
      brief: { headline: 'Reinstalling packages takes 6 of 11 minutes', you: false, next: 'Add the cache, then compare two runs',
        stats: [{ value: '11 min', label: 'per CI run', i: 'clock' }, { value: '6 min', label: 'spent reinstalling', i: 'package' }],
        facts: [{ k: 'found', t: 'Every run reinstalls identical packages', i: 'package' },
          { k: 'decided', t: 'Cache keyed on the lockfile', i: 'key' }] },
      history: [],
    };
    for (const s of sessions.values()) s.lastAt = Math.max(...s.msgs.map(m => m.at));
    bump();
  }

  // A short script that plays over and over: steps finish, messages arrive, one session finishes.
  const say = (s, text) => { s.msgs.push({ role: 'agent', at: Date.now(), text }); s.lastAt = Date.now(); };
  const advance = s => {
    const now = s.prog.steps.find(x => x.s === 'now'), next = s.prog.steps.find(x => x.s === 'todo');
    if (now) now.s = 'done';
    if (next) next.s = 'now';
    s.prog.at = Date.now();
  };
  const events = [
    () => { const s = sessions.get('demo-ci'); say(s, 'Dependency cache added. The second run restored it in 9 seconds instead of reinstalling.'); advance(s); s.prog.now = 'Caching the build output'; },
    () => { const s = sessions.get('demo-auth'); say(s, 'All 38 refresh tests pass against tokens. Removing the old cookie code next.'); advance(s);
      s.prog.now = 'Removing the old cookie logic'; s.prog.brief.stats[1] = { value: '38 → 0', label: 'failing tests', i: 'flask-conical' }; },
    () => { const s = sessions.get('demo-ci'); say(s, 'Build output is cached too. Running CI twice to compare.'); advance(s); s.prog.now = 'Running CI twice to compare'; },
    () => { const s = sessions.get('demo-auth'); say(s, 'Old cookie logic removed. Running the full suite.'); advance(s); s.prog.now = 'Running the full test suite'; },
    () => { const s = sessions.get('demo-ci'); say(s, 'CI now takes **3 min 40 s** instead of 11 minutes on a normal push.'); advance(s);
      s.prog.steps.forEach(x => { x.s = 'done'; }); s.status = 'idle'; s.stateSince = Date.now(); s.prog.now = 'Done: CI down from 11 to under 4 minutes';
      s.prog.brief = { headline: 'CI down from 11 minutes to 3 min 40 s', you: false, next: 'Nothing left open',
        stats: [{ value: '11 → 3.7 min', label: 'per CI run', i: 'clock' }, { value: '9 s', label: 'cache restore', i: 'package' }],
        facts: [{ k: 'done', t: 'Dependencies cached by lockfile', i: 'package' }, { k: 'done', t: 'Build output cached between runs', i: 'hard-drive' }] }; },
    () => {},
    () => build(),
  ];
  build();
  let i = 0;
  setInterval(() => { events[i % events.length](); i++; bump(); }, 5000);
};
