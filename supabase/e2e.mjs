/**
 * 연수 전 과정 시뮬레이션 — 서버 로직 검증
 *   node supabase/e2e.mjs          검증만 하고 흔적을 지웁니다
 *   node supabase/e2e.mjs --seed   현황판 눈으로 볼 수 있게 12명분 데이터를 남깁니다
 */
const URL = 'https://wzvcienycrebfpqjpwzv.supabase.co';
const PUB = 'sb_publishable_dX5Z2U5P_GoYkauVQ5vCSQ_0JSlq8S-';
const SES = '0822';
const TOK = '박준일0822';
const SEED = process.argv.includes('--seed');

const H = { apikey: PUB, Authorization: `Bearer ${PUB}`, 'Content-Type': 'application/json' };
const rpc = async (fn, args) =>
  (await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) })).json();
const get = async (p) => (await fetch(`${URL}/rest/v1/${p}`, { headers: H })).json();

let ok = 0, bad = 0;
const t = (cond, label, extra = '') => {
  if (cond) { ok++; console.log('  ✓ ' + label + (extra ? ` — ${extra}` : '')); }
  else { bad++; console.log('  ✗ ' + label + (extra ? ` — ${extra}` : '')); }
};
const setGate = (k, v) => rpc('admin_set', { p_ses: SES, p_key: k, p_value: v, p_token: TOK });

// ── 0. 깨끗이 시작
console.log('\n[0] 초기화');
t((await rpc('admin_reset', { p_ses: SES, p_token: TOK })).ok === true, '기존 기록 비우기');
for (const g of ['open_ox', 'open_a', 'open_b', 'open_sentence', 'ox_reveal', 'materials_open', 'require_both'])
  await setGate(g, 'N');

// ── 1. 게이팅
console.log('\n[1] 과제 열기·닫기');
const p0 = (await rpc('join_session', { p_ses: SES, p_name: '게이트시험', p_mode: 'new' })).participant;
t((await rpc('submit_ox', { p_ses: SES, p_pid: p0.id, p_answers: ['O', 'X', 'O'] })).ok === false, '닫힌 OX 제출 거부');
t((await rpc('submit_practice', { p_ses: SES, p_pid: p0.id, p_code: 'A', p_res: { 1: { stage: 3 } } })).ok === false, '닫힌 실습A 제출 거부');
t((await rpc('submit_sentence', { p_ses: SES, p_pid: p0.id, p_body: '출처를 직접 확인' })).ok === false, '닫힌 문장 제출 거부');
t((await setGate('open_ox', 'Y')).ok === true, '관리자 토글로 OX 열기');
t((await rpc('submit_ox', { p_ses: SES, p_pid: p0.id, p_answers: ['O', 'X', 'O'] })).ok === true, '열린 뒤 OX 제출 성공');
t((await rpc('admin_set', { p_ses: SES, p_key: 'open_a', p_value: 'Y', p_token: 'wrong' })).ok === false, '토큰 틀리면 토글 거부');
t((await rpc('admin_set', { p_ses: SES, p_key: 'drop_table', p_value: 'Y', p_token: TOK })).ok === false, '허용 목록 밖 설정 거부');

for (const g of ['open_a', 'open_b', 'open_sentence']) await setGate(g, 'Y');

// ── 2. 채점 · 정답 은닉
console.log('\n[2] 채점과 정답 은닉');
t((await rpc('submit_ox', { p_ses: SES, p_pid: p0.id, p_answers: ['O', 'X', 'O'] })).score === 3, 'O·X·O → 3점');
t((await rpc('submit_ox', { p_ses: SES, p_pid: p0.id, p_answers: ['X', 'O', 'X'] })).score === 0, 'X·O·X → 0점');
t((await get(`ox_responses?select=id&ses=eq.${SES}&pid=eq.${p0.id}`)).length === 1, '재제출해도 1건 (덮어쓰기)');
let q = await rpc('get_ox_questions', { p_ses: SES });
t(!q.questions.some((x) => 'answer' in x) && q.panel === null, '정답 비공개 시 정답·패널 숨김');
await setGate('ox_reveal', 'Y');
q = await rpc('get_ox_questions', { p_ses: SES });
t(q.questions.every((x) => x.answer) && q.panel?.length === 3, '정답 공개 시 정답·패널 노출');
await setGate('ox_reveal', 'N');

// ── 3. 입력 검증
console.log('\n[3] 입력 검증');
t((await rpc('submit_sentence', { p_ses: SES, p_pid: p0.id, p_body: '가' })).ok === false, '2자 미만 문장 거부');
t((await rpc('submit_sentence', { p_ses: SES, p_pid: p0.id, p_body: '가'.repeat(61) })).ok === false, '60자 초과 문장 거부');
t((await rpc('submit_practice', { p_ses: SES, p_pid: p0.id, p_code: 'A', p_res: {} })).ok === false, '빈 실습 거부');
t((await rpc('submit_practice', { p_ses: SES, p_pid: p0.id, p_code: 'C', p_res: { 1: { stage: 1 } } })).ok === false, '없는 실습지 코드 거부');
t((await rpc('join_session', { p_ses: SES, p_name: '가'.repeat(21), p_mode: 'new' })).ok === false, '21자 닉네임 거부');
t((await rpc('join_session', { p_ses: '9999', p_name: '아무개', p_mode: 'new' })).ok === false, '없는 연수 거부');
const pf = await rpc('submit_practice', { p_ses: SES, p_pid: p0.id, p_code: 'A', p_res: { 1: { risk: '상', stage: 3, memo: '출처 기록' }, 2: { stage: 2 }, 3: {} } });
t(pf.filled === 2, '채운 항목 수 계산 (빈 칸 제외)', `filled=${pf.filled}`);

