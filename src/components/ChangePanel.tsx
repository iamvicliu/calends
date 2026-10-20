import { useState } from 'preact/hooks';
import { addDays, addMonths, nextCharge, phaseSubs } from '../../shared/billing.ts';
import { changePrice, removePhase, resume, setPhaseEnd, switchPlan } from '../../shared/phases.ts';
import type { AppState, Cycle, Subscription } from '../../shared/types.ts';
import { DatePicker } from './DatePicker.tsx';
import { History } from './History.tsx';
import { Group, Icon, Toggle } from './ui.tsx';
import { MethodPicker } from './MethodPicker.tsx';
import { toast } from '../store.ts';
import { CurrencySelect, Picker, RegionSelect } from './Picker.tsx';
import { t } from '../../shared/i18n.ts';

/** 常用的续费周期（不含买断） */
export const CYCLES: Array<[string, Cycle]> = [
  ['w1', { unit: 'week', every: 1 }],
  ['m1', { unit: 'month', every: 1 }],
  ['m3', { unit: 'month', every: 3 }],
  ['m6', { unit: 'month', every: 6 }],
  ['y1', { unit: 'year', every: 1 }],
  ['y2', { unit: 'year', every: 2 }],
];
/** 周期选项的文字（w1、m1……lt） */
export const cycleName = (k: string) => t(`editor.cycle.${k}`);

type Mode = 'price' | 'switch' | 'resume';

