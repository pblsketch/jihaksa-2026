/* ═══════════════════════════════════════════════
   2026 지학사 국어과 연수 · 참가자 + 관리자 클라이언트
   Supabase Realtime 기반
   ═══════════════════════════════════════════════ */

var S = {
  session: null,      // '0725' | '0822'
  me: null,           // {id, name}
  admin: false,
  token: null,        // 관리자 토큰
  cfg: {},            // 진행 제어 설정
  screen: 'boot',
  ox: { i: 0, ans: [null, null, null] },
  pr: { A: {}, B: {} },
  admPeek: 'sn',      // 관리자 · 응답 훑어보기에서 보고 있는 것
  admData: null,      // 관리자 · 마지막으로 받아 온 집계
  chans: [],          // 화면별 realtime 채널
  gateChan: null,     // 설정 채널 (상시)
  waitingFor: null    // 대기 중인 게이트 key
};

var KEY   = 'jihaksa2026_pid';
var KEY_S = 'jihaksa2026_ses';
var KEY_T = 'jihaksa2026_tok';
var KEY_D = 'jihaksa2026_draft';

/* ── 유틸 ── */
function $(s) { return document.querySelector(s); }
function app() { return document.getElementById('app'); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function toast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(t._h);
  t._h = setTimeout(function () { t.classList.remove('on'); }, 2600);
}

function ses() {
  var list = window.SESSIONS || [];
  for (var i = 0; i < list.length; i++) if (list[i].id === S.session) return list[i];
  return { id: S.session, name: '', date: '' };
}

/* ── Supabase 래퍼 ── */
async function rpc(fn, args) {
  var r = await sb().rpc(fn, args || {});
  if (r.error) throw r.error;
  return r.data;
}

async function loadCfg() {
  var r = await sb().from('settings').select('key,value').eq('ses', S.session);
  if (r.error) throw r.error;
  var m = {};
  (r.data || []).forEach(function (x) { m[x.key] = x.value; });
  S.cfg = m;
  return m;
}

function isOpen(key) { return S.cfg[key] === 'Y'; }

/* 화면 전용 채널 정리 */
function dropChans() {
  S.chans.forEach(function (c) { try { sb().removeChannel(c); } catch (e) {} });
  S.chans = [];
}

/** 테이블 변경을 구독하고, 변경 시 debounce 후 콜백 */
function watch(tables, cb, name) {
  var ch = sb().channel(name || ('w' + Math.random().toString(36).slice(2)));
  tables.forEach(function (t) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, function () { hit(); });
  });
  var timer = null;
  function hit() { clearTimeout(timer); timer = setTimeout(cb, 250); }
  ch.subscribe();
  S.chans.push(ch);
  cb();
  return ch;
}

/** 진행 제어 상시 구독 — 과제가 열리면 즉시 반영 */
function watchGates() {
  if (S.gateChan) return;
  S.gateChan = sb()
    .channel('gates')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, async function () {
      var before = JSON.stringify(S.cfg);
      await loadCfg();
      if (JSON.stringify(S.cfg) === before) return;
      onGateChange();
    })
    .subscribe();
}

function onGateChange() {
  // 대기 화면에 있던 참가자를 자동으로 들여보냅니다
  if (S.waitingFor && isOpen(S.waitingFor)) {
    var target = { open_ox: 'ox', open_a: 'practiceA', open_b: 'practiceB', open_sentence: 'sentence' }[S.waitingFor];
    S.waitingFor = null;
    toast('과제가 열렸습니다.');
    go(target);
    return;
  }
  if (S.screen === 'menu') rMenu(true);
  if (S.screen === 'admin') renderAdmin();
  if (S.screen === 'materials') rMaterials();
  if (S.screen === 'oxResult') { /* 정답 공개 반영 */ drawOXResultRefresh(); }
}

/* ── 헤더 ── */
function header(title, backTo) {
  return '<div class="top">' +
    (backTo ? '<button class="back" onclick="go(\'' + backTo + '\')">‹</button>' : '') +
    '<h2>' + esc(title) + '</h2>' +
    (S.session ? '<div class="ses-badge">' + esc(ses().date.slice(5)) + '</div>' : '') +
    (S.me ? '<div class="who">' + esc(S.me.name) + '</div>' : '') +
    '</div>';
}

/* ── 라우터 ── */
function go(screen, arg) {
  dropChans();
  S.waitingFor = null;
  S.screen = screen;
  // 관리자 화면만 PC 폭으로 넓힙니다 (참가자 화면은 그대로 모바일 폭)
  document.body.classList.toggle('adm-mode', screen === 'admin');
  window.scrollTo(0, 0);
  ({
    sessionPick:  rSessionPick,
    onboard:      rOnboard,
    menu:         rMenu,
    ox:           rOX,
    oxResult:     rOXResult,
    practiceA:    function () { rPractice('A'); },
    practiceB:    function () { rPractice('B'); },
    practiceFeedA: function () { rPracticeFeed('A'); },
    practiceFeedB: function () { rPracticeFeed('B'); },
    sentence:     rSentence,
    sentenceFeed: rSentenceFeed,
    materials:    rMaterials,
    admin:        rAdmin
  }[screen] || rMenu)(arg);
}

/* ═══════════════ 부팅 ═══════════════ */
window.addEventListener('load', async function () {
  try {
    var pid = null, sv = null, tok = null;
    try {
      pid = localStorage.getItem(KEY);
      sv  = localStorage.getItem(KEY_S);
      tok = localStorage.getItem(KEY_T);
    } catch (e) {}

    var valid = (window.SESSIONS || []).some(function (x) { return x.id === sv; });
    if (!valid) { go('sessionPick'); return; }

    S.session = sv;
    S.token = tok;
    await loadCfg();
    watchGates();

    if (pid) {
      var r = await rpc('restore_participant', { p_ses: S.session, p_pid: pid });
      if (r && r.ok) {
        S.me = r.participant;
        S.admin = !!r.admin;
        if (S.admin && !S.token) { S.admin = false; S.me = null; go('onboard'); return; }
        loadDraft();
        go(S.admin ? 'admin' : 'menu');
        return;
      }
    }
    go('onboard');
  } catch (e) {
    console.error(e);
    app().innerHTML = '<div class="screen"><div class="empty">불러오지 못했습니다.<br>새로고침해 주세요.<br>' +
      '<span style="font-size:11px;opacity:.6">' + esc(e.message || e) + '</span></div></div>';
  }
});

/* ═══════════════ ⓪ 연수 선택 ═══════════════ */
function rSessionPick() {
  app().innerHTML =
    '<div class="screen">' +
      '<div class="hero">' +
        '<div class="eyebrow">2026 지학사 국어과 연수</div>' +
        '<h1>AI 시대,<br>국어 수업을 설계합니다</h1>' +
        '<div class="sub">오늘 참여하시는 연수를 골라 주세요.</div>' +
        '<div class="rule"></div>' +
      '</div>' +
      '<div class="pick">' +
        (window.SESSIONS || []).map(function (x) {
          return '<button class="pick-card" onclick="pickSession(\'' + x.id + '\')">' +
            '<div class="bk">' + esc(x.date) + '</div>' +
            '<div class="tt">' + esc(x.name) + '</div>' +
            '<div class="gl">이 연수의 활동과 결과만 따로 모입니다.</div>' +
            '</button>';
        }).join('') +
      '</div>' +
      '<div class="foot">박준일</div>' +
    '</div>';
}

async function pickSession(id) {
  S.session = id;
  S.me = null; S.admin = false; S.token = null;
  try {
    localStorage.setItem(KEY_S, id);
    localStorage.removeItem(KEY);
    localStorage.removeItem(KEY_T);
  } catch (e) {}
  await loadCfg();
  watchGates();
  go('onboard');
}

function changeSession() {
  try {
    localStorage.removeItem(KEY_S);
    localStorage.removeItem(KEY);
    localStorage.removeItem(KEY_T);
  } catch (e) {}
  S.session = null; S.me = null; S.admin = false; S.token = null;
  go('sessionPick');
}

