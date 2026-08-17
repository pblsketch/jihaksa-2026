/**
 * 스키마가 제대로 적용됐는지 점검합니다.
 *   node supabase/verify.mjs
 */
const URL = 'https://wzvcienycrebfpqjpwzv.supabase.co';
const PUB = 'sb_publishable_dX5Z2U5P_GoYkauVQ5vCSQ_0JSlq8S-';

const h = (k) => ({ apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' });

async function get(path, key = PUB) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: h(key) });
  return { status: r.status, body: await r.text() };
}
async function rpc(fn, args, key = PUB) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: h(key), body: JSON.stringify(args)
  });
  return { status: r.status, body: await r.text() };
}

const pass = [], fail = [];
const t = (ok, label, extra = '') => (ok ? pass : fail).push(label + (extra ? ` — ${extra}` : ''));

console.log('점검 대상:', URL, '\n');

// ① 테이블이 만들어졌는지
for (const tb of ['participants', 'ox_responses', 'practice_responses', 'sentences', 'settings', 'materials']) {
  const r = await get(`${tb}?select=*&limit=1`);
  t(r.status === 200, `테이블 ${tb} 읽기`, r.status === 200 ? '' : `HTTP ${r.status} ${r.body.slice(0, 120)}`);
}

// ② 비밀 테이블이 잠겨 있는지 (anon 으로 못 읽어야 정상)
for (const tb of ['ox_questions', 'ox_panel', 'admin_tokens']) {
  const r = await get(`${tb}?select=*&limit=1`);
  const locked = r.status !== 200 || r.body.trim() === '[]';
  t(locked, `테이블 ${tb} 차단`, locked ? '' : `노출됨! ${r.body.slice(0, 120)}`);
}

// ③ 설정 기본값
const cfg = await get('settings?select=key,value&ses=eq.0822');
if (cfg.status === 200) {
  const m = Object.fromEntries(JSON.parse(cfg.body).map((x) => [x.key, x.value]));
  const need = ['open_ox', 'open_a', 'open_b', 'open_sentence', 'ox_reveal', 'materials_open', 'require_both'];
  const missing = need.filter((k) => !(k in m));
  t(missing.length === 0, '0822 설정 7종', missing.length ? `없음: ${missing.join(', ')}` : JSON.stringify(m));
} else {
  t(false, '0822 설정 7종', `HTTP ${cfg.status}`);
}

// ④ RPC 동작
const q = await rpc('get_ox_questions', { p_ses: '0822' });
if (q.status === 200) {
  const d = JSON.parse(q.body);
  t(Array.isArray(d.questions) && d.questions.length === 3, 'get_ox_questions 문항 3개', `${d.questions?.length}개`);
  const leaked = d.questions?.some((x) => 'answer' in x);
  t(d.reveal === true ? true : !leaked, '정답 비공개 시 answer 미노출', leaked && !d.reveal ? '정답이 새고 있습니다!' : `reveal=${d.reveal}`);
} else {
  t(false, 'get_ox_questions', `HTTP ${q.status} ${q.body.slice(0, 160)}`);
}

// ⑤ 닫힌 과제 제출 거부 (참가자 하나 만들고 시도)
const j = await rpc('join_session', { p_ses: '0822', p_name: '__점검용__', p_mode: 'new' });
if (j.status === 200) {
  const d = JSON.parse(j.body);
  t(d.ok === true, 'join_session', d.msg || '');
  if (d.ok && d.participant) {
    const pid = d.participant.id;
    const s = await rpc('submit_sentence', { p_ses: '0822', p_pid: pid, p_body: '점검용 문장' });
    const sd = JSON.parse(s.body);
    const openSn = JSON.parse((await get('settings?select=value&ses=eq.0822&key=eq.open_sentence')).body)[0]?.value;
    if (openSn === 'Y') t(sd.ok === true, '문장 제출 (열림 상태)', sd.msg || '');
    else t(sd.ok === false, '닫힌 과제 제출 거부', sd.ok ? '거부되지 않음!' : sd.msg);

    // 관리자 토큰 오인증 거부
    const bad = await rpc('admin_set', { p_ses: '0822', p_key: 'open_ox', p_value: 'Y', p_token: '틀린토큰' });
    t(JSON.parse(bad.body).ok === false, '잘못된 관리자 토큰 거부');
  }
} else {
  t(false, 'join_session', `HTTP ${j.status} ${j.body.slice(0, 160)}`);
}

// ⑥ Realtime 발행 목록 (직접 확인 불가 — 안내만)
console.log('통과 ' + pass.length + ' / 실패 ' + fail.length + '\n');
pass.forEach((x) => console.log('  ✓ ' + x));
if (fail.length) {
  console.log('');
  fail.forEach((x) => console.log('  ✗ ' + x));
  console.log('\n→ schema.sql 을 SQL Editor에서 실행하셨는지 확인해 주세요.');
  process.exit(1);
}
console.log('\n모두 정상입니다. 점검용 참가자 「__점검용__」은 관리자 화면의 「응답 모두 비우기」로 지우거나 그대로 두셔도 됩니다.');
