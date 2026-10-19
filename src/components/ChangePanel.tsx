import { useState } from 'preact/hooks';
import { phaseSubs } from '../../shared/billing.ts';
import { CURRENCIES } from '../../shared/format.ts';
import { changePrice, removePhase, resume, switchPlan } from '../../shared/phases.ts';
import type { AppState, Cycle, Subscription } from '../../shared/types.ts';
import { DatePicker } from './DatePicker.tsx';
import { History } from './History.tsx';
import { Group, Icon } from './ui.tsx';
import { toast } from '../store.ts';

const CYCLES: Array<[string, string, Cycle]> = [
  ['m1', '每月', { unit: 'month', every: 1 }],
  ['y1', '每年', { unit: 'year', every: 1 }],
  ['m3', '每季度', { unit: 'month', every: 3 }],
  ['m6', '每半年', { unit: 'month', every: 6 }],
  ['w1', '每周', { unit: 'week', every: 1 }],
];

type Mode = 'price' | 'switch' | 'resume';

/** 编辑页里的「历程与变更」：调价、换区 / 换套餐、续订 */
export function ChangePanel({ f, setF, state, today }: { f: Subscription; setF: (s: Subscription) => void; state: AppState; today: string }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [date, setDate] = useState(today);
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState(f.currency);
  const [cycle, setCycle] = useState(CYCLES.find(([, , c]) => c.unit === f.cycle.unit && c.every === f.cycle.every)?.[0] ?? 'm1');
  const [methodId, setMethodId] = useState(f.methodId ?? '');
  const [region, setRegion] = useState(f.region ?? '');
  const ended = !!f.end || f.status === 'cancelled';
  const phases = phaseSubs(f).length;

  const open = (m: Mode) => {
    setMode(m);
    setDate(today);
    setPrice(m === 'price' ? '' : String(f.price));
    setCurrency(f.currency);
    setMethodId(f.methodId ?? '');
    setRegion(f.region ?? '');
  };
  const apply = () => {
    const n = Number(price);
    if (!(n >= 0) || price === '') return toast('请填写价格', true);
    try {
      const plan = { price: n, currency, cycle: CYCLES.find(([k]) => k === cycle)![2], methodId: methodId || undefined, region: region.trim().toUpperCase() || undefined };
      const next = mode === 'price' ? changePrice(f, date, n) : mode === 'switch' ? switchPlan(f, date, plan) : resume(f, date, plan);
      setF(next);
      setMode(null);
      toast(mode === 'price' ? '已记录调价，保存后生效' : mode === 'switch' ? '已添加新阶段，保存后生效' : '已续订，保存后生效');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    }
  };

  return (
    <Group title="历程与变更" foot="换区、换套餐、断更后续订都会形成新的阶段；之前阶段的扣款按当时的币种、价格和汇率保留。">
      <History sub={f} state={state} today={today} />
      <div class="cell" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button class={`btn ${mode === 'price' ? 'primary' : ''}`} onClick={() => open('price')}>
          记录调价
        </button>
        <button class={`btn ${mode === 'switch' ? 'primary' : ''}`} onClick={() => open('switch')}>
          换区 / 换套餐
        </button>
        {ended && (
          <button class={`btn ${mode === 'resume' ? 'primary' : ''}`} onClick={() => open('resume')}>
            续订
          </button>
        )}
        {phases > 1 && (
          <button class="btn danger" onClick={() => setF(removePhase(f, phases - 1))}>
            撤回最近一个阶段
          </button>
        )}
      </div>
      {mode && (
        <div class="change-form">
          <label>
            {mode === 'price' ? '新价格生效日' : mode === 'switch' ? '切换生效日' : '续订日期'}
            <DatePicker value={date} onChange={(v) => setDate(v ?? today)} />
          </label>
          <label>
            {mode === 'price' ? `新价格（${f.currency}）` : '价格'}
            <input inputMode="decimal" value={price} autoFocus placeholder="0.00" onInput={(e) => setPrice((e.target as HTMLInputElement).value)} />
          </label>
          {mode !== 'price' && (
            <>
              <label>
                币种
                <select value={currency} onChange={(e) => setCurrency((e.target as HTMLSelectElement).value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                周期
                <select value={cycle} onChange={(e) => setCycle((e.target as HTMLSelectElement).value)}>
                  {CYCLES.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                支付方式
                <select value={methodId} onChange={(e) => setMethodId((e.target as HTMLSelectElement).value)}>
                  <option value="">未指定</option>
                  {state.methods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                地区
                <input value={region} placeholder="如 US" onInput={(e) => setRegion((e.target as HTMLInputElement).value)} />
              </label>
            </>
          )}
          <div class="change-actions">
            <button class="btn" onClick={() => setMode(null)}>
              取消
            </button>
            <button class="btn primary" onClick={apply}>
              <Icon name="check" /> 应用
            </button>
          </div>
        </div>
      )}
    </Group>
  );
}
