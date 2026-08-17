/* ═══════════════════════════════════════════════
   실시간 현황판 · 모니터 투사 전용
   board.html?ses=0822#ox | #a | #b | #sn | #status
   ═══════════════════════════════════════════════ */

var VIEWS = [
  { id: 'ox',     label: '① O·X 퀴즈',  gate: 'open_ox' },
  { id: 'a',      label: '② 실습 A',    gate: 'open_a' },
  { id: 'b',      label: '③ 실습 B',    gate: 'open_b' },
  { id: 'sn',     label: '④ 한 문장',   gate: 'open_sentence' },
  { id: 'status', label: '제출 현황',   gate: null }
];

var B = {
  ses: '0822',
  view: 'ox',
  cfg: {},
  connected: false,
  seenSentences: {},
  firstSentencePaint: true
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function el(id) { return document.getElementById(id); }
function sesInfo() {
  return (window.SESSIONS || []).filter(function (x) { return x.id === B.ses; })[0] || { name: '', date: '' };
}

/* ── 부팅 ── */
window.addEventListener('load', async function () {
  var p = new URLSearchParams(location.search);
  var s = p.get('ses');
  if (s && (window.SESSIONS || []).some(function (x) { return x.id === s; })) B.ses = s;

  var h = (location.hash || '').replace('#', '');
  if (VIEWS.some(function (v) { return v.id === h; })) B.view = h;

  renderNav();
  await loadCfg();
  subscribe();
  render();

  window.addEventListener('hashchange', function () {
    var v = (location.hash || '').replace('#', '');
    if (VIEWS.some(function (x) { return x.id === v; })) { B.view = v; renderNav(); render(); }
  });

  document.addEventListener('keydown', function (e) {
    var i = VIEWS.map(function (v) { return v.id; }).indexOf(B.view);
    if (e.key === 'ArrowRight') { setView(VIEWS[(i + 1) % VIEWS.length].id); }
    else if (e.key === 'ArrowLeft') { setView(VIEWS[(i - 1 + VIEWS.length) % VIEWS.length].id); }
    else if (e.key === 'f' || e.key === 'F') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    }
  });
});

function setView(id) { B.view = id; location.hash = '#' + id; renderNav(); render(); }

function renderNav() {
  el('nav').innerHTML =
    VIEWS.map(function (v) {
      return '<button class="' + (v.id === B.view ? 'on' : '') + '" onclick="setView(\'' + v.id + '\')">' + esc(v.label) + '</button>';
    }).join('') +
    '<div class="sp"></div>' +
    '<div class="tip">← → 화면 넘기기 · F 전체화면</div>';
}

async function loadCfg() {
  var r = await sb().from('settings').select('key,value').eq('ses', B.ses);
  var m = {};
  (r.data || []).forEach(function (x) { m[x.key] = x.value; });
  B.cfg = m;
}

function isOpen(k) { return B.cfg[k] === 'Y'; }

/* ── Realtime ── */
function subscribe() {
  var timer = null;
  function hit() { clearTimeout(timer); timer = setTimeout(render, 220); }

  sb().channel('board')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' },       hit)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ox_responses' },       hit)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'practice_responses' }, hit)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sentences' },          hit)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, async function () {
      await loadCfg(); hit();
    })
    .subscribe(function (status) {
      B.connected = (status === 'SUBSCRIBED');
      paintBarStatus();
    });

  // 안전망 — 웹소켓이 끊겨도 20초마다 갱신
  setInterval(render, 20000);
}

/* ── 상단 바 ── */
var _barCounts = { total: 0, people: 0 };

function paintBar(label, gateKey, count, unit) {
  var v = sesInfo();
  var open = gateKey ? isOpen(gateKey) : null;
  el('bar').innerHTML =
    '<div class="ttl">' + esc(label) + '</div>' +
    '<div class="sub">' + esc(v.name) + ' · 2026 지학사 국어과 연수</div>' +
    (open === null ? '' :
      '<div class="pill ' + (open ? 'on' : 'shut') + '">' + (open ? '열림' : '닫힘') + '</div>') +
    '<div class="cnt">' + count + '<small>' + esc(unit) + '</small></div>' +
    '<div id="livepin"></div>';
  paintBarStatus();
}

function paintBarStatus() {
  var p = el('livepin');
  if (!p) return;
  p.innerHTML = B.connected
    ? '<span class="live"><i></i>실시간</span>'
    : '<span class="live off"><i></i>연결 중…</span>';
}

/* ── 라우팅 ── */
async function render() {
  if (B.view === 'ox')     return renderOX();
  if (B.view === 'a')      return renderPractice('A');
  if (B.view === 'b')      return renderPractice('B');
  if (B.view === 'sn')     return renderSentences();
  if (B.view === 'status') return renderStatus();
}

