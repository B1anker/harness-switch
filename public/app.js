const state = { data: null };
const labels = { claude: 'Claude Code', pi: 'pi', codex: 'Codex', zcode: 'zcode', kimi: 'Kimi Code' };
const esc = (s='') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url, options={}) { const r = await fetch(url, {headers:{'Content-Type':'application/json'}, ...options}); const j = await r.json(); if(!r.ok) throw new Error(j.error || '请求失败'); return j; }
async function load() { state.data = await api('/api/state'); render(); }
function render() {
  const root = document.querySelector('#cards');
  root.innerHTML = Object.keys(labels).map(h => {
    const profiles = state.data.profiles[h] || []; const active = state.data.active[h];
    return `<article class="card harness"><div class="card-head"><div><div class="eyebrow">${h.toUpperCase()}</div><h3>${labels[h]}</h3></div><button class="small" onclick="openModal('${h}')">+ 新增</button></div><div class="active">当前：<strong>${active ? esc(active.name) : '未激活'}</strong>${active ? `<span class="dot"></span>` : ''}</div><div class="profiles">${profiles.length ? profiles.map(p => `<div class="profile"><div><strong>${esc(p.name)}</strong><span>${esc(p.base_url)}</span>${p.model ? `<small>${esc(p.model)}</small>` : ''}</div><div class="profile-actions"><button class="small ${active && active.name===p.name ? 'selected':''}" onclick="activate('${h}', ${JSON.stringify(p.name)})">${active && active.name===p.name ? '已激活' : '激活'}</button><button class="icon" title="删除" onclick="removeProfile('${h}', ${JSON.stringify(p.name)})">删除</button></div></div>`).join('') : '<div class="empty">还没有配置档案</div>'}</div></article>`;
  }).join('');
}
function openModal(h, name='') { document.querySelector('#harness').value=h; document.querySelector('#modal-title').textContent=`新增 ${labels[h]} 配置`; ['name','base_url','api_key','model','notes'].forEach(id=>document.querySelector('#'+id).value=''); document.querySelector('#modal').showModal(); }
document.querySelector('#profile-form').addEventListener('submit', async e => { e.preventDefault(); const payload = Object.fromEntries(['harness','name','base_url','api_key','model','notes'].map(id=>[id,document.querySelector('#'+id).value])); try { await api('/api/profile',{method:'POST',body:JSON.stringify(payload)}); document.querySelector('#modal').close(); await load(); } catch(err){ alert(err.message); } });
async function activate(h,name) { try { const j=await api('/api/activate',{method:'POST',body:JSON.stringify({harness:h,name})}); await load(); alert(`已激活 ${labels[h]} / ${name}\n\n请在 SSH shell 执行：\nsource ${j.env_file}`); } catch(err){ alert(err.message); } }
async function removeProfile(h,name) { if(!confirm(`删除 ${labels[h]} / ${name}？`)) return; await api(`/api/profile/${h}/${encodeURIComponent(name)}`,{method:'DELETE'}); await load(); }
load().catch(err=>alert(err.message));
