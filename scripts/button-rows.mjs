/**
 * Optional browser audit (ego-browser only; no CI/browser launch).
 * Seed an isolated dev ledger, then run after `ego-browser skill`:
 * ego-browser nodejs -e 'const t = await taskSpace("button rows"); const { auditButtonRows } = await import("file:///ABS/REPO/scripts/button-rows.mjs"); await auditButtonRows(t, { origin: "http://127.0.0.1:5188", output: "/ABS/OUTPUT", phase: "before" });'
 * Resume the printed space ID for the after run; finish it when all QA is done.
 * The runner changes only local fixture locale/theme/preferences, never seeds data.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export async function scanControlRows(page) {
  return page.evaluate(() => {
    const selector =
      'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=switch], .toggle, .seg, .tb-search, [data-slot=tabs-list]';
    const composite = '.toggle, .seg, .tb-search, [data-slot=tabs-list]';
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert], [aria-hidden=true]');
    };
    const name = (el) =>
      el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.textContent.trim().replace(/\s+/g, ' ').slice(0, 65);
    const path = (el) => {
      if (!el) return '';
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).join('.') : '';
      return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
    };
    // Composite controls are measured at their painted outer boundary, rather
    // than comparing inset segment buttons or a search's nested clear action.
    const controls = [...document.querySelectorAll(selector)].filter((el) => visible(el) && !el.parentElement.closest(composite));
    const rows = new Map();
    for (const el of controls) {
      // Find the nearest horizontal layout owner. This includes controls in
      // transparent wrappers (e.g. title/hint vs copy/collapse in card headers).
      let owner = el.parentElement;
      while (owner && owner !== document.body) {
        const s = getComputedStyle(owner);
        if ((s.display.includes('flex') && s.flexDirection === 'row') || s.display.includes('grid')) break;
        owner = owner.parentElement;
      }
      if (!owner || owner === document.body) continue;
      // Content grids (days, subscription cards, data tables) have natural
      // content heights; this audit targets action/form rows, not content tiles.
      if (owner.matches('.cal-grid, .sgrid, .cal-daycards, .dp-grid, .heat-grid, .gt-body, .ltable, .pc-grid, .st-map, .stmt, .scope-grid')) continue;
      const r = el.getBoundingClientRect();
      const item = { name: name(el), selector: path(el), height: +r.height.toFixed(2), center: +(r.top + r.height / 2).toFixed(2) };
      if (!rows.has(owner)) rows.set(owner, []);
      rows.get(owner).push(item);
    }
    const mismatches = [];
    let checked = 0;
    const measured = [];
    for (const [owner, items] of rows) {
      const clusters = [];
      for (const item of items.sort((a, b) => a.center - b.center)) {
        const cluster = clusters.find((row) => Math.abs(row[0].center - item.center) <= 4);
        if (cluster) cluster.push(item);
        else clusters.push([item]);
      }
      for (const controls of clusters.filter((row) => row.length > 1)) {
        checked++;
        const heights = controls.map((x) => x.height);
        const row = { parent: path(owner), controls, difference: +(Math.max(...heights) - Math.min(...heights)).toFixed(2) };
        measured.push(row);
        if (row.difference > 1) mismatches.push(row);
      }
    }
    return {
      checked,
      mismatches,
      measured,
      viewport: { width: innerWidth, height: innerHeight },
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
}

export async function auditButtonRows(
  task,
  {
    origin,
    output,
    phase = 'after',
    variants = true,
    widths = [1440, 390],
    resume = false,
    screenshots = ['list', 'calendar', 'detail', 'editor-dirty', 'public'],
    routes = ['overview', 'list', 'calendar', 'report', 'wallet', 'family', 'family/people', 'behalf', 'connect', 'settings', 'assistant', 'public'],
  },
) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Use an isolated localhost fixture, never a live ledger');
  await mkdir(output, { recursive: true });
  const page = task.page('p1');
  const results = resume ? JSON.parse(await readFile(`${output}/${phase}-progress.json`, 'utf8')) : [];
  let targetWidth = widths[0];
  const viewport = async (width) => {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    const scale = width / (await page.evaluate(() => innerWidth));
    await page.cdp('Emulation.setDeviceMetricsOverride', {
      width: Math.round(width * scale),
      height: Math.round(1000 * scale),
      deviceScaleFactor: 1 / scale,
      mobile: false,
    });
  };
  const navigate = async (url) => {
    await viewport(targetWidth);
    // Dismiss the current fixture's nested popover/dialog before leaving it.
    for (let i = 0; i < 4; i++) {
      const count = await page.evaluate(() => document.querySelectorAll('.sheet, .dp-pop').length);
      if (!count) break;
      await page.keyboard.press('Escape');
      await page.waitForFunction((previous) => document.querySelectorAll('.sheet, .dp-pop').length < previous, count);
    }
    try {
      await page.goto(url);
    } catch (error) {
      if (!String(error).includes('ERR_ABORTED')) throw error;
      const state = await page.evaluate(() => ({ url: location.href, ready: !!document.querySelector('.toolbar') }));
      if (state.url === url) return;
      // Observed aborted navigations leave the previous app route intact.
      // Retry once only after confirming that the previous app is ready.
      if (!state.ready || new URL(state.url).origin !== origin) throw error;
      await page.goto(url);
    }
  };
  const capture = async (context, width, locale, theme) => {
    await viewport(width);
    await page.waitForFunction(
      (expected) =>
        document.documentElement.lang === expected.locale &&
        document.documentElement.dataset.theme === expected.theme &&
        Math.abs(innerWidth - expected.width) <= 1,
      { locale, theme, width },
    );
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    // Let layout/entry transitions finish, then measure the rendered controls.
    await page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity));
    const result = await scanControlRows(page);
    const index = results.findIndex((x) => x.context === context && x.width === width && x.locale === locale && x.theme === theme);
    const item = { context, width, locale, theme, ...result };
    if (index >= 0) results[index] = item;
    else results.push(item);
    await writeFile(`${output}/${phase}-progress.json`, JSON.stringify(results, null, 2) + '\n');
    if (screenshots.includes(context)) await page.screenshot({ path: `${output}/${phase}-${width}-${locale}-${theme}-${context.replaceAll('/', '-')}.png` });
  };
  for (const width of widths) {
    targetWidth = width;
    await viewport(width);
    for (const locale of variants ? ['en', 'zh-CN'] : ['en']) {
      await page.cdp('Network.setUserAgentOverride', { userAgent: await page.evaluate(() => navigator.userAgent), acceptLanguage: locale });
      for (const theme of variants ? ['light', 'dark'] : ['light']) {
        if (resume && routes.includes('public') && results.some((x) => x.context === 'public' && x.width === width && x.locale === locale && x.theme === theme))
          continue;
        await navigate(`${origin}/list`);
        await page.waitForSelector('.tb-actions');
        await page.evaluate(
          async ({ locale, theme }) => {
            const state = await (await fetch('/api/state')).json();
            await fetch('/api/settings', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ...state.settings, language: locale }),
            });
            await fetch('/api/prefs', {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ theme, 'list-view': 'grid', 'cal-report-mode': 'mini', 'cal-mode': 'month' }),
            });
            localStorage.setItem('ledger:locale', locale);
          },
          { locale, theme },
        );
        for (const route of routes) {
          const extra = locale === 'en' && theme === 'light';
          const last = extra
            ? ({
                list: 'filtered-report',
                calendar: 'calendar-feed',
                wallet: 'wallet-topup',
                family: 'family-detail',
                'family/people': 'person-detail',
                behalf: 'proxy-receipt',
                connect: 'new-token',
                settings: 'public-selection',
                assistant: 'assistant-settings',
              }[route] ?? route)
            : route === 'list'
              ? 'date-picker'
              : route;
          if (resume && results.some((x) => x.context === last && x.width === width && x.locale === locale && x.theme === theme)) continue;
          await navigate(`${origin}/${route}`);
          await page.waitForSelector(route === 'public' ? '[data-slot=card]' : '.toolbar');
          await capture(route, width, locale, theme);
          if (route === 'list') {
            await page.click('.scard >> nth=0');
            await page.waitForSelector('.dt');
            await capture('detail', width, locale, theme);
            await page.click('.dt-act >> nth=0');
            await page.waitForSelector('.ed');
            await capture('editor', width, locale, theme);
            await page.fill('.ed-name input', 'Orbit Notes Draft');
            await page.focus('.sheet-foot button >> nth=0');
            await capture('editor-dirty', width, locale, theme);
            await page.click('.ed .seg button >> nth=2');
            await page.click('.ed .dp-btn >> nth=0');
            await page.waitForSelector('.dp-pop');
            await capture('date-picker', width, locale, theme);
          }
          if (locale === 'en' && theme === 'light') {
            if (route === 'list') {
              await navigate(`${origin}/list`);
              await page.waitForSelector('.tb-actions');
              await page.click('.tb-actions .seg button >> nth=2');
              await page.waitForSelector('.gt-nav');
              await capture('timeline', width, locale, theme);
              await page.click('.tb-actions .seg button >> nth=1');
              await page.waitForSelector('.ltable');
              await capture('list-table', width, locale, theme);
              await page.click('.tb-actions .seg button >> nth=0');
              await page.fill('.tb-search input', 'Orbit');
              await page.waitForSelector('.scope-trigger, .scope-actions');
              if (!(await page.evaluate(() => !!document.querySelector('.scope-actions')))) await page.click('.scope-trigger');
              await page.waitForSelector('.scope-actions');
              await capture('filtered-report', width, locale, theme);
            }
            if (route === 'calendar') {
              await page.click('.cal-expand');
              await page.waitForSelector('.scope-actions');
              await capture('calendar-report', width, locale, theme);
              await page.click('.tb-actions > .icon-btn >> nth=-1');
              await page.waitForSelector('.sheet');
              await capture('calendar-feed', width, locale, theme);
            }
            if (route === 'wallet') {
              await page.click('.wallet-grid button');
              await page.waitForSelector('.sheet');
              await capture('wallet-detail', width, locale, theme);
              await page.click('.sheet-body .row > .btn >> nth=0');
              await page.waitForSelector('.sheet-foot');
              await capture('wallet-topup', width, locale, theme);
            }
            if (route === 'family') {
              await page.focus('.car-card >> nth=0');
              await page.press('.car-card >> nth=0', 'Enter');
              await page.waitForSelector('.sheet');
              await capture('family-detail', width, locale, theme);
            }
            if (route === 'family/people') {
              await page.focus('.pp-card >> nth=0');
              await page.press('.pp-card >> nth=0', 'Enter');
              await page.waitForSelector('.sheet');
              await capture('person-detail', width, locale, theme);
            }
            if (route === 'behalf') {
              await page.focus('.proxy-card >> nth=0');
              await page.press('.proxy-card >> nth=0', 'Enter');
              await page.waitForSelector('.sheet');
              await capture('proxy-ledger', width, locale, theme);
              await page.click('.sheet-body button.ld-row >> nth=0');
              await page.waitForSelector('.sheet-foot');
              await capture('proxy-receipt', width, locale, theme);
            }
            if (route === 'connect') {
              await page.click('.tb-actions .btn');
              await page.waitForSelector('.sheet-foot');
              await capture('new-token', width, locale, theme);
            }
            if (route === 'settings') {
              await page.click('.ch-main');
              await page.waitForSelector('.sheet-foot');
              await capture('notification-editor', width, locale, theme);
              await navigate(`${origin}/settings`);
              await page.waitForSelector('.toolbar');
              await page.click('text=Manage categories');
              await page.waitForSelector('.cat-row-main');
              await capture('categories', width, locale, theme);
              await page.click('.cat-row-main >> nth=0');
              await page.waitForSelector('.cat-swatches');
              await capture('category-editor', width, locale, theme);
              await navigate(`${origin}/settings`);
              await page.waitForSelector('.toolbar');
              await page.click('text=Shown subscriptions');
              await page.waitForSelector('.pubs');
              await capture('public-selection', width, locale, theme);
            }
            if (route === 'assistant') {
              await page.click('.as-model');
              await page.waitForSelector('.as-setup');
              await capture('assistant-settings', width, locale, theme);
            }
          }
        }
      }
    }
  }
  const count = results.reduce((n, x) => n + x.mismatches.length, 0);
  const lines = [
    `# Button rows: ${phase}`,
    '',
    `Space: ${task.spaceId}; origin: ${origin}`,
    '',
    `${results.length} contexts; ${results.reduce((n, x) => n + x.checked, 0)} measured rows; ${count} mismatched row observations.`,
    '',
    'Tolerance: vertical centers ±4px; height difference >1px. Composite segments/search measured at outer edge; hidden/inert controls and content tile grids excluded. Includes offscreen rows in scroll containers. Selected screenshots capture the current viewport.',
    '',
  ];
  for (const result of results) {
    lines.push(
      `## ${result.width} / ${result.locale} / ${result.theme} / ${result.context}`,
      '',
      `${result.checked} rows; overflow: ${result.overflow}; mismatches: ${result.mismatches.length}`,
      '',
    );
    for (const row of result.mismatches)
      lines.push(`- ${row.parent}: ${row.controls.map((c) => `${c.name || c.selector} **${c.height}px**`).join(' / ')} (Δ ${row.difference}px)`);
    lines.push('');
  }
  await writeFile(`${output}/${phase}.json`, JSON.stringify(results, null, 2) + '\n');
  await writeFile(`${output}/report-${phase}.md`, lines.join('\n'));
  console.log({ spaceId: task.spaceId, phase, contexts: results.length, mismatches: count, report: `${output}/report-${phase}.md` });
  if (phase === 'after' && count > 0) throw new Error(`Button row audit failed: ${count} mismatches; see report-after.md`);
  return results;
}