function blank(icon, title, desc) {
  return '<div class="blank"><div class="ic">' + icon + '</div><h2>' + esc(title) + '</h2><p>' + desc + '</p></div>';
}

/* ═══════ ① OX 막대그래프 ═══════ */
async function renderOX() {
  var st = el('stage');
  st.className = 'stage';

  var d  = await rpc('get_ox_questions', { p_ses: B.ses });
  var rs = await sb().from('ox_responses').select('answers,score').eq('ses', B.ses);
  var rows = rs.data || [];
  var qs = d.questions || [];

  paintBar('사람일까, AI일까?', 'open_ox', rows.length, '명 응답');

  if (!rows.length) {
    st.innerHTML = blank('🖊️', '아직 응답이 없습니다',
      isOpen('open_ox') ? '선생님들이 답하기 시작하면 여기에 바로 그려집니다.'
                        : '관리자 화면에서 <b>① O·X 퀴즈</b>를 열어 주세요.');
    return;
  }

  var tally = qs.map(function () { return { O: 0, X: 0 }; });
  var sum = 0;
  rows.forEach(function (r) {
    (r.answers || []).forEach(function (v, i) { if (tally[i] && (v === 'O' || v === 'X')) tally[i][v]++; });
    sum += Number(r.score) || 0;
  });

  var html = '<div class="oxwrap">' + qs.map(function (q, i) {
    var t = tally[i], n = (t.O + t.X) || 1;
    var po = Math.round(t.O / n * 100), px = 100 - po;
    var right = d.reveal ? q.answer : null;
    return '<div class="oxq">' +
      '<div class="qt"><span class="n">' + (i + 1) + '</span><span style="flex:1">' + esc(q.body) + '</span>' +
        (right ? '<span class="ans">정답 ' + esc(right) + ' · ' + esc(q.label) + '</span>' : '') +
      '</div>' +
      '<div class="oxbar">' +
        (t.O ? '<span class="o' + (right === 'O' ? ' right' : '') + '" style="width:' + po + '%">O ' + po + '%<small>' + t.O + '명</small></span>' : '') +
        (t.X ? '<span class="x' + (right === 'X' ? ' right' : '') + '" style="width:' + px + '%">X ' + px + '%<small>' + t.X + '명</small></span>' : '') +
      '</div>' +
      '<div class="lg"><span>O · AI가 썼다</span><span>X · 사람이 썼다</span></div>' +
      (d.reveal && q.note ? '<div class="cm">' + esc(q.note) + '</div>' : '') +
      '</div>';
  }).join('') + '</div>';

  if (d.reveal && d.panel) {
    html += '<div class="oxpanel"><table>' +
      '<tr><th style="text-align:left;padding-left:14px">방송 패널 · MBC 「손석희의 12시」</th><th>1번</th><th>2번</th><th>3번</th><th>합계</th>' +
      '<th>우리</th></tr>' +
      d.panel.map(function (p) {
        return '<tr><td class="nm">' + esc(p.name) + '<small>' + esc(p.descr) + '</small></td>' +
          p.picks.map(function (pk, i) {
            var c = qs[i] ? qs[i].answer : null;
            return '<td>' + esc(pk) + ' <span class="' + (pk === c ? 'ok' : 'no') + '">' + (pk === c ? '✓' : '✗') + '</span></td>';
          }).join('') +
          '<td><b>' + esc(p.score) + '</b></td><td></td></tr>';
      }).join('') +
      '<tr><td class="nm">오늘 여기<small>' + rows.length + '명 평균</small></td>' +
      '<td colspan="3" style="color:var(--ink-soft)">—</td>' +
      '<td><b>' + (sum / rows.length).toFixed(1) + '/3</b></td><td></td></tr>' +
      '</table></div>';
  }

  st.innerHTML = html;
}