/** 编辑页里的「历程与变更」：调价、换区 / 换套餐、续订 */
export function ChangePanel({ f, setF, state, today }: { f: Subscription; setF: (s: Subscription) => void; state: AppState; today: string }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [date, setDate] = useState(today);
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState(f.currency);
  const [cycle, setCycle] = useState(CYCLES.find(([, c]) => c.unit === f.cycle.unit && c.every === f.cycle.every)?.[0] ?? 'm1');
  const [methodId, setMethodId] = useState(f.methodId ?? '');
  const [region, setRegion] = useState(f.region ?? '');
  const [planned, setPlanned] = useState(false);
  // 换区时旧的继续用到某天（已预付、还没到期），两段并行
  const [keep, setKeep] = useState(false);
  const [keepUntil, setKeepUntil] = useState(today);
  const ended = !!f.end || f.status === 'cancelled';
  const phases = phaseSubs(f).length;

  const open = (m: Mode) => {
    setMode(m);
    // 生效日要晚于当前阶段的开始日：今天就开始的新订阅，默认放到下次续费（或第二天）
    const lastStart = phaseSubs(f).pop()!.start;
    setDate(today > lastStart ? today : (nextCharge(f, addDays(lastStart, 1)) ?? addDays(lastStart, 1)));
    setPrice(m === 'price' ? '' : String(f.price));
    setCurrency(f.currency);
    setMethodId(f.methodId ?? '');
    setRegion(f.region ?? '');
    setPlanned(false);
    setKeep(false);
  };
  /** 旧的默认用到哪天：切换日之后它的下一次扣款日（已付到那天），没有就一个月后 */
  const paidThrough = (at: string) => {
    const last = phaseSubs(f).pop()!;
    return nextCharge(last, addDays(at, 1)) ?? addMonths(at, 1);
  };
  const toggleKeep = (on: boolean) => {
    setKeep(on);
    if (on) setKeepUntil(paidThrough(date));
  };
  const setEnd = (start: string, end: string | undefined) => {
    try {
      setF(setPhaseEnd(f, start, end));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    }
  };
  const apply = () => {
    const n = Number(price);
    if (!(n >= 0) || price === '') return toast(t('editor.change.needPrice'), true);
    try {
      const plan = { price: n, currency, cycle: CYCLES.find(([k]) => k === cycle)![1], methodId: methodId || undefined, region: region.trim().toUpperCase() || undefined, planned: mode === 'switch' && planned ? true : undefined };
      const next = mode === 'price' ? changePrice(f, date, n) : mode === 'switch' ? switchPlan(f, date, plan, keep ? keepUntil : undefined) : resume(f, date, plan);
      setF(next);
      setMode(null);
      toast(t(mode === 'price' ? 'editor.change.toast.price' : mode === 'switch' ? 'editor.change.toast.switch' : 'editor.change.toast.resume'));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    }
  };

  return (
    <Group title={t('editor.change.title')}>
      <History sub={f} state={state} today={today} onEnd={setEnd} />
      <div class="cell" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button class={`btn ${mode === 'price' ? 'primary' : ''}`} onClick={() => open('price')}>
          {t('editor.change.price')}
        </button>
        <button class={`btn ${mode === 'switch' ? 'primary' : ''}`} onClick={() => open('switch')}>
          {t('editor.change.switch')}
        </button>
        {ended && (
          <button class={`btn ${mode === 'resume' ? 'primary' : ''}`} onClick={() => open('resume')}>
            {t('editor.change.resume')}
          </button>
        )}
        {phases > 1 && (
          <button class="btn danger" onClick={() => setF(removePhase(f, phases - 1))}>
            {t('editor.change.undo')}
          </button>
        )}
      </div>
      {mode && (
        <div class="change-form">
          <label>
            {t(mode === 'price' ? 'editor.change.priceDate' : mode === 'switch' ? 'editor.change.switchDate' : 'editor.change.resumeDate')}
            <DatePicker
              value={date}
              onChange={(v) => {
                const d = v ?? today;
                setDate(d);
                if (keep && keepUntil <= d) setKeepUntil(paidThrough(d));
              }}
            />
          </label>
          <label>
            {mode === 'price' ? t('editor.change.newPrice', { currency: f.currency }) : t('editor.change.priceLabel')}
            <input inputMode="decimal" value={price} autoFocus placeholder="0.00" onInput={(e) => setPrice((e.target as HTMLInputElement).value)} />
          </label>
          {mode !== 'price' && (
            <>
              <label>
                {t('editor.field.currency')}
                <CurrencySelect value={currency} onChange={setCurrency} />
              </label>
              <label>
                {t('editor.field.cycle')}
                <Picker value={cycle} onChange={setCycle} options={CYCLES.map(([k]) => ({ value: k, label: cycleName(k) }))} ariaLabel={t('editor.field.cycle')} />
              </label>
              <label>
                {t('editor.field.method')}
                <MethodPicker methods={state.methods} value={methodId || undefined} onChange={(id) => setMethodId(id ?? '')} />
              </label>
              <label>
                {t('editor.field.region')}
                <RegionSelect value={region || undefined} onChange={(r) => setRegion(r ?? '')} common={[...new Set([...state.subscriptions.flatMap((x) => [x.region, ...(x.phases ?? []).map((ph) => ph.region)]), ...state.methods.map((m) => m.region)].filter(Boolean) as string[])]} />
              </label>
              {mode === 'switch' && (
                <div class="change-keep">
                  <div class="change-keep-row">
                    <span>
                      {t('editor.overlap.keep')}
                      <small>{t('editor.overlap.keepHint')}</small>
                    </span>
                    <Toggle checked={keep} onChange={toggleKeep} label={t('editor.overlap.keep')} />
                  </div>
                  {keep && (
                    <label class="change-keep-date">
                      {t('editor.overlap.keepUntil')}
                      <DatePicker value={keepUntil} min={addDays(date, 1)} onChange={(v) => v && setKeepUntil(v)} />
                    </label>
                  )}
                </div>
              )}
              {mode === 'switch' && (
                <label class="change-plan">
                  <span>
                    {t('editor.change.planned')}
                    <small>{t('editor.change.plannedHint')}</small>
                  </span>
                  <Toggle checked={planned} onChange={setPlanned} />
                </label>
              )}
            </>
          )}
          <div class="change-actions">
            <button class="btn" onClick={() => setMode(null)}>
              {t('common.cancel')}
            </button>
            <button class="btn primary" onClick={apply}>
              <Icon name="check" /> {t('common.apply')}
            </button>
          </div>
        </div>
      )}
    </Group>
  );
}