/* ═══════════════ ① 온보딩 ═══════════════ */
function rOnboard() {
  var v = ses();
  app().innerHTML =
    '<div class="screen">' +
      '<div class="hero">' +
        '<div class="eyebrow">' + esc(v.name) + '</div>' +
        '<h1>AI 시대,<br>국어 수업을 설계합니다</h1>' +
        '<div class="sub">오늘 함께할 활동지입니다.<br>이름을 적고 시작해 주세요.</div>' +
        '<div class="rule"></div>' +
      '</div>' +
      '<div class="field">' +
        '<label class="label">이름 또는 닉네임</label>' +
        '<input type="text" id="nick" placeholder="예) 박준일" maxlength="20" autocomplete="off">' +
        '<div class="hint">중간에 나가셔도 <b>같은 이름으로 다시 들어오면</b> 이어서 하실 수 있습니다.</div>' +
      '</div>' +
      '<button class="btn" id="joinBtn" onclick="doJoin()">시작하기</button>' +
      '<div style="height:12px"></div>' +
      '<button class="btn ghost sm" style="width:100%" onclick="changeSession()">다른 연수 선택</button>' +
      '<div class="foot">박준일 · ' + esc(v.date) + '</div>' +
    '</div>';

  var el = document.getElementById('nick');
  el.addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
}

async function doJoin(mode) {
  var name = ((document.getElementById('nick') || {}).value || '').trim();
  if (!name) { toast('이름을 입력해 주세요.'); return; }
  var btn = document.getElementById('joinBtn');
  if (btn) { btn.disabled = true; btn.textContent = '확인 중…'; }

  try {
    var r = await rpc('join_session', { p_ses: S.session, p_name: name, p_mode: mode || 'check' });
    if (!r.ok) { toast(r.msg || '오류가 발생했습니다.'); resetJoin(); return; }

    if (r.exists && !mode) { askResume(r.name); resetJoin(); return; }

    S.me = r.participant;
    S.admin = !!r.admin;
    if (S.admin) {
      S.token = name;
      try { localStorage.setItem(KEY_T, name); } catch (e) {}
    }
    try { localStorage.setItem(KEY, S.me.id); } catch (e) {}
    if (r.resumed) toast('이전 기록을 불러왔습니다.');
    loadDraft();
    go(S.admin ? 'admin' : 'menu');
  } catch (e) {
    toast('연결이 불안정합니다. 다시 시도해 주세요.');
    resetJoin();
  }
}

function resetJoin() {
  var btn = document.getElementById('joinBtn');
  if (btn) { btn.disabled = false; btn.textContent = '시작하기'; }
}

function askResume(name) {
  app().innerHTML =
    '<div class="screen">' +
      '<div class="hero"><h1>‘' + esc(name) + '’<br>이미 등록된 이름입니다</h1>' +
      '<div class="sub">본인이 다시 들어오신 거라면 이어하기를,<br>동명이인이라면 새로 시작을 눌러 주세요.</div></div>' +
      '<input type="text" id="nick" value="' + esc(name) + '" style="display:none">' +
      '<button class="btn" onclick="doJoin(\'resume\')">내 기록 이어하기</button>' +
      '<div style="height:10px"></div>' +
      '<button class="btn line" onclick="doJoin(\'new\')">동명이인 · 새로 시작</button>' +
      '<div style="height:10px"></div>' +
      '<button class="btn ghost" onclick="go(\'onboard\')">다른 이름 쓰기</button>' +
    '</div>';
}

/* ═══════════════ 진행 상황 ═══════════════ */
async function myProgress() {
  var pid = S.me.id;
  var q = await Promise.all([
    sb().from('ox_responses').select('id').eq('ses', S.session).eq('pid', pid),
    sb().from('practice_responses').select('code').eq('ses', S.session).eq('pid', pid),
    sb().from('sentences').select('id').eq('ses', S.session).eq('pid', pid)
  ]);
  var codes = (q[1].data || []).map(function (x) { return x.code; });
  var done = {
    ox: !!(q[0].data || []).length,
    A: codes.indexOf('A') >= 0,
    B: codes.indexOf('B') >= 0,
    sentence: !!(q[2].data || []).length
  };
  var both = S.cfg.require_both === 'Y';
  done.practice = both ? (done.A && done.B) : (done.A || done.B);
  var count = (done.ox ? 1 : 0) + (done.practice ? 1 : 0) + (done.sentence ? 1 : 0);
  return { done: done, count: count, unlocked: count === 3 || isOpen('materials_open') };
}

/* ═══════════════ ② 메뉴 ═══════════════ */
var _menuPrevOpen = {};

async function rMenu(quiet) {
  if (!quiet) {
    app().innerHTML = header('활동 메뉴') + '<div class="screen" id="mBody"><div class="empty">불러오는 중…</div></div>';
  }
  var p = await myProgress();
  var both = S.cfg.require_both === 'Y';

  var m = [
    { k: 'ox',        gate: 'open_ox',       n: '1', t: 'O · X 퀴즈',        d: '사람일까, AI일까? · 3문항',       done: p.done.ox },
    { k: 'practiceA', gate: 'open_a',        n: '2', t: '실습 A · 나의 미래 일기', d: '독서 토론과 글쓰기 · 활동 9개', done: p.done.A },
    { k: 'practiceB', gate: 'open_b',        n: '3', t: '실습 B · 학술 연구 포스터', d: '주제 탐구 독서 · 활동 7개',   done: p.done.B },
    { k: 'sentence',  gate: 'open_sentence', n: '4', t: '오늘의 한 문장',     d: '나는 학생에게 AI를 맡기기 전에…', done: p.done.sentence }
  ];

  var html = '<div class="progress-bar">' +
    m.map(function (x) { return '<i class="' + (x.done ? 'on' : '') + '"></i>'; }).join('') + '</div>' +
    '<div class="menu">' +
    m.map(function (x) {
      var open = isOpen(x.gate);
      var justOpened = open && _menuPrevOpen[x.gate] === false;
      var cls = 'menu-item' + (open ? '' : ' shut') + (justOpened ? ' just-opened' : '');
      var st = x.done ? '완료' : (open ? '진행' : '대기');
      var stc = x.done ? ' done' : (open ? ' open' : '');
      var ds = open ? x.d : '진행자가 열면 시작됩니다';
      return '<button class="' + cls + '" onclick="go(\'' + x.k + '\')">' +
        '<div class="n">' + (open ? x.n : '🔒') + '</div>' +
        '<div class="tx"><div class="tt">' + esc(x.t) + '</div><div class="ds">' + esc(ds) + '</div></div>' +
        '<div class="st' + stc + '">' + st + '</div>' +
        '</button>';
    }).join('') +
    '<button class="menu-item' + (p.unlocked ? '' : ' locked') + '" onclick="go(\'materials\')">' +
      '<div class="n">' + (p.unlocked ? '★' : '🔒') + '</div>' +
      '<div class="tx"><div class="tt">연수 자료 안내</div>' +
      '<div class="ds">' + (p.unlocked ? 'PPT · 활동지 · 참고 자료' : '과제를 마치면 열립니다 (' + p.count + '/3)') + '</div></div>' +
      '<div class="st' + (p.unlocked ? ' done' : '') + '">' + (p.unlocked ? '열림' : p.count + '/3') + '</div>' +
    '</button>' +
    '</div>' +
    '<div class="hint" style="text-align:center;margin-top:16px">' +
      (both ? '실습 A·B를 <b>모두</b> 제출하셔야 자료가 열립니다.'
            : '실습은 <b>A · B 중 하나</b>만 하셔도 됩니다. 둘 다 하셔도 좋습니다.') +
    '</div>' +
    '<div style="text-align:center;margin-top:16px">' +
      '<button class="btn ghost sm" onclick="changeSession()">' + esc(ses().name) + ' · 연수 변경</button>' +
    '</div>' +
    '<div class="foot">2026 지학사 국어과 연수 · 박준일<br>' +
      '<a href="mailto:pblsketch@gmail.com">pblsketch@gmail.com</a></div>';

  m.forEach(function (x) { _menuPrevOpen[x.gate] = isOpen(x.gate); });

  var b = document.getElementById('mBody');
  if (b) b.innerHTML = html;
}