/* ═══════ ②③ 실습 히트맵 ═══════ */
async function renderPractice(code) {
  var st = el('stage');
  st.className = 'stage';
  var def = sheetDefOf(code);

  var r = await sb().from('practice_responses').select('name,res,created_at')
    .eq('ses', B.ses).eq('code', code).order('created_at', { ascending: false });
  var feed = r.data || [];

  paintBar('실습 ' + code + ' · ' + def.title, code === 'A' ? 'open_a' : 'open_b', feed.length, '명 제출');

  if (!feed.length) {
    st.innerHTML = blank('📋', '아직 제출이 없습니다',
      isOpen(code === 'A' ? 'open_a' : 'open_b')
        ? '선생님들이 제출하면 활동별 <b>허용 단계 분포</b>가 여기에 채워집니다.'
        : '관리자 화면에서 <b>실습 ' + code + '</b>를 열어 주세요.');
    return;
  }

  // 집계
  var agg = {};   // no -> {stage:{1..5}, risk:{상,중,하}, memos:[]}
  def.items.forEach(function (it) {
    agg[it.no] = { stage: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, risk: { '상': 0, '중': 0, '하': 0 }, memos: [] };
  });
  feed.forEach(function (f) {
    Object.keys(f.res || {}).forEach(function (no) {
      var a = agg[no]; if (!a) return;
      var v = f.res[no] || {};
      var sN = parseInt(v.stage, 10);
      if (sN >= 1 && sN <= 5) a.stage[sN]++;
      if (a.risk[v.risk] != null) a.risk[v.risk]++;
      var m = String(v.memo || '').trim();
      if (m) a.memos.push({ name: f.name, memo: m });
    });
  });

  var stages = window.AI_STAGES;

  var rowsHtml = def.items.map(function (it) {
    var a = agg[it.no];
    var tot = stages.reduce(function (s, x) { return s + a.stage[x.n]; }, 0);
    var max = stages.reduce(function (s, x) { return Math.max(s, a.stage[x.n]); }, 0);
    var split = tot >= 3 && (max / tot) < 0.5;

    var cells = stages.map(function (x) {
      var c = a.stage[x.n];
      if (!c) return '<td><div class="cell zero">·</div></td>';
      var ratio = max ? c / max : 0;
      var alpha = 0.18 + 0.82 * ratio;
      return '<td><div class="cell" style="background:' + hexA(x.color, alpha) +
        ';color:' + (alpha > 0.55 ? '#fff' : 'var(--ink)') + '">' + c + '</div></td>';
    }).join('');

    var rt = a.risk['상'] + a.risk['중'] + a.risk['하'];
    var riskHtml = !rt ? '<div class="riskbar"></div>' :
      '<div class="riskbar">' +
        (a.risk['상'] ? '<i class="h" style="width:' + (a.risk['상'] / rt * 100) + '%">' + a.risk['상'] + '</i>' : '') +
        (a.risk['중'] ? '<i class="m" style="width:' + (a.risk['중'] / rt * 100) + '%">' + a.risk['중'] + '</i>' : '') +
        (a.risk['하'] ? '<i class="l" style="width:' + (a.risk['하'] / rt * 100) + '%">' + a.risk['하'] + '</i>' : '') +
      '</div>';

    return '<tr>' +
      '<td class="act">' + esc(it.short || ('활동 ' + it.no)) +
        (split ? '<span class="flag">판단 갈림</span>' : '') +
        '<small>' + esc(it.page) + '</small></td>' +
      cells +
      '<td>' + riskHtml + '</td>' +
      '</tr>';
  }).join('');

  var memos = [];
  Object.keys(agg).forEach(function (no) { memos = memos.concat(agg[no].memos); });
  memos = memos.slice(0, 24);

  st.innerHTML =
    '<div class="hm">' +
      '<table class="hmtable">' +
        '<tr><th class="act">교과서 활동</th>' +
          stages.map(function (x) { return '<th>' + x.n + '단계<br><span style="font-weight:400;font-size:11.5px">' + esc(x.name) + '</span></th>'; }).join('') +
          '<th class="risk">외주화 위험</th></tr>' +
        rowsHtml +
      '</table>' +
      '<div class="hmlegend">' +
        '<span>칸 안 숫자 = 그 단계를 고른 선생님 수 · 색이 진할수록 몰린 것</span>' +
        '<span class="sw"><b style="background:var(--red)"></b>위험 상</span>' +
        '<span class="sw"><b style="background:var(--amber)"></b>중</span>' +
        '<span class="sw"><b style="background:var(--green)"></b>하</span>' +
        '<span class="sw"><b style="background:var(--amber)"></b>「판단 갈림」 = 과반이 없는 활동 — 여기를 이야기 소재로</span>' +
      '</div>' +
      (memos.length ?
        '<div class="memos"><div class="lb">배움을 지키는 장치</div><div class="track">' +
          [0, 1].map(function () {
            return memos.map(function (m) { return '<span><b>' + esc(m.name) + '</b>' + esc(m.memo) + '</span>'; }).join('');
          }).join('') +
        '</div></div>' : '') +
    '</div>';
}

function hexA(hex, a) {
  var h = hex.replace('#', '');
  var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
}

