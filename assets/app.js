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
  adminTab: 'ctrl',
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
    '<div class="foot">2026 지학사 국어과 연수 · 박준일</div>';

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
        '<div class="src">' + esc(def.goalSrc) + '</div>' +
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
        '<div class="pg">' + esc(it.page) + '</div>' +
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
    '<div class="foot">2026 지학사 국어과 연수 · 박준일</div>';
}

function ck(label, on) {
  return '<div><span class="c' + (on ? ' on' : '') + '">✓</span>' + esc(label) + '</div>';
}

/* ═══════════════ ⑦ 관리자 ═══════════════ */
function rAdmin() {
  app().innerHTML = header('관리자 · 진행 제어') +
    '<div class="screen">' +
      '<div class="card blue" style="padding:14px 16px;display:flex;align-items:center;gap:12px;margin-bottom:14px">' +
        '<div style="flex:1"><div style="font-weight:600;font-size:15px">' + esc(ses().name) + '</div>' +
        '<div class="hint" style="margin-top:2px">이 연수의 데이터만 표시됩니다</div></div>' +
        '<button class="btn ghost sm" onclick="changeSession()">전환</button>' +
      '</div>' +
      '<div class="tabs">' +
        '<button id="t1" onclick="adminTab(\'ctrl\')">진행 제어</button>' +
        '<button id="t2" onclick="adminTab(\'roster\')">제출 현황</button>' +
        '<button id="t3" onclick="adminTab(\'board\')">현황판</button>' +
      '</div>' +
      '<div id="aBody"><div class="empty">불러오는 중…</div></div>' +
    '</div>';
  adminTab(S.adminTab);
}

function adminTab(t) {
  S.adminTab = t;
  dropChans();
  ['t1', 't2', 't3'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('on');
  });
  var cur = document.getElementById({ ctrl: 't1', roster: 't2', board: 't3' }[t]);
  if (cur) cur.classList.add('on');

  if (t === 'board') { renderAdmin(); return; }
  watch(['participants', 'ox_responses', 'practice_responses', 'sentences'], renderAdmin, 'admin-' + t);
}

async function renderAdmin() {
  var b = document.getElementById('aBody');
  if (!b) return;
  if (S.adminTab === 'ctrl')   { b.innerHTML = adminCtrl(); return; }
  if (S.adminTab === 'board')  { b.innerHTML = adminBoardLinks(); return; }
  b.innerHTML = await adminRoster();
}

function gate(key, title, desc) {
  var on = isOpen(key);
  return '<div class="toggle gate' + (on ? ' on' : '') + '">' +
    '<div class="tx"><div class="tt">' + esc(title) + '</div><div class="ds">' + esc(desc) + '</div></div>' +
    '<div class="sw' + (on ? ' on' : '') + '" onclick="setCfg(\'' + key + '\',\'' + (on ? 'N' : 'Y') + '\')"></div>' +
    '</div>';
}

function adminCtrl() {
  return '<div class="section-t">과제 열기 · 닫기</div>' +
    '<div class="hint" style="margin:-6px 0 12px">켜는 즉시 선생님들 화면이 저절로 바뀝니다. 새로고침 안내는 필요 없습니다.</div>' +
    gate('open_ox',       '① O · X 퀴즈',            '사람일까, AI일까? · 3문항') +
    gate('open_a',        '② 실습 A · 나의 미래 일기',   '독서 토론과 글쓰기 · 활동 9개') +
    gate('open_b',        '③ 실습 B · 학술 연구 포스터', '주제 탐구 독서 · 활동 7개') +
    gate('open_sentence', '④ 오늘의 한 문장',          '나는 학생에게 AI를 맡기기 전에…') +

    '<div class="section-t">공개 제어</div>' +
    gate('ox_reveal',      'OX 정답 공개',   '켜면 참가자 화면과 현황판에 정답·방송 패널 성적표가 뜹니다') +
    gate('materials_open', '자료 전체 공개', '켜면 과제를 다 안 해도 자료 페이지가 열립니다') +
    gate('require_both',   '실습 A·B 둘 다 필수', '끄면 A 또는 B 하나만 내도 자료가 열립니다 (기본: 꺼짐)') +

    '<div class="section-t">위험 구역</div>' +
    '<button class="btn danger" onclick="doReset()">' + esc(ses().name) + ' 응답 모두 비우기</button>' +
    '<div class="hint" style="text-align:center">리허설 기록 정리용입니다. 다른 연수 데이터는 그대로 둡니다.</div>' +
    '<div class="foot">관리자 · 박준일</div>';
}