/* ═══════════════ 과제 대기 화면 ═══════════════ */
function waitScreen(title, gateKey, desc) {
  S.waitingFor = gateKey;
  app().innerHTML = header(title, 'menu') +
    '<div class="screen">' +
      '<div class="wait">' +
        '<div class="ic">⏳</div>' +
        '<h3>아직 열리지 않았습니다</h3>' +
        '<div class="dotline"><i></i><i></i><i></i></div>' +
        '<p>' + desc + '<br>진행자가 열면 <b>이 화면이 저절로 바뀝니다.</b><br>새로고침하지 않으셔도 됩니다.</p>' +
        '<button class="btn ghost" onclick="go(\'menu\')">메뉴로 돌아가기</button>' +
      '</div>' +
    '</div>';
}

/* ═══════════════ ③ OX 퀴즈 ═══════════════ */
var OXQ = null;

async function rOX() {
  if (!isOpen('open_ox')) { waitScreen('O · X 퀴즈', 'open_ox', '문장 세 개를 보고 사람이 썼는지 AI가 썼는지 고르는 활동입니다.'); return; }
  app().innerHTML = header('O · X 퀴즈', 'menu') + '<div class="screen"><div class="empty">불러오는 중…<div class="spinner" style="margin:18px auto"></div></div></div>';

  var d = await rpc('get_ox_questions', { p_ses: S.session });
  OXQ = d.questions || [];

  // 이미 제출했으면 결과로
  var mine = await sb().from('ox_responses').select('answers').eq('ses', S.session).eq('pid', S.me.id).maybeSingle();
  if (mine.data) { S.ox.ans = mine.data.answers || [null, null, null]; go('oxResult'); return; }

  S.ox = { i: 0, ans: [null, null, null] };
  drawOX();
}

function drawOX() {
  var q = OXQ[S.ox.i];
  app().innerHTML = header('O · X 퀴즈', 'menu') +
    '<div class="screen">' +
      '<div class="qcount">' + (S.ox.i + 1) + ' / ' + OXQ.length + '</div>' +
      '<div class="quote">' + esc(q.body) + '</div>' +
      '<div class="ox-row">' +
        '<button class="ox-btn o" onclick="pickOX(\'O\')"><div class="mk">O</div><div class="cp">AI가 썼다</div></button>' +
        '<button class="ox-btn x" onclick="pickOX(\'X\')"><div class="mk">X</div><div class="cp">사람이 썼다</div></button>' +
      '</div>' +
      (S.ox.i > 0 ? '<div style="height:18px"></div><button class="btn ghost sm" style="width:100%" onclick="backOX()">앞 문항으로</button>' : '') +
    '</div>';
}

function backOX() { if (S.ox.i > 0) { S.ox.i--; drawOX(); } }

async function pickOX(v) {
  S.ox.ans[S.ox.i] = v;
  if (S.ox.i < OXQ.length - 1) { S.ox.i++; drawOX(); return; }

  app().innerHTML = header('O · X 퀴즈') +
    '<div class="screen"><div class="empty">제출하는 중…<div class="spinner" style="margin:18px auto"></div></div></div>';

  try {
    var r = await rpc('submit_ox', { p_ses: S.session, p_pid: S.me.id, p_answers: S.ox.ans });
    if (!r.ok) { toast(r.msg || '제출에 실패했습니다.'); go('ox'); return; }
    go('oxResult');
  } catch (e) {
    toast('제출에 실패했습니다. 다시 시도해 주세요.');
    go('ox');
  }
}

function rOXResult() {
  app().innerHTML = header('모두의 응답', 'menu') + '<div class="screen" id="oxBody"><div class="empty">집계 중…</div></div>';
  watch(['ox_responses'], drawOXResultRefresh, 'ox-result');
}

async function drawOXResultRefresh() {
  var b = document.getElementById('oxBody');
  if (!b) return;
  var d  = await rpc('get_ox_questions', { p_ses: S.session });
  var rs = await sb().from('ox_responses').select('answers,score').eq('ses', S.session);
  var rows = rs.data || [];

  var qs = d.questions || [];
  var tally = qs.map(function () { return { O: 0, X: 0 }; });
  var scoreSum = 0;
  rows.forEach(function (r) {
    (r.answers || []).forEach(function (v, i) { if (tally[i] && (v === 'O' || v === 'X')) tally[i][v]++; });
    scoreSum += Number(r.score) || 0;
  });
  var total = rows.length;
  var avg = total ? scoreSum / total : 0;
  var mine = S.ox.ans;

  var bars = qs.map(function (q, i) {
    var t = tally[i] || { O: 0, X: 0 };
    var sum = (t.O + t.X) || 1;
    var po = Math.round(t.O / sum * 100), px = 100 - po;
    var right = d.reveal ? q.answer : null;

    return '<div class="bar-item">' +
      '<div class="bq"><b>' + (i + 1) + '.</b> ' + esc(q.body) +
        (right ? '<span class="badge">정답 ' + esc(right) + ' · ' + esc(q.label) + '</span>' : '') +
      '</div>' +
      '<div class="bar">' +
        (t.O ? '<span class="b-o" style="width:' + po + '%">O ' + po + '%</span>' : '') +
        (t.X ? '<span class="b-x" style="width:' + px + '%">X ' + px + '%</span>' : '') +
      '</div>' +
      '<div class="bar-legend"><span>O · AI가 썼다 (' + t.O + '명)</span><span>X · 사람이 썼다 (' + t.X + '명)</span></div>' +
      (d.reveal && q.note ? '<div class="hint" style="margin-top:9px">' + esc(q.note) + '</div>' : '') +
      (mine[i] ? '<div class="hint" style="margin-top:5px">내 답: <b>' + esc(mine[i]) + '</b>' +
        (right ? (mine[i] === right ? ' <span class="ok">맞음</span>' : ' <span class="no">틀림</span>') : '') + '</div>' : '') +
      '</div>';
  }).join('');

  var panel = '';
  if (d.reveal && d.panel) {
    panel = '<div class="section-t">방송 패널 성적표 · MBC 「손석희의 12시」</div>' +
      '<div class="card flat"><table class="panel">' +
      '<tr><th></th><th>1번</th><th>2번</th><th>3번</th><th>합계</th></tr>' +
      d.panel.map(function (p) {
        return '<tr><td class="nm">' + esc(p.name) + '<small>' + esc(p.descr) + '</small></td>' +
          p.picks.map(function (pk, i) {
            var correct = qs[i] ? qs[i].answer : null;
            return '<td>' + esc(pk) + ' <span class="' + (pk === correct ? 'ok' : 'no') + '">' + (pk === correct ? '✓' : '✗') + '</span></td>';
          }).join('') +
          '<td><b>' + esc(p.score) + '</b></td></tr>';
      }).join('') +
      '</table></div>' +
      '<div class="hint" style="text-align:center;margin-top:12px">AI를 가장 잘 아는 사람도 1/3이었습니다.</div>';
  }

  b.innerHTML =
    '<div class="card blue" style="text-align:center">' +
      '<div style="font-family:\'Noto Serif KR\',serif;font-size:31px;line-height:1.1">' + total + '<span style="font-size:16px">명</span></div>' +
      '<div class="hint" style="margin-top:4px">참여 · <span class="live"><i></i>실시간</span></div>' +
      (d.reveal ? '<div class="hint" style="margin-top:8px">평균 <b>' + avg.toFixed(1) + ' / 3</b></div>' : '') +
    '</div>' +
    '<div class="bars">' + bars + '</div>' +
    panel +
    (!d.reveal ? '<div class="hint" style="text-align:center;margin-top:20px">정답은 잠시 후 함께 확인합니다.</div>' : '') +
    '<div class="sticky-b"><button class="btn" onclick="go(\'menu\')">메뉴로 돌아가기</button></div>';
}