// ── 4. 이름으로 이어하기
console.log('\n[4] 이어하기 · 동명이인');
t((await rpc('join_session', { p_ses: SES, p_name: '게이트시험', p_mode: 'check' })).exists === true, '같은 이름 → 이어하기 물어봄');
t((await rpc('join_session', { p_ses: SES, p_name: ' 게이트시험 ', p_mode: 'resume' })).participant.id === p0.id, '공백 무시하고 같은 사람으로 복원');
const dup = await rpc('join_session', { p_ses: SES, p_name: '게이트시험', p_mode: 'new' });
t(dup.participant.id !== p0.id, '동명이인 → 별개 참가자');
t((await rpc('restore_participant', { p_ses: SES, p_pid: p0.id })).ok === true, '참가자ID로 복원');
t((await rpc('restore_participant', { p_ses: SES, p_pid: '못된값' })).ok === false, '잘못된 ID 복원 실패');
t((await rpc('restore_participant', { p_ses: '0725', p_pid: p0.id })).ok === false, '다른 연수 ID로는 복원 안 됨');

// ── 5. 관리자 인증
console.log('\n[5] 관리자');
t((await rpc('join_session', { p_ses: SES, p_name: TOK, p_mode: 'check' })).admin === true, `닉네임 ${TOK} → 관리자`);
t((await rpc('join_session', { p_ses: SES, p_name: '박준일', p_mode: 'new' })).admin !== true, '비슷한 이름은 관리자 아님');
t((await get(`participants?select=id&ses=eq.${SES}&name=eq.${encodeURIComponent(TOK)}`)).length === 0, '관리자는 참가자로 안 남음');

// ── 6. 자료 해제 규칙
console.log('\n[6] 자료 해제');
async function progress(pid, both) {
  const [ox, pr, sn] = await Promise.all([
    get(`ox_responses?select=id&ses=eq.${SES}&pid=eq.${pid}`),
    get(`practice_responses?select=code&ses=eq.${SES}&pid=eq.${pid}`),
    get(`sentences?select=id&ses=eq.${SES}&pid=eq.${pid}`)
  ]);
  const c = pr.map((x) => x.code);
  const prOk = both ? c.includes('A') && c.includes('B') : c.includes('A') || c.includes('B');
  return (ox.length ? 1 : 0) + (prOk ? 1 : 0) + (sn.length ? 1 : 0);
}
await rpc('submit_sentence', { p_ses: SES, p_pid: p0.id, p_body: '출처를 직접 확인' });
t(await progress(p0.id, false) === 3, 'OX + 실습A + 문장 → 3/3 (A·B 택1 기준)');
t(await progress(p0.id, true) === 2, '둘 다 필수 기준에서는 2/3');
await rpc('submit_practice', { p_ses: SES, p_pid: p0.id, p_code: 'B', p_res: { 1: { stage: 4 } } });
t(await progress(p0.id, true) === 3, '실습B까지 내면 둘 다 필수에서도 3/3');
const mats = await get(`materials?select=title,kind&or=(ses.eq.${SES},ses.is.null)&order=ord`);
t(mats.length === 3 && mats.filter((m) => m.kind === '도구').length === 2, '자료 1 + 도구 2 노출', mats.map((m) => m.title).join(' · '));

// ── 7. 연수 분리
console.log('\n[7] 연수 차수 분리');
const other = await rpc('join_session', { p_ses: '0725', p_name: '다른연수사람', p_mode: 'new' });
t((await get(`participants?select=id&ses=eq.${SES}`)).every((p) => p.id !== other.participant.id), '0725 참가자는 0822 목록에 없음');
await rpc('admin_reset', { p_ses: '0725', p_token: TOK });

// ── 8. 쓰기 차단 (RLS) — 응답 코드가 아니라 「실제로 바뀌었는가」로 판정합니다.
//    PostgREST 는 0행을 고쳐도 204를 돌려주므로 코드만 보면 안 됩니다.
console.log('\n[8] 직접 쓰기 차단');
const HR = { ...H, Prefer: 'return=representation' };   // 처리된 행을 되돌려 받습니다

const before = (await get(`sentences?select=id,body&ses=eq.${SES}&pid=eq.${p0.id}`))[0];
t(!!before, '대조용 문장 준비', before?.body);