function adminBoardLinks() {
  var q = '?ses=' + encodeURIComponent(S.session);
  return '<div class="hint" style="margin-bottom:12px">모니터에 띄울 화면입니다. 새 탭으로 열어 전체화면(F11)으로 쓰세요.</div>' +
    '<div class="board-links">' +
      '<a href="board.html' + q + '#ox" target="_blank">① OX 퀴즈<small>막대그래프</small></a>' +
      '<a href="board.html' + q + '#a"  target="_blank">② 실습 A<small>단계 히트맵</small></a>' +
      '<a href="board.html' + q + '#b"  target="_blank">③ 실습 B<small>단계 히트맵</small></a>' +
      '<a href="board.html' + q + '#sn" target="_blank">④ 한 문장<small>문장 스트림</small></a>' +
    '</div>' +
    '<a class="btn ghost" style="text-decoration:none" href="board.html' + q + '#status" target="_blank">제출 현황판 (전체 진행률)</a>' +
    '<div class="hint" style="text-align:center;margin-top:14px">현황판에서 <b>← →</b> 키로 화면을 넘길 수 있습니다.</div>' +
    '<div class="foot">관리자 · 박준일</div>';
}

async function adminRoster() {
  var q = await Promise.all([
    sb().from('participants').select('id,name,last_seen').eq('ses', S.session).order('last_seen', { ascending: false }),
    sb().from('ox_responses').select('pid,score').eq('ses', S.session),
    sb().from('practice_responses').select('pid,code').eq('ses', S.session),
    sb().from('sentences').select('pid,body').eq('ses', S.session)
  ]);
  var people = q[0].data || [];
  var oxM = {}, prM = {}, snM = {};
  (q[1].data || []).forEach(function (r) { oxM[r.pid] = r.score; });
  (q[2].data || []).forEach(function (r) { (prM[r.pid] = prM[r.pid] || {})[r.code] = true; });
  (q[3].data || []).forEach(function (r) { snM[r.pid] = r.body; });

  var both = S.cfg.require_both === 'Y';
  var doneAll = 0;
  var rows = people.map(function (p) {
    var pr = prM[p.id] || {};
    var prOk = both ? (pr.A && pr.B) : (pr.A || pr.B);
    var all = (oxM[p.id] != null) && prOk && (snM[p.id] != null);
    if (all) doneAll++;
    return '<div class="row">' +
      '<div class="nm">' + esc(p.name) + '</div>' +
      '<div class="sc">' + (oxM[p.id] != null ? oxM[p.id] + '/3' : '') + '</div>' +
      '<div class="dots">' +
        '<i class="' + (oxM[p.id] != null ? 'on' : '') + '"></i>' +
        '<i class="' + (pr.A ? 'on' : '') + '"></i>' +
        '<i class="' + (pr.B ? 'on' : '') + '"></i>' +
        '<i class="' + (snM[p.id] != null ? 'on' : '') + '"></i>' +
      '</div></div>';
  }).join('');

  return '<div class="stats">' +
      '<div class="stat hl"><div class="v">' + people.length + '</div><div class="k">접속 인원</div></div>' +
      '<div class="stat"><div class="v">' + doneAll + '</div><div class="k">모두 완료</div></div>' +
      '<div class="stat"><div class="v">' + Object.keys(oxM).length + '</div><div class="k">OX 퀴즈</div></div>' +
      '<div class="stat"><div class="v">' + (q[2].data || []).length + '</div><div class="k">실습 (A+B)</div></div>' +
    '</div>' +
    '<div class="hint" style="margin-bottom:12px">문장 <b>' + Object.keys(snM).length + '명</b> · <span class="live"><i></i>실시간</span></div>' +
    (!people.length ? '<div class="empty">아직 접속한 분이 없습니다.</div>' : rows) +
    '<div class="hint" style="margin-top:14px">● 4개 = OX · 실습A · 실습B · 문장 &nbsp;/&nbsp; 왼쪽 숫자 = OX 점수</div>';
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
    renderAdmin();
  } catch (e) { toast('실패했습니다.'); }
}