/* ═══════════════ ④ AI 허용 단계 실습 (A · B) ═══════════════ */
function saveDraft() {
  try { localStorage.setItem(KEY_D, JSON.stringify(S.pr)); } catch (e) {}
}
function loadDraft() {
  try {
    var d = JSON.parse(localStorage.getItem(KEY_D) || '{}');
    S.pr = { A: d.A || {}, B: d.B || {} };
  } catch (e) { S.pr = { A: {}, B: {} }; }
}

async function rPractice(code) {
  var gate = code === 'A' ? 'open_a' : 'open_b';
  var def = sheetDefOf(code);
  if (!isOpen(gate)) {
    waitScreen('실습 ' + code + ' · ' + def.title, gate,
      '「' + esc(def.book) + '」 ' + def.items.length + '개 활동에 AI 허용 단계를 매기는 실습입니다.');
    return;
  }

  // 기존 제출이 있으면 불러와서 채워 둡니다
  var mine = await sb().from('practice_responses')
    .select('res').eq('ses', S.session).eq('pid', S.me.id).eq('code', code).maybeSingle();
  if (mine.data && mine.data.res && Object.keys(S.pr[code] || {}).length === 0) {
    S.pr[code] = mine.data.res;
  }

  drawPracticeForm(code, !!mine.data);
}

function drawPracticeForm(code, resubmit) {
  var def = sheetDefOf(code);
  var c = window.CRITERIA;
  var ex = window.EXAMPLE;

  var body = '';
  def.items.forEach(function (it) {
    if (it.sec) body += '<div class="sec-label">' + esc(it.sec) + '</div>';
    body += itemHTML(code, it);
  });

  app().innerHTML = header('실습 ' + code + ' · ' + def.title, 'menu') +
    '<div class="screen">' +

      '<div class="goal-box">' +
        '<div class="lb">' + (def.code === 'A' ? '학습 목표' : '활동 목표') + '</div>' +
        '<div class="src">' + esc(def.goalSrc) +
          (def.goalTb
            ? ' <button class="pgbtn sm" onclick="openTB(\'' + def.code + '\',' + def.goalTb + ')">' +
                '<span class="bk">📖</span>보기</button>'
            : '') + '</div>' +
        '<ul>' + def.goals.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul>' +
      '</div>' +

      '<div class="crit">' +
        '<div class="q">' + esc(c.question) + '</div>' +
        '<ol>' + c.rules.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ol>' +
        '<div class="rule">' + esc(c.common) + '</div>' +
      '</div>' +

      '<div class="ex">' +
        '<div class="lb">기입 예시</div>' +
        '<div class="rowline">' + esc(ex.act) + ' → 외주화 위험 <b>' + esc(ex.risk) + '</b> · ' +
        '허용 단계 <b>' + ex.stage + '</b> · 장치 <b>' + esc(ex.memo) + '</b></div>' +
      '</div>' +

      tbAllHTML(code) +

      '<div class="hint" style="margin-bottom:14px">활동 하나마다 세 칸을 채웁니다. 막히면 넘어가셔도 됩니다.<br>' +
      '<b>정답이 있는 활동이 아닙니다.</b> 허용 단계는 수업 목표에 따라 달라지는 게 정상입니다.</div>' +

      '<div id="items">' + body + '</div>' +
      '<div class="save-note">입력하신 내용은 이 기기에 자동 저장됩니다.</div>' +
      '<div class="sticky-b"><button class="btn" onclick="submitPractice(\'' + code + '\')">' +
        (resubmit ? '수정해서 다시 제출하기' : '제출하고 다른 선생님 보기') + '</button></div>' +
    '</div>';
  restorePr(code);
}

function itemHTML(code, it) {
  var id = 'i' + code + it.no;
  return '<div class="item" id="' + id + '">' +
    '<div class="item-h">' +
      '<div class="no">' + it.no + '</div>' +
      '<div class="nm">' + it.name +
        (it.tb && it.tb.length
          ? '<button class="pgbtn" onclick="openTB(\'' + code + '\',' + it.tb[0] + ')">' +
              '<span class="bk">📖</span>' + esc(it.page) + ' 교과서 보기</button>'
          : '<div class="pg">' + esc(it.page) + '</div>') +
      '</div>' +
    '</div>' +
    '<div class="sub-label">외주화 위험 · 지시문을 그대로 AI에 넣으면 3분 안에 나오는가?</div>' +
    '<div class="seg risk">' +
      ['상', '중', '하'].map(function (v) {
        return '<button data-v="' + v + '" onclick="setRisk(\'' + code + '\',' + it.no + ',\'' + v + '\',this)">' + v + '</button>';
      }).join('') +
    '</div>' +
    '<div class="sub-label">AI 허용 단계 · 나라면 몇 단계로 열까?</div>' +
    '<div class="seg stage">' +
      window.AI_STAGES.map(function (s) {
        return '<button data-v="' + s.n + '" onclick="setStage(\'' + code + '\',' + it.no + ',' + s.n + ',this)">' +
          '<b>' + s.n + '</b><small>' + esc(s.name).replace(' ', '<br>') + '</small></button>';
      }).join('') +
    '</div>' +
    '<div class="sub-label">배움을 지키는 장치 · 학생이 직접 하게 만들 방법 한 줄</div>' +
    '<input type="text" placeholder="예) 출처 링크 기록 의무" maxlength="60" ' +
      'oninput="setMemo(\'' + code + '\',' + it.no + ',this.value)">' +
    '</div>';
}

function cellOf(code, no) {
  if (!S.pr[code]) S.pr[code] = {};
  if (!S.pr[code][no]) S.pr[code][no] = { risk: '', stage: '', memo: '' };
  return S.pr[code][no];
}
function setRisk(code, no, v, el) {
  cellOf(code, no).risk = v;
  var p = el.parentNode.querySelectorAll('button');
  for (var i = 0; i < p.length; i++) p[i].classList.remove('on');
  el.classList.add('on');
  saveDraft();
}
function setStage(code, no, v, el) {
  cellOf(code, no).stage = v;
  var p = el.parentNode.querySelectorAll('button');
  for (var i = 0; i < p.length; i++) p[i].classList.remove('on');
  el.classList.add('on');
  saveDraft();
}
function setMemo(code, no, v) { cellOf(code, no).memo = v; saveDraft(); }

function restorePr(code) {
  Object.keys(S.pr[code] || {}).forEach(function (no) {
    var box = document.getElementById('i' + code + no);
    if (!box) return;
    var v = S.pr[code][no] || {};
    if (v.risk) {
      var rb = box.querySelector('.seg.risk button[data-v="' + v.risk + '"]');
      if (rb) rb.classList.add('on');
    }
    if (v.stage) {
      var sbn = box.querySelector('.seg.stage button[data-v="' + v.stage + '"]');
      if (sbn) sbn.classList.add('on');
    }
    if (v.memo) {
      var ip = box.querySelector('input[type=text]');
      if (ip) ip.value = v.memo;
    }
  });
}

async function submitPractice(code) {
  var res = S.pr[code] || {};
  var filled = Object.keys(res).filter(function (k) {
    var v = res[k] || {};
    return v.risk || v.stage || (v.memo && String(v.memo).trim());
  });
  if (!filled.length) { toast('적어도 한 항목은 채워 주세요.'); return; }

  toast('제출하는 중…');
  try {
    var r = await rpc('submit_practice', { p_ses: S.session, p_pid: S.me.id, p_code: code, p_res: res });
    if (!r.ok) { toast(r.msg || '제출에 실패했습니다.'); return; }
    go(code === 'A' ? 'practiceFeedA' : 'practiceFeedB');
  } catch (e) {
    toast('제출에 실패했습니다. 다시 시도해 주세요.');
  }
}

