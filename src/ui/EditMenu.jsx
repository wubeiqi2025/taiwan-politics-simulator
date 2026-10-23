// 统一编辑入口：各处只放一个小齿轮按钮，点开后在编辑界面中选择要修改的项目
import { ask, isSim, previewDate } from '../core/store.js';
import { Icon } from './Icon.jsx';

// items: [{ icon, name, desc, run, danger, hidden }]
export function EditGear({ title, items, size = 15 }) {
  const open = async e => {
    e?.stopPropagation();
    const list = items.filter(x => !x.hidden);
    const i = await ask({ kind: 'custom', Comp: EditSheet, props: { title, items: list } });
    if (i != null && list[i]) await list[i].run();
  };
  return (
    <button class="btn ghost sm icon shot-hide" title={`编辑：${title}`} aria-label={`编辑：${title}`} onClick={open}>
      <Icon name="settings" size={size} />
    </button>
  );
}
function EditSheet({ resolve, title, items }) {
  return (
    <>
      <div class="modal-head row"><Icon name="settings" size={17} />编辑 · {title}</div>
      <div class="modal-body">
        {!isSim.value && !previewDate.value && <div class="notice info" style={{ marginBottom: 8 }}>当前为真实历史（只读）。选择任一项目时，会先提示以当前日期建立架空分支，原始史料不会被改写。</div>}
        {previewDate.value && <div class="notice info" style={{ marginBottom: 8 }}>当前为回看预览，编辑前需从此日建立新分支。</div>}
        <div class="list">
          {items.map((it, i) => (
            <div class="list-item" style={{ alignItems: 'flex-start', padding: '10px 10px' }} onClick={() => resolve(i)}>
              <span style={{ color: it.danger ? 'var(--danger)' : 'var(--accent)', display: 'flex', paddingTop: 1 }}><Icon name={it.icon || 'edit'} size={17} /></span>
              <div class="grow">
                <div class="bold" style={{ color: it.danger ? 'var(--danger)' : undefined }}>{it.name}</div>
                {it.desc && <div class="small muted">{it.desc}</div>}
              </div>
              <Icon name="chevronR" size={14} style={{ color: 'var(--ink-3)', marginTop: 3 }} />
            </div>
          ))}
          {!items.length && <div class="empty">没有可编辑的项目</div>}
        </div>
      </div>
      <div class="modal-foot"><button class="btn" onClick={() => resolve(null)}>关闭</button></div>
    </>
  );
}
