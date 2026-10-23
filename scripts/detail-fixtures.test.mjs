import assert from 'node:assert/strict';
import test from 'node:test';
import { detailFixtures } from './detail-fixtures.ts';
import { activePhases, chargesBetween, effectiveStatus, memberAboard, phaseSubs, subError } from '../shared/billing.ts';
import { convertOn } from '../shared/fx.ts';
import { parseBackup } from '../worker/backup.ts';

for (const today of ['2026-10-23', '2028-02-29', '2027-03-31']) {
  test(`detail stress backup preserves scenarios on ${today}`, () => {
    const { backup, cases } = detailFixtures(today);
    const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
    assert.equal(parsed.subscriptions.length, 36);
    assert.equal(new Set(cases.map((c) => c.id)).size, 36);
    assert.deepEqual(
      [...new Set(cases.map((c) => c.case))],
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
    const sub = (id) => parsed.subscriptions.find((s) => s.id === `detail-${id}`);
    const history = (id) => chargesBetween(sub(id), sub(id).start, today, today);
    for (const s of parsed.subscriptions) {
      assert.equal(subError(s), undefined, s.name);
      for (const p of phaseSubs(s)) {
        assert.ok(
          (p.payments ?? []).every((r) => r.date <= today),
          `${s.name}: future actual payment`,
        );
      }
    }
    assert.equal(history('01').length, 36);
    assert.deepEqual([...new Set(history('01').map((c) => c.amount))], [36]);
    assert.equal(history('02').length, 70);
    assert.equal(history('02').filter((c) => c.amount < 0).length, 35);
    assert.equal(history('03').length, 8);
    assert.equal(sub('03').phases.length, 8);
    assert.equal(new Set(history('03').map((c) => c.amount)).size, 8);
    assert.equal(sub('04').share.members.length, 4);
    assert.equal(sub('04').share.members.filter((m) => memberAboard(m, today)).length + 1, 4);
    assert.equal(sub('04-full').share.members.filter((m) => memberAboard(m, today)).length + 1, 5);
    assert.ok(sub('04').notes.length >= 300);
    assert.ok(sub('04').share.members.find((m) => m.left).leaveRefund.amount > 0);
    assert.equal(sub('05').share.members[0].share, 10);
    assert.ok(sub('30').share.members.every((m) => m.share === (m.exempt ? 0 : 10)));
    assert.equal(sub('06').share.role, 'member');
    assert.equal(history('07').length, 1);
    for (const [id, status] of [
      ['08', 'upcoming'],
      ['09', 'trial'],
      ['10', 'paused'],
      ['11', 'ended'],
      ['12', 'terminated'],
      ['13', 'ended'],
      ['14', 'ending'],
    ]) {
      assert.equal(effectiveStatus(sub(id), today), status);
    }
    assert.equal(history('08').length, 0);
    assert.equal(history('09').length, 0);
    assert.equal(history('10').length, 12);
    assert.equal(history('13').length, 12);
    assert.equal(sub('11').stop.kind, 'cancel');
    assert.ok(history('11').some((c) => c.kind === 'refund' && c.amount < 0));
    assert.equal(sub('12').stop.kind, 'terminate');
    assert.ok(sub('12').stop.reason);
    assert.equal(activePhases(sub('15'), today).length, 2);
    assert.equal(sub('15').phases.at(-1).planned, true);
    assert.equal(new Set(sub('15').phases.map((p) => p.region)).size, 3);
    assert.ok(sub('16').intro && sub('16').bonus);
    assert.ok(history('17').some((c) => c.kind === 'failed'));
    assert.ok(history('17').some((c) => c.kind === 'refund'));
    assert.ok(history('17').some((c) => c.kind === 'adjust'));
    assert.equal(history('18')[0].settled.currency, 'HKD');
    assert.equal(parsed.fx.rates.XCD, undefined);
    assert.ok(Number.isNaN(convertOn(27, 'XCD', 'CNY', today, {}, parsed.fx)));
    assert.ok(history('19').length > 100);
    assert.equal(history('20-quarter').length, 8);
    assert.equal(history('20-half').length, 6);
    assert.equal(history('20-biennial').length, 3);
    assert.deepEqual(sub('21').cycle, { unit: 'day', every: 30 });
    assert.equal(sub('22').phases.length, 2);
    assert.equal(history('23').length, 1);
    assert.equal(history('23-upgrade').length, 2);
    assert.ok(sub('24').account.length > 100 && sub('24').url.length > 200);
    assert.ok(!sub('25').methodId && !sub('25').category && !sub('25').icon);
    assert.ok(sub('26').proxy);
    assert.equal(sub('27').price, 123456.78);
    assert.equal(sub('27-small').price, 0.99);
    assert.equal(sub('28').phases.length, 20);
    assert.ok(history('29').some((c) => c.date === today));
    assert.equal(history('30').length, 40);
    assert.equal(sub('30').phases.length, 21);
    assert.ok(sub('30').phases[0].intro.until < today && sub('30').phases.at(-1).planned);
    assert.equal(parsed.settings.language, 'zh-CN');
    assert.equal(parsed.settings.baseCurrency, 'CNY');
    // Every needed month-end has fictional rates, preventing automatic network backfill.
    assert.ok(parsed.fxDaily.every((d) => d.source === 'fictional-detail-fixtures' && !d.rates.XCD));
  });
}