function rPracticeFeed(code) {
  var def = sheetDefOf(code);
  app().innerHTML = header('선생님들의 판단 · ' + code, 'menu') +
    '<div class="screen" id="pfBody"><div class="empty">불러오는 중…</div></div>';
  watch(['practice_responses'], function () { drawPracticeFeed(code); }, 'pf-' + code);
}

async function drawPracticeFeed(code) {
  var el = document.getElementById('pfBody');
  if (!el) return;
  var r = await sb().from('practice_responses').select('name,res,filled,created_at')
    .eq('ses', S.session).eq('code', code).order('created_at', { ascending: false }).limit(80);
  var feed = r.data || [];
  var def = sheetDefOf(code);

  var body = !feed.length
    ? '<div class="empty">아직 제출한 분이 없습니다.</div>'
    : feed.map(function (f) {
        var rows = Object.keys(f.res || {}).sort(function (a, b) { return a - b; }).map(function (no) {
          var v = f.res[no] || {};
          if (!v.risk && !v.stage && !String(v.memo || '').trim()) return '';
          var item = def.items.filter(function (x) { return String(x.no) === String(no); })[0];
          return '<tr><td>' + esc(no) + '</td>' +
            '<td>' + (item ? item.name : '') + '</td>' +
            '<td class="rk">' + esc(v.risk || '·') + '</td>' +
            '<td class="sg">' + esc(v.stage || '·') + '</td></tr>' +
            (String(v.memo || '').trim()
              ? '<tr><td></td><td colspan="3" style="color:var(--ink-soft);padding-top:0">↳ ' + esc(v.memo) + '</td></tr>' : '');
        }).join('');

        return '<div class="detail' + (f.name === S.me.name ? ' mine' : '') + '">' +
          '<div class="hd"><div class="nm">' + esc(f.name) + '</div>' +
          '<div class="cd">실습지 ' + esc(code) + '</div></div>' +
          '<table>' + rows + '</table></div>';
      }).join('');

  el.innerHTML =
    '<div class="card blue" style="text-align:center">' +
      '<div style="font-family:\'Noto Serif KR\',serif;font-size:31px;line-height:1.1">' + feed.length + '<span style="font-size:16px">명</span></div>' +
      '<div class="hint" style="margin-top:4px">제출 · <span class="live"><i></i>실시간</span></div>' +
    '</div>' +
    '<div class="hint" style="margin:16px 0 12px">판단이 갈린 활동이 보이면, 옆자리 선생님과 근거를 나눠 보세요.</div>' +
    body +
    '<div class="sticky-b"><button class="btn" onclick="go(\'menu\')">메뉴로 돌아가기</button></div>';
}

/* ═══════════════ ⑤ 오늘의 한 문장 ═══════════════ */
async function rSentence() {
  if (!isOpen('open_sentence')) {
    waitScreen('오늘의 한 문장', 'open_sentence', '오늘 연수를 한 문장으로 정리하는 활동입니다.');
    return;
  }
  var s = window.SENTENCE_PROMPT;
  var mine = await sb().from('sentences').select('body').eq('ses', S.session).eq('pid', S.me.id).maybeSingle();
  var prev = mine.data ? mine.data.body : '';

  app().innerHTML = header('오늘의 한 문장', 'menu') +
    '<div class="screen">' +
      '<div class="fill">' + esc(s.before) + ' <span class="blank' + (prev ? '' : ' empty') + '" id="pv">' + esc(prev) + '</span> ' + esc(s.after) + '</div>' +
      '<div class="field">' +
        '<textarea id="sn" rows="2" maxlength="60" placeholder="예) 초고를 손으로 작성">' + esc(prev) + '</textarea>' +
        '<div class="hint">짧아도 좋습니다. 위 문장에 이어 읽히도록 <b>“~하”로 끝나게</b> 적어 주세요.<br>예) 출처를 직접 확인 · 짝에게 먼저 설명 · 초고를 손으로 작성</div>' +
      '</div>' +
      '<button class="btn" onclick="submitSentence()">' + (prev ? '수정해서 다시 제출하기' : '제출하고 모두의 문장 보기') + '</button>' +
    '</div>';

  var ta = document.getElementById('sn');
  ta.addEventListener('input', function () {
    var pv = document.getElementById('pv');
    if (ta.value.trim()) { pv.textContent = ta.value.trim(); pv.classList.remove('empty'); }
    else { pv.textContent = ''; pv.classList.add('empty'); }
  });
  ta.focus();
}

async function submitSentence() {
  var t = ((document.getElementById('sn') || {}).value || '').trim();
  if (t.length < 2) { toast('조금만 더 구체적으로 적어 주세요.'); return; }
  toast('제출하는 중…');
  try {
    var r = await rpc('submit_sentence', { p_ses: S.session, p_pid: S.me.id, p_body: t });
    if (!r.ok) { toast(r.msg || '제출에 실패했습니다.'); return; }
    go('sentenceFeed');
  } catch (e) {
    toast('제출에 실패했습니다. 다시 시도해 주세요.');
  }
}

function rSentenceFeed() {
  app().innerHTML = header('모두의 한 문장', 'menu') + '<div class="screen" id="snBody"><div class="empty">불러오는 중…</div></div>';
  watch(['sentences'], drawSentenceFeed, 'sn-feed');
}

async function drawSentenceFeed() {
  var el = document.getElementById('snBody');
  if (!el) return;
  var s = window.SENTENCE_PROMPT;
  var r = await sb().from('sentences').select('name,body,created_at')
    .eq('ses', S.session).order('created_at', { ascending: false }).limit(100);
  var feed = r.data || [];

  el.innerHTML =
    '<div class="card blue" style="text-align:center">' +
      '<div style="font-family:\'Noto Serif KR\',serif;font-size:31px;line-height:1.1">' + feed.length + '<span style="font-size:16px">개</span></div>' +
      '<div class="hint" style="margin-top:4px">문장 · <span class="live"><i></i>실시간</span></div>' +
    '</div>' +
    '<div class="stream">' +
      (!feed.length ? '<div class="empty">아직 제출한 분이 없습니다.</div>' :
        feed.map(function (f) {
          return '<div class="stream-item' + (f.name === S.me.name ? ' mine' : '') + '">' +
            '<div class="nm">' + esc(f.name) + '</div>' +
            '<div class="tx">' + esc(s.before) + ' <b>' + esc(f.body) + '</b> ' + esc(s.after) + '</div>' +
            '</div>';
        }).join('')) +
    '</div>' +
    '<div class="sticky-b"><button class="btn" onclick="go(\'menu\')">메뉴로 돌아가기</button></div>';
}

