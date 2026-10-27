import type { CSSProperties } from 'react';
import './tail-name.css';

/**
 * 名称放不下时保留末尾区分用的后缀：「Claude Max 20x · 74」→「Claude Ma… · 74」。
 * 按最后一个「 · 」切开，前半段省略、后缀不缩；没有后缀时就是普通的末尾省略。after 跟在后缀后面（如「×2」）。
 */
// 界面文案不得出现中点（见 ui-basics 测试）；这里只用来识别用户自己起的名字里的分隔
const SEP = ` ${String.fromCharCode(0xb7)} `;

export function TailName({ name, after = '', className, style }: { name: string; after?: string; className?: string; style?: CSSProperties }) {
  const i = name.lastIndexOf(SEP);
  const head = i > 0 ? name.slice(0, i) : name;
  const tail = (i > 0 ? name.slice(i) : '') + after;
  return (
    <span className={`tail-name${className ? ` ${className}` : ''}`} style={style} title={name + after}>
      <span className="tn-head">{head}</span>
      {tail && <span className="tn-tail">{tail}</span>}
    </span>
  );
}