/* ═══════ ④ 문장 스트림 ═══════ */
async function renderSentences() {
  var st = el('stage');
  st.className = 'stage';
  var s = window.SENTENCE_PROMPT;

  var r = await sb().from('sentences').select('id,name,body,created_at')
    .eq('ses', B.ses).order('created_at', { ascending: false }).limit(60);
  var feed = r.data || [];

  paintBar('오늘의 한 문장', 'open_sentence', feed.length, '개');

  if (!feed.length) {
    st.innerHTML = blank('✍️', '아직 문장이 없습니다',
      isOpen('open_sentence')
        ? '선생님들이 적기 시작하면 여기에 한 장씩 쌓입니다.'
        : '관리자 화면에서 <b>④ 오늘의 한 문장</b>을 열어 주세요.');
    return;
  }

  var first = B.firstSentencePaint;
  var html = feed.map(function (f) {
    var fresh = !first && !B.seenSentences[f.id];
    B.seenSentences[f.id] = true;
    return '<div class="sncard' + (fresh ? ' fresh' : '') + '">' +
      '<div class="nm">' + esc(f.name) + '</div>' +
      '<div class="tx">' + esc(s.before) + ' <b>' + esc(f.body) + '</b> ' + esc(s.after) + '</div>' +
      '</div>';
  }).join('');
  if (first) { feed.forEach(function (f) { B.seenSentences[f.id] = true; }); B.firstSentencePaint = false; }

  st.innerHTML = '<div class="snwrap">' + html + '</div>';
}

/* ═══════ ⑤ 제출 현황판 ═══════ */
async function renderStatus() {
  var st = el('stage');
  st.className = 'stage';

  var q = await Promise.all([
    sb().from('participants').select('id,name,last_seen').eq('ses', B.ses).order('last_seen', { ascending: false }),
    sb().from('ox_responses').select('pid').eq('ses', B.ses),
    sb().from('practice_responses').select('pid,code').eq('ses', B.ses),
    sb().from('sentences').select('pid').eq('ses', B.ses)
  ]);
  var people = q[0].data || [];
  var ox = {}, pr = {}, sn = {};
  (q[1].data || []).forEach(function (r) { ox[r.pid] = true; });
  (q[2].data || []).forEach(function (r) { (pr[r.pid] = pr[r.pid] || {})[r.code] = true; });
  (q[3].data || []).forEach(function (r) { sn[r.pid] = true; });

  var both = B.cfg.require_both === 'Y';
  var nA = 0, nB = 0, allDone = 0;
  people.forEach(function (p) {
    var x = pr[p.id] || {};
    if (x.A) nA++;
    if (x.B) nB++;
    var prOk = both ? (x.A && x.B) : (x.A || x.B);
    if (ox[p.id] && prOk && sn[p.id]) allDone++;
  });

  paintBar('제출 현황', null, people.length, '명 접속');

  var N = people.length || 1;
  function gauge(k, v, gateKey) {
    return '<div class="gauge' + (gateKey && !isOpen(gateKey) ? ' shut' : '') + '">' +
      '<div class="k">' + esc(k) + (gateKey && !isOpen(gateKey) ? ' · 닫힘' : '') + '</div>' +
      '<div class="v">' + v + '<small>/ ' + people.length + '</small></div>' +
      '<div class="track"><i style="width:' + Math.round(v / N * 100) + '%"></i></div>' +
      '</div>';
  }

  st.innerHTML =
    '<div class="gauges">' +
      gauge('① O·X 퀴즈',  Object.keys(ox).length, 'open_ox') +
      gauge('② 실습 A',    nA, 'open_a') +
      gauge('③ 실습 B',    nB, 'open_b') +
      gauge('④ 한 문장',   Object.keys(sn).length, 'open_sentence') +
    '</div>' +
    '<div style="flex:none;font-size:15px;color:var(--ink-soft);margin-bottom:14px">' +
      '모든 과제 완료 <b style="color:var(--green);font-size:19px">' + allDone + '명</b>' +
      ' · 자료 공개 ' + (B.cfg.materials_open === 'Y' ? '<b style="color:var(--green)">전체 공개 중</b>' : '완료자에게만') +
      ' · 실습 기준 ' + (both ? '<b>A·B 모두</b>' : 'A 또는 B') +
    '</div>' +
    '<div class="chips">' +
      (!people.length ? '<div style="color:var(--ink-soft);font-size:17px">아직 접속한 분이 없습니다.</div>' :
        people.map(function (p) {
          var x = pr[p.id] || {};
          var prOk = both ? (x.A && x.B) : (x.A || x.B);
          var all = ox[p.id] && prOk && sn[p.id];
          return '<div class="chip' + (all ? ' all' : '') + '">' + esc(p.name) +
            '<span class="dots">' +
              '<i class="' + (ox[p.id] ? 'on' : '') + '"></i>' +
              '<i class="' + (x.A ? 'on' : '') + '"></i>' +
              '<i class="' + (x.B ? 'on' : '') + '"></i>' +
              '<i class="' + (sn[p.id] ? 'on' : '') + '"></i>' +
            '</span></div>';
        }).join('')) +
    '</div>';
}

/* ── RPC 헬퍼 ── */
async function rpc(fn, args) {
  var r = await sb().rpc(fn, args || {});
  if (r.error) throw r.error;
  return r.data;
}