/* ═══════════════ ⑥ 자료 안내 ═══════════════ */
async function rMaterials() {
  app().innerHTML = header('연수 자료 안내', 'menu') + '<div class="screen" id="mtBody"><div class="empty">확인 중…</div></div>';

  var p = await myProgress();
  var el = document.getElementById('mtBody');
  if (!el) return;

  if (!p.unlocked) {
    var both = S.cfg.require_both === 'Y';
    el.innerHTML =
      '<div class="lock">' +
        '<div class="ic">🔒</div>' +
        '<h3>과제를 마치면 열립니다</h3>' +
        '<p>남은 활동을 마치시면<br>연수 자료를 모두 받으실 수 있습니다.</p>' +
        '<div class="check-list">' +
          ck('O · X 퀴즈', p.done.ox) +
          (both ? ck('실습 A · 나의 미래 일기', p.done.A) + ck('실습 B · 학술 연구 포스터', p.done.B)
                : ck('AI 허용 단계 실습 (A 또는 B)', p.done.practice)) +
          ck('오늘의 한 문장', p.done.sentence) +
        '</div>' +
        '<div style="height:26px"></div>' +
        '<button class="btn" onclick="go(\'menu\')">활동 이어서 하기</button>' +
      '</div>';
    return;
  }

  var r = await sb().from('materials').select('*').or('ses.eq.' + S.session + ',ses.is.null').order('ord');
  var list = r.data || [];
  var mats  = list.filter(function (x) { return x.kind !== '도구'; });
  var tools = list.filter(function (x) { return x.kind === '도구'; });

  function card(m, icon) {
    if (!m.url) {
      return '<div class="mat soon"><div class="ic">⏳</div><div class="tx">' +
        '<div class="tt">' + esc(m.title) + '</div>' +
        '<div class="ds">' + esc(m.descr) + ' · 준비 중</div></div></div>';
    }
    var host = '';
    try { host = m.url.replace(/^https?:\/\//, '').replace(/\/.*$/, ''); } catch (e) {}
    return '<a class="mat" href="' + esc(m.url) + '" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">' +
      '<div class="ic">' + icon + '</div><div class="tx">' +
      '<div class="tt">' + esc(m.title) + '</div>' +
      '<div class="ds">' + esc(m.descr) + '</div>' +
      (icon === '🧰' ? '<div class="host">' + esc(host) + '</div>' : '') +
      '</div><div class="go">›</div></a>';
  }

  el.innerHTML =
    '<div class="card blue" style="text-align:center">' +
      '<div style="font-family:\'Noto Serif KR\',serif;font-size:19px">수고하셨습니다</div>' +
      '<div class="hint" style="margin-top:6px">오늘 나눈 자료를 모두 담았습니다.</div>' +
    '</div>' +
    (mats.length ? '<div class="section-t">연수 자료</div>' + mats.map(function (m) { return card(m, '📁'); }).join('') : '') +
    (tools.length ? '<div class="section-t">제가 만든 도구</div>' +
      '<div class="hint" style="margin:-4px 0 12px">교실에서 바로 쓰실 수 있게 만든 것들입니다. 무료입니다.</div>' +
      tools.map(function (m) { return card(m, '🧰'); }).join('') : '') +
    '<div class="foot">2026 지학사 국어과 연수 · 박준일<br>' +
      '궁금한 점은 <a href="mailto:pblsketch@gmail.com">pblsketch@gmail.com</a></div>';
}

function ck(label, on) {
  return '<div><span class="c' + (on ? ' on' : '') + '">✓</span>' + esc(label) + '</div>';
}

/* ═══════════════ 교과서 보기 ═══════════════
   문항의 쪽수를 누르면 그 쪽을 전체 화면으로 펼친다.
   실습 입력을 잃지 않도록 화면 전환이 아니라 오버레이로 띄운다. */

var TB = { code: null, i: 0, scale: 1, on: false, pushed: false, pf: {} };
var TB_MAX = 4;      // 폭 맞춤의 4배까지. 390px 화면에서 1560px — 원본 1693px보다 작아 흐려지지 않는다
var TB_STEP = 2;     // 「확대」 버튼 한 번에 가는 배율 (두 손가락이 어려운 분을 위한 길)

function tbPages(code) { return ((window.TEXTBOOK || {})[code] || {}).pages || []; }

function tbAllHTML(code) {
  var bk = (window.TEXTBOOK || {})[code];
  var pages = tbPages(code);
  if (!bk || !pages.length) return '';
  return '<button class="tb-all" onclick="openTB(\'' + code + '\',' + pages[0] + ')">' +
    '<span class="bk">📖</span>' +
    '<span class="tx">「' + esc(bk.book) + '」 해당 쪽 펼쳐 보기' +
      '<small>' + pages[0] + '~' + pages[pages.length - 1] + '쪽 중 ' + pages.length + '장</small></span>' +
    '<span class="go">›</span></button>';
}

function openTB(code, page) {
  var pages = tbPages(code);
  if (!pages.length) return;
  var i = pages.indexOf(page);
  TB.code = code;
  TB.i = i < 0 ? 0 : i;
  TB.scale = 1;
  if (!TB.on) {
    TB.on = true;
    document.body.classList.add('tb-on');
    document.getElementById('tbv').hidden = false;
    try { history.pushState({ tb: 1 }, ''); TB.pushed = true; }
    catch (e) { TB.pushed = false; }
  }
  drawTB();
  tbPrefetch(code);
  if (!TB.hinted) { TB.hinted = true; toast('두 손가락으로 벌리면 크게 볼 수 있습니다.'); }
}

function closeTB(fromPop) {
  if (!TB.on) return;
  TB.on = false;
  document.body.classList.remove('tb-on');
  var el = document.getElementById('tbv');
  el.hidden = true;
  el.innerHTML = '';
  var pushed = TB.pushed;
  TB.pushed = false;
  if (!fromPop && pushed) history.back();
}

function drawTB() {
  var code = TB.code;
  var bk = window.TEXTBOOK[code];
  var pages = tbPages(code);
  var n = pages[TB.i];
  document.getElementById('tbv').innerHTML =
    '<div class="tbv-bar">' +
      '<button class="x" onclick="closeTB()" aria-label="닫기">✕</button>' +
      '<div class="tt">「' + esc(bk.book) + '」 <b>' + n + '쪽</b></div>' +
      '<button class="z" onclick="tbZoom()">' + (TB.scale > 1.02 ? '원래대로' : '확대') + '</button>' +
    '</div>' +
    '<div class="tbv-scroll" id="tbvSc">' +
      '<img id="tbvImg" src="' + tbSrc(code, n) + '" style="width:' + (TB.scale * 100) + '%" ' +
        'alt="「' + esc(bk.book) + '」 ' + n + '쪽">' +
    '</div>' +
    '<div class="tbv-nav">' +
      '<button ' + (TB.i === 0 ? 'disabled' : '') + ' onclick="tbGo(-1)">‹ 이전 쪽</button>' +
      '<span>' + (TB.i + 1) + ' / ' + pages.length + '</span>' +
      '<button ' + (TB.i === pages.length - 1 ? 'disabled' : '') + ' onclick="tbGo(1)">다음 쪽 ›</button>' +
    '</div>';
  tbBindTouch();
}

function tbGo(d) {
  var i = TB.i + d;
  if (i < 0 || i >= tbPages(TB.code).length) return;
  TB.i = i;
  drawTB();
}

/* 배율을 바꾸되, 기준점(ax·ay, 화면 좌표)이 화면에서 움직이지 않도록 스크롤을 되맞춘다.
   기준점을 안 주면 화면 한가운데를 잡는다. */
function tbSetScale(scale, ax, ay) {
  var sc = document.getElementById('tbvSc');
  var img = document.getElementById('tbvImg');
  if (!sc || !img) return;

  scale = Math.min(TB_MAX, Math.max(1, scale));

  var r = sc.getBoundingClientRect();
  var px = (ax == null ? sc.clientWidth / 2 : ax - r.left);
  var py = (ay == null ? sc.clientHeight / 2 : ay - r.top);
  var fx = (sc.scrollLeft + px) / Math.max(1, img.offsetWidth);
  var fy = (sc.scrollTop + py) / Math.max(1, img.offsetHeight);

  TB.scale = scale;
  img.classList.remove('pinching');
  img.style.transform = '';
  img.style.transformOrigin = '';
  img.style.width = (scale * 100) + '%';

  var b = document.querySelector('#tbv .tbv-bar .z');
  if (b) b.textContent = (scale > 1.02 ? '원래대로' : '확대');

  requestAnimationFrame(function () {
    sc.scrollLeft = fx * img.offsetWidth - px;
    sc.scrollTop = fy * img.offsetHeight - py;
  });
}

/* 한 손으로 쓰실 때를 위한 버튼. 두 손가락으로도 같은 일을 할 수 있다. */
function tbZoom() {
  tbSetScale(TB.scale > 1.02 ? 1 : TB_STEP);
}

/* 두 손가락으로 벌리고 오므려 확대·축소.
   제스처 중에는 transform 으로만 그린다 — 레이아웃을 건드리지 않아 손가락을 따라온다.
   손을 떼는 순간 실제 width 로 굳혀서 그때부터 정상 스크롤이 되게 한다. */
function tbBindTouch() {
  var sc = document.getElementById('tbvSc');
  var img = document.getElementById('tbvImg');
  if (!sc || !img) return;

  var pinch = null;    // 확대 중인 제스처
  var swipe = null;    // 한 손가락으로 미는 중
  var multi = false;   // 이번 터치에 손가락이 둘 이상 닿은 적이 있는가

  function gap(t) {
    var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy) || 1;
  }

  sc.addEventListener('touchstart', function (e) {
    if (e.touches.length >= 2) {
      multi = true;
      swipe = null;
      var r = sc.getBoundingClientRect();
      var px = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
      var py = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
      // 두 손가락 사이의 지점을 축으로 삼는다 — 그 자리가 화면에서 안 움직인다
      pinch = { d0: gap(e.touches), s0: TB.scale, live: TB.scale, px: px, py: py };
      img.style.transformOrigin = (sc.scrollLeft + px) + 'px ' + (sc.scrollTop + py) + 'px';
      img.classList.add('pinching');
      return;
    }
    if (multi) return;
    swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });

  sc.addEventListener('touchmove', function (e) {
    if (!pinch || e.touches.length < 2) return;
    e.preventDefault();                        // 브라우저 기본 동작이 끼어들지 않게
    pinch.live = Math.min(TB_MAX, Math.max(1, pinch.s0 * gap(e.touches) / pinch.d0));
    img.style.transform = 'scale(' + (pinch.live / pinch.s0) + ')';
  }, { passive: false });

  sc.addEventListener('touchend', function (e) {
    if (pinch && e.touches.length < 2) {
      var r = sc.getBoundingClientRect();
      var live = pinch.live, px = pinch.px, py = pinch.py;
      pinch = null;
      tbSetScale(live, r.left + px, r.top + py);
    }
    if (e.touches.length) return;

    // 폭 맞춤 상태에서는 가로로 남는 여백이 없으니 좌우로 미는 건 쪽 넘김으로 받는다
    if (!multi && swipe && TB.scale <= 1.02) {
      var t = e.changedTouches[0];
      var dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8) tbGo(dx < 0 ? 1 : -1);
    }
    multi = false;
    swipe = null;
  }, { passive: true });

  sc.addEventListener('touchcancel', function () {
    pinch = null; swipe = null; multi = false;
    img.classList.remove('pinching');
    img.style.transform = '';
    img.style.transformOrigin = '';
  }, { passive: true });

  // 아이폰 사파리가 자기 확대로 가로채지 않게
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (n) {
    sc.addEventListener(n, function (ev) { ev.preventDefault(); });
  });

  // 마우스 휠 + Ctrl — 강사가 PC로 띄워 볼 때
  sc.addEventListener('wheel', function (e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    tbSetScale(TB.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY);
  }, { passive: false });
}