// ① 남의 이름으로 끼워넣기
const ins = await fetch(`${URL}/rest/v1/sentences`, { method: 'POST', headers: HR,
  body: JSON.stringify({ ses: SES, pid: p0.id, name: '해커', body: '끼워넣기' }) });
const insBody = await ins.text();
t(ins.status >= 400, 'INSERT 거부', `HTTP ${ins.status}`);
t((await get(`sentences?select=id&ses=eq.${SES}&name=eq.해커`)).length === 0, '끼워넣은 행 없음');

// ② 남의 응답 고치기
const upd = await fetch(`${URL}/rest/v1/sentences?ses=eq.${SES}`, { method: 'PATCH', headers: HR,
  body: JSON.stringify({ body: '남의 답 고치기' }) });
const updRows = ins.status >= 400 ? await upd.json().catch(() => []) : [];
t(Array.isArray(updRows) && updRows.length === 0, 'UPDATE 0행 처리', `HTTP ${upd.status}`);
t((await get(`sentences?select=body&ses=eq.${SES}&pid=eq.${p0.id}`))[0]?.body === before.body, '문장 내용 그대로');

// ③ 남의 응답 지우기
const del = await fetch(`${URL}/rest/v1/sentences?ses=eq.${SES}`, { method: 'DELETE', headers: HR });
const delRows = await del.json().catch(() => []);
t(Array.isArray(delRows) && delRows.length === 0, 'DELETE 0행 처리', `HTTP ${del.status}`);
t((await get(`sentences?select=id&ses=eq.${SES}&pid=eq.${p0.id}`)).length === 1, '문장이 그대로 살아 있음');

// ④ 관리자 토글 훔치기
await setGate('open_ox', 'N');
const cfgUpd = await fetch(`${URL}/rest/v1/settings?ses=eq.${SES}&key=eq.open_ox`, { method: 'PATCH', headers: HR,
  body: JSON.stringify({ value: 'Y' }) });
await cfgUpd.text();
t((await get(`settings?select=value&ses=eq.${SES}&key=eq.open_ox`))[0]?.value === 'N', '과제 토글 무단 변경 불가');
await setGate('open_ox', 'Y');

// ⑤ 참가자 명단 손대기
const pdel = await fetch(`${URL}/rest/v1/participants?ses=eq.${SES}`, { method: 'DELETE', headers: HR });
await pdel.text();
t((await get(`participants?select=id&ses=eq.${SES}`)).length > 0, '참가자 명단 무단 삭제 불가');

// ── 9. 뒷정리 또는 시드
console.log('\n[9] 마무리');
await rpc('admin_reset', { p_ses: SES, p_token: TOK });

if (SEED) {
  const names = ['김서연','박도윤','이하은','최지우','정민준','강수아','조은우','윤채원','임건우','한소율','오시현','신다인'];
  const memosA = ['출처 링크 기록 의무','짝에게 먼저 말로 설명','초고는 손으로','AI 대화 로그 첨부','고친 이유 한 줄 쓰기','안 쓴 부분 표시'];
  const pick = (arr, i) => arr[i % arr.length];
  for (let i = 0; i < names.length; i++) {
    const p = (await rpc('join_session', { p_ses: SES, p_name: names[i], p_mode: 'new' })).participant;
    await rpc('submit_ox', { p_ses: SES, p_pid: p.id, p_answers: [
      i % 4 === 0 ? 'X' : 'O', i % 3 === 0 ? 'O' : 'X', i % 5 === 0 ? 'X' : 'O'] });
    const code = i % 3 === 2 ? 'B' : 'A';
    const n = code === 'A' ? 9 : 7;
    const res = {};
    for (let k = 1; k <= n; k++) {
      if ((i + k) % 7 === 0) continue;                       // 일부러 빈 칸
      res[k] = {
        risk: ['상','중','하'][(i + k) % 3],
        stage: 1 + ((i * 2 + k * 3) % 5),
        memo: (i + k) % 4 === 0 ? pick(memosA, i + k) : ''
      };
    }
    await rpc('submit_practice', { p_ses: SES, p_pid: p.id, p_code: code, p_res: res });
    if (i % 6 !== 5) await rpc('submit_sentence', { p_ses: SES, p_pid: p.id, p_body: pick(
      ['출처를 직접 확인','짝에게 먼저 설명','초고를 손으로 작성','왜 그렇게 고쳤는지 말','자기 경험 한 줄 넣','AI가 틀린 곳을 찾'], i) });
  }
  for (const g of ['open_ox', 'open_a', 'open_b', 'open_sentence']) await setGate(g, 'Y');
  console.log(`  → 시드 ${names.length}명 생성, 과제 4개 모두 열어 두었습니다.`);
} else {
  t((await get(`participants?select=id&ses=eq.${SES}`)).length === 0, '뒷정리 완료 (참가자 0명)');
  for (const g of ['open_ox', 'open_a', 'open_b', 'open_sentence', 'ox_reveal', 'materials_open', 'require_both'])
    await setGate(g, 'N');
}

console.log(`\n통과 ${ok} / 실패 ${bad}`);
if (bad) process.exitCode = 1;