/* 첫 열람 뒤에 나머지 쪽을 미리 받아 둔다 (연수장 와이파이 대비) */
function tbPrefetch(code) {
  if (TB.pf[code]) return;
  TB.pf[code] = true;
  setTimeout(function () {
    tbPages(code).forEach(function (n) { new Image().src = tbSrc(code, n); });
  }, 700);
}

window.addEventListener('popstate', function () { if (TB.on) closeTB(true); });

window.addEventListener('keydown', function (e) {
  if (!TB.on) return;
  if (e.key === 'Escape') closeTB();
  else if (e.key === 'ArrowLeft') tbGo(-1);
  else if (e.key === 'ArrowRight') tbGo(1);
});

/* ═══════════════ ⑦ 관리자 · PC 대시보드 ═══════════════ */

var GATES = [
  { key: 'open_ox',       n: '①', t: 'O · X 퀴즈',   d: '사람일까, AI일까? · 3문항',       board: 'ox', field: 'ox', s: 'OX 퀴즈' },
  { key: 'open_a',        n: '②', t: '실습 A',       d: '나의 미래 일기 · 활동 9개',       board: 'a',  field: 'A',  s: '실습 A'  },
  { key: 'open_b',        n: '③', t: '실습 B',       d: '학술 연구 포스터 · 활동 7개',     board: 'b',  field: 'B',  s: '실습 B'  },
  { key: 'open_sentence', n: '④', t: '오늘의 한 문장', d: '나는 학생에게 AI를 맡기기 전에…', board: 'sn', field: 'sn', s: '한 문장' }
];

function rAdmin() {
  var q = '?ses=' + encodeURIComponent(S.session);
  app().innerHTML =
    '<div class="adm">' +
      '<div class="adm-bar">' +
        '<div class="tt">' + esc(ses().name) + '</div>' +
        '<div class="sb">2026 지학사 국어과 연수 · 관리자</div>' +
        '<div class="kpi" id="admKpi"></div>' +
        '<div class="sp"></div>' +
        '<div class="bl">' +
          '<span class="bl-lb">모니터에 띄우기</span>' +
          GATES.map(function (g) {
            return '<a href="board.html' + q + '#' + g.board + '" target="_blank">' +
              g.n + ' ' + esc(g.s) + '</a>';
          }).join('') +
          '<a href="board.html' + q + '#status" target="_blank" class="alt">제출 현황</a>' +
        '</div>' +
        '<button class="btn ghost sm" onclick="changeSession()">연수 전환</button>' +
      '</div>' +

      '<div class="adm-lead">활동을 시작할 때 아래 카드의 스위치를 켜면, <b>선생님들 화면이 저절로 바뀝니다.</b> 새로고침 안내는 필요 없습니다.</div>' +
      '<div class="adm-gates" id="admGates"></div>' +

      '<div class="adm-grid">' +
        '<section class="pan"><div class="pan-h">공개 제어</div><div id="admCtrl"></div></section>' +
        '<section class="pan"><div class="pan-h">참가자 <span id="admPeopleN"></span><span class="live"><i></i>실시간</span></div>' +
          '<div class="pan-scroll" id="admPeople"></div></section>' +
        '<section class="pan"><div class="pan-h">지금 들어온 응답</div>' +
          '<div class="peek-tabs" id="admPeekTabs"></div>' +
          '<div class="pan-scroll" id="admPeek"></div></section>' +
      '</div>' +
      '<div class="foot">관리자 · 박준일</div>' +
    '</div>';

  watch(['participants', 'ox_responses', 'practice_responses', 'sentences'], loadAdminData, 'admin');
}

/** 한 번에 다 받아 와서 화면 전체를 다시 그립니다 */
async function loadAdminData() {
  if (S.screen !== 'admin') return;
  var q = await Promise.all([
    sb().from('participants').select('id,name,last_seen').eq('ses', S.session).order('last_seen', { ascending: false }),
    sb().from('ox_responses').select('pid,score,answers').eq('ses', S.session),
    sb().from('practice_responses').select('pid,name,code,res,filled,created_at').eq('ses', S.session).order('created_at', { ascending: false }),
    sb().from('sentences').select('pid,name,body,created_at').eq('ses', S.session).order('created_at', { ascending: false })
  ]);

  var people = q[0].data || [];
  var ox = {}, pr = {}, sn = {};
  (q[1].data || []).forEach(function (r) { ox[r.pid] = r; });
  (q[2].data || []).forEach(function (r) { (pr[r.pid] = pr[r.pid] || {})[r.code] = r; });
  (q[3].data || []).forEach(function (r) { sn[r.pid] = r; });

  S.admData = {
    people: people, ox: ox, pr: pr, sn: sn,
    practice: q[2].data || [], sentences: q[3].data || []
  };
  renderAdmin();
}

/** 설정이 바뀌었을 때도 불립니다 (데이터는 다시 안 받아 옴) */
function renderAdmin() {
  if (S.screen !== 'admin') return;
  var d = S.admData;
  if (!d) return;

  var both = S.cfg.require_both === 'Y';
  var N = d.people.length;
  var cnt = { ox: 0, A: 0, B: 0, sn: 0 }, doneAll = 0;
  d.people.forEach(function (p) {
    var x = d.pr[p.id] || {};
    if (d.ox[p.id]) cnt.ox++;
    if (x.A) cnt.A++;
    if (x.B) cnt.B++;
    if (d.sn[p.id]) cnt.sn++;
    var prOk = both ? (x.A && x.B) : (x.A || x.B);
    if (d.ox[p.id] && prOk && d.sn[p.id]) doneAll++;
  });

  // ── 상단 지표
  document.getElementById('admKpi').innerHTML =
    '<span class="v">' + N + '</span><span class="k">명 접속</span>' +
    '<span class="dot"></span>' +
    '<span class="v done">' + doneAll + '</span><span class="k">명 모두 완료</span>';

  // ── 과제 카드 4개 (제어 + 현황을 한 덩어리로)
  var qs = '?ses=' + encodeURIComponent(S.session);
  document.getElementById('admGates').innerHTML = GATES.map(function (g) {
    var on = isOpen(g.key);
    var c = cnt[g.field];
    var pct = N ? Math.round(c / N * 100) : 0;
    return '<div class="gcard' + (on ? ' on' : '') + '">' +
      '<div class="gh"><span class="gn">' + g.n + '</span>' +
        '<span class="gt">' + esc(g.t) + '</span>' +
        '<span class="gstate">' + (on ? '열림' : '닫힘') + '</span></div>' +
      '<div class="gd">' + esc(g.d) + '</div>' +
      '<div class="gnum">' + c + '<small> / ' + N + '명</small></div>' +
      '<div class="gtrack"><i style="width:' + pct + '%"></i></div>' +
      '<div class="gfoot">' +
        '<div class="sw' + (on ? ' on' : '') + '" onclick="setCfg(\'' + g.key + '\',\'' + (on ? 'N' : 'Y') + '\')"></div>' +
        '<span class="glb">' + (on ? '켜짐 · 누르면 닫힘' : '꺼짐 · 누르면 열림') + '</span>' +
        '<a class="gboard" href="board.html' + qs + '#' + g.board + '" target="_blank">현황판 ↗</a>' +
      '</div>' +
      '</div>';
  }).join('');

  // ── 공개 제어
  function tg(key, title, desc) {
    var on = isOpen(key);
    return '<div class="toggle gate' + (on ? ' on' : '') + '">' +
      '<div class="tx"><div class="tt">' + esc(title) + '</div><div class="ds">' + esc(desc) + '</div></div>' +
      '<div class="sw' + (on ? ' on' : '') + '" onclick="setCfg(\'' + key + '\',\'' + (on ? 'N' : 'Y') + '\')"></div>' +
      '</div>';
  }
  document.getElementById('admCtrl').innerHTML =
    tg('ox_reveal',      'OX 정답 공개',        '참가자 화면과 현황판에 정답·방송 패널 성적표가 함께 뜹니다') +
    tg('materials_open', '자료 전체 공개',      '과제를 다 안 해도 자료 페이지가 열립니다') +
    tg('require_both',   '실습 A·B 둘 다 필수', '꺼두면 A 또는 B 하나만 내도 자료가 열립니다') +
    '<div class="pan-h" style="margin-top:22px">위험 구역</div>' +
    '<button class="btn danger" onclick="doReset()">응답 모두 비우기</button>' +
    '<div class="hint" style="text-align:center">리허설 기록 정리용입니다.<br>다른 연수 데이터는 그대로 둡니다.</div>';

  // ── 참가자 표
  document.getElementById('admPeopleN').textContent = N + '명';
  document.getElementById('admPeople').innerHTML = !N
    ? '<div class="empty">아직 접속한 분이 없습니다.</div>'
    : '<table class="ptable"><thead><tr><th>이름</th><th>OX</th><th>A</th><th>B</th><th>문장</th></tr></thead><tbody>' +
      d.people.map(function (p) {
        var x = d.pr[p.id] || {};
        var prOk = both ? (x.A && x.B) : (x.A || x.B);
        var all = d.ox[p.id] && prOk && d.sn[p.id];
        var mk = function (v) { return v ? '<td class="y">✓</td>' : '<td class="n">·</td>'; };
        return '<tr class="' + (all ? 'all' : '') + '">' +
          '<td class="nm">' + esc(p.name) + '</td>' +
          '<td class="' + (d.ox[p.id] ? 'y' : 'n') + '">' + (d.ox[p.id] ? d.ox[p.id].score + '/3' : '·') + '</td>' +
          mk(x.A) + mk(x.B) + mk(d.sn[p.id]) +
          '</tr>';
      }).join('') + '</tbody></table>';

  // ── 응답 훑어보기
  document.getElementById('admPeekTabs').innerHTML = [
    ['sn', '한 문장', cnt.sn], ['A', '실습 A', cnt.A], ['B', '실습 B', cnt.B]
  ].map(function (x) {
    return '<button class="' + (S.admPeek === x[0] ? 'on' : '') + '" onclick="setPeek(\'' + x[0] + '\')">' +
      x[1] + '<em>' + x[2] + '</em></button>';
  }).join('');
  renderPeek();
}

function setPeek(k) { S.admPeek = k; renderAdmin(); }

/** 강의 중 인용할 수 있게 응답 「원문」을 보여 줍니다 */
function renderPeek() {
  var el = document.getElementById('admPeek');
  if (!el || !S.admData) return;
  var d = S.admData;

  if (S.admPeek === 'sn') {
    var s = window.SENTENCE_PROMPT;
    el.innerHTML = !d.sentences.length
      ? '<div class="empty">아직 제출한 분이 없습니다.</div>'
      : d.sentences.map(function (f) {
          return '<div class="peek-item"><div class="pnm">' + esc(f.name) + '</div>' +
            '<div class="ptx">' + esc(s.before) + ' <b>' + esc(f.body) + '</b> ' + esc(s.after) + '</div></div>';
        }).join('');
    return;
  }

  var code = S.admPeek;
  var def = sheetDefOf(code);
  var list = d.practice.filter(function (x) { return x.code === code; });
  el.innerHTML = !list.length
    ? '<div class="empty">아직 제출한 분이 없습니다.</div>'
    : list.map(function (f) {
        var lines = Object.keys(f.res || {}).sort(function (a, b) { return a - b; }).map(function (no) {
          var v = f.res[no] || {};
          if (!v.risk && !v.stage && !String(v.memo || '').trim()) return '';
          var item = def.items.filter(function (x) { return String(x.no) === String(no); })[0];
          return '<div class="pline">' +
            '<span class="pno">' + esc(no) + '</span>' +
            '<span class="pact">' + esc(item ? (item.short || item.page) : '') + '</span>' +
            '<span class="prisk r' + esc(v.risk || '') + '">' + esc(v.risk || '·') + '</span>' +
            '<span class="pstage">' + esc(v.stage || '·') + '</span>' +
            (String(v.memo || '').trim() ? '<span class="pmemo">' + esc(v.memo) + '</span>' : '') +
            '</div>';
        }).join('');
        return '<div class="peek-item"><div class="pnm">' + esc(f.name) +
          '<span class="pfill">' + f.filled + '칸</span></div>' + lines + '</div>';
      }).join('');
}

async function setCfg(k, v) {
  try {
    var r = await rpc('admin_set', { p_ses: S.session, p_key: k, p_value: v, p_token: S.token });
    if (!r.ok) { toast(r.msg || '변경하지 못했습니다.'); return; }
    await loadCfg();
    toast(v === 'Y' ? '열었습니다.' : '닫았습니다.');
    renderAdmin();
  } catch (e) {
    toast('변경하지 못했습니다.');
  }
}

async function doReset() {
  if (!confirm(ses().name + '의 참가자·응답 기록을 모두 지웁니다.\n되돌릴 수 없습니다. 계속할까요?')) return;
  if (!confirm('정말 지울까요? 연수 중이라면 절대 누르지 마세요.')) return;
  try {
    var r = await rpc('admin_reset', { p_ses: S.session, p_token: S.token });
    if (!r.ok) { toast(r.msg || '실패했습니다.'); return; }
    toast('참가자 ' + r.removed + '명의 기록을 지웠습니다.');
    loadAdminData();
  } catch (e) { toast('실패했습니다.'); }
}
