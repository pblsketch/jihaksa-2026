-- ═══════════════════════════════════════════════════════════════
--  2026 지학사 국어과 연수 · 온라인 활동지
--  Supabase 스키마 · 최초 1회 실행 (SQL Editor에 통째로 붙여넣기)
--
--  ⚠ 이 파일을 다시 실행하면 기존 응답이 모두 지워집니다.
--     연수 당일에는 절대 다시 실행하지 마세요.
--     리허설 기록만 지우려면 관리자 화면의 「응답 비우기」를 쓰세요.
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ───────────────────────────────────────────────
--  ① 테이블
-- ───────────────────────────────────────────────

drop table if exists public.ox_responses       cascade;
drop table if exists public.practice_responses cascade;
drop table if exists public.sentences          cascade;
drop table if exists public.participants       cascade;
drop table if exists public.ox_questions       cascade;
drop table if exists public.ox_panel           cascade;
drop table if exists public.settings           cascade;
drop table if exists public.materials          cascade;
drop table if exists public.admin_tokens       cascade;

-- 참가자
create table public.participants (
  id        uuid primary key default gen_random_uuid(),
  ses       text        not null,
  name      text        not null,
  norm_name text        not null,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
create index participants_ses_norm on public.participants (ses, norm_name);
create index participants_ses_seen on public.participants (ses, last_seen desc);

-- OX 문항 · 정답을 담고 있어 anon 직접 조회를 막습니다 (get_ox_questions RPC로만 열람)
create table public.ox_questions (
  no     int primary key,
  body   text not null,
  answer text not null,
  label  text not null,
  note   text not null
);

-- 방송 패널 성적표 · 정답 공개 시에만 노출
create table public.ox_panel (
  ord   int primary key,
  name  text not null,
  descr text not null,
  picks text[] not null,
  score text not null
);

-- 과제 1 · OX 퀴즈 응답 (참가자당 1행, 다시 제출하면 덮어씀)
create table public.ox_responses (
  id      bigint generated always as identity primary key,
  ses     text not null,
  pid     uuid not null references public.participants(id) on delete cascade,
  name    text not null,
  answers text[] not null,
  score   int  not null,
  created_at timestamptz not null default now(),
  unique (ses, pid)
);

-- 과제 2·3 · AI 허용 단계 실습 (참가자 × 실습지 조합당 1행)
create table public.practice_responses (
  id      bigint generated always as identity primary key,
  ses     text not null,
  pid     uuid not null references public.participants(id) on delete cascade,
  name    text not null,
  code    text not null check (code in ('A','B')),
  res     jsonb not null default '{}'::jsonb,
  filled  int  not null default 0,
  created_at timestamptz not null default now(),
  unique (ses, pid, code)
);

-- 과제 4 · 오늘의 한 문장
create table public.sentences (
  id      bigint generated always as identity primary key,
  ses     text not null,
  pid     uuid not null references public.participants(id) on delete cascade,
  name    text not null,
  body    text not null,
  created_at timestamptz not null default now(),
  unique (ses, pid)
);

-- 진행 제어 설정
create table public.settings (
  ses   text not null,
  key   text not null,
  value text not null,
  primary key (ses, key)
);

-- 연수 자료 · 도구
create table public.materials (
  id    bigint generated always as identity primary key,
  ses   text,                      -- null 이면 모든 연수에 노출
  kind  text not null default '자료',   -- '자료' | '도구'
  ord   int  not null default 1,
  title text not null,
  descr text not null default '',
  url   text not null default ''
);

-- 관리자 인증 토큰 · anon 조회 불가
create table public.admin_tokens (
  ses   text primary key,
  token text not null
);

-- ───────────────────────────────────────────────
--  ② 내용 데이터 (Apps Script 원문 그대로)
-- ───────────────────────────────────────────────

insert into public.ox_questions (no, body, answer, label, note) values
(1, '7월의 경춘선 숲길은 생각보다 조용했고, 자전거 벨소리만 계절을 지나갔다.',
    'O', 'AI',
    '가장 문학적이고 감각적인 문장인데 AI입니다. “매끄럽고 그럴듯한 것”은 사람의 증거가 아닙니다.'),
(2, '모든 것은 순간에 불과하지만, 순간들은 삶을 구하는 유일한 방도이다.',
    'X', '사람',
    '진행자 김겨울의 산문집 문장입니다. 대구(對句)가 뚜렷해 오히려 AI로 오인받았습니다. 형식·구조로 판별하면 틀립니다.'),
(3, '인류의 사유가 매번 한 걸음씩 더 넓은 세계로 나아간 것은, 확률이 가리키는 답이 아니라 그 답 너머를 향한 질문 덕분이었다.',
    'O', '사람 + AI 협업',
    '이제 “누가 썼나”라는 질문 자체가 성립하지 않습니다. 대부분의 실제 글이 이 상태로 옵니다.');

insert into public.ox_panel (ord, name, descr, picks, score) values
(1, '손석희', 'AI 안 쓰는 언론인',         array['O','O','O'], '2/3'),
(2, '송길영', '데이터 전문가',             array['O','X','O'], '3/3'),
(3, '이종범', 'AI로 문장 만드는 웹툰작가', array['X','O','O'], '1/3');

-- 관리자 닉네임
insert into public.admin_tokens (ses, token) values
('0725', '박준일0822'),
('0822', '박준일0822');

-- 진행 제어 기본값 · 모든 과제는 닫힌 채로 시작합니다 (관리자가 하나씩 엽니다)
insert into public.settings (ses, key, value)
select s.ses, k.key, k.value
from (values ('0725'), ('0822')) as s(ses),
     (values
        ('open_ox',        'N'),
        ('open_a',         'N'),
        ('open_b',         'N'),
        ('open_sentence',  'N'),
        ('ox_reveal',      'N'),
        ('materials_open', 'N'),
        ('require_both',   'N')   -- Y 로 바꾸면 실습 A·B 둘 다 내야 자료가 열립니다
     ) as k(key, value);

-- 연수 자료
insert into public.materials (ses, kind, ord, title, descr, url) values
('0725', '자료', 1, '연수 자료 전체', '강의 원고 · 활동지 15종 · AI 활용 안내',
 'https://drive.google.com/drive/folders/170Y0R1AKGXnV0WacXZyIJVfFzdM2OWGW?usp=sharing'),
('0822', '자료', 1, '연수 자료 전체', '강의 원고 · 활동지 15종 · AI 활용 안내',
 'https://drive.google.com/drive/folders/170Y0R1AKGXnV0WacXZyIJVfFzdM2OWGW?usp=sharing'),
('0822', '자료', 2, 'AI·에듀테크 9가지 교육적 목적',
 '실습 2번째 칸이 막힐 때 · AI가 맡는 일이 목적인가 수단인가',
 'https://pblsketch.github.io/jihaksa-2026/materials/purposes.html'),
('0822', '자료', 3, 'AI 활용 수업 설계 루브릭 · 8준거',
 '수업 하나를 통째로 볼 때 · 교과 협의회용',
 'https://pblsketch.github.io/jihaksa-2026/materials/rubric.html'),
(null,   '도구', 1, '쌤핀',      '교사 올인원 바탕화면 대시보드 앱', 'https://ssampin.com'),
(null,   '도구', 2, 'PBL스케치', 'AI 기반 프로젝트 수업 설계 앱',    'https://pblsketch.xyz');

-- ───────────────────────────────────────────────
--  ③ RLS · 읽기는 열고, 쓰기는 전부 RPC로만
-- ───────────────────────────────────────────────

alter table public.participants       enable row level security;
alter table public.ox_responses       enable row level security;
alter table public.practice_responses enable row level security;
alter table public.sentences          enable row level security;
alter table public.settings           enable row level security;
alter table public.materials          enable row level security;
alter table public.ox_questions       enable row level security;
alter table public.ox_panel           enable row level security;
alter table public.admin_tokens       enable row level security;

-- 읽기만 허용 (현황판·집계용). ox_questions / ox_panel / admin_tokens 는 정책이 없어 차단됩니다.
create policy read_all on public.participants       for select to anon, authenticated using (true);
create policy read_all on public.ox_responses       for select to anon, authenticated using (true);
create policy read_all on public.practice_responses for select to anon, authenticated using (true);
create policy read_all on public.sentences          for select to anon, authenticated using (true);
create policy read_all on public.settings           for select to anon, authenticated using (true);
create policy read_all on public.materials          for select to anon, authenticated using (true);

-- ───────────────────────────────────────────────
--  ④ RPC — 모든 쓰기는 여기를 통과합니다
-- ───────────────────────────────────────────────

-- 공통: 설정 한 개 읽기
create or replace function public.cfg(p_ses text, p_key text)
returns text language sql stable security definer set search_path = public as $$
  select value from public.settings where ses = p_ses and key = p_key;
$$;

-- ① 입장
create or replace function public.join_session(p_ses text, p_name text, p_mode text default 'check')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_raw  text := btrim(coalesce(p_name, ''));
  v_norm text;
  v_row  public.participants%rowtype;
  v_tok  text;
begin
  if p_ses not in ('0725', '0822') then
    return jsonb_build_object('ok', false, 'msg', '연수를 먼저 선택해 주세요.');
  end if;
  if length(v_raw) < 1 then
    return jsonb_build_object('ok', false, 'msg', '이름을 입력해 주세요.');
  end if;
  if length(v_raw) > 20 then
    return jsonb_build_object('ok', false, 'msg', '20자 이내로 입력해 주세요.');
  end if;

  select token into v_tok from public.admin_tokens where ses = p_ses;
  if v_tok is not null and v_raw = v_tok then
    return jsonb_build_object('ok', true, 'admin', true,
             'participant', jsonb_build_object('id', 'ADMIN', 'name', '관리자'));
  end if;

  v_norm := lower(regexp_replace(v_raw, '\s+', ' ', 'g'));

  select * into v_row from public.participants
   where ses = p_ses and norm_name = v_norm
   order by created_at desc limit 1;

  if found and p_mode = 'check' then
    return jsonb_build_object('ok', true, 'exists', true, 'name', v_raw);
  end if;

  if found and p_mode <> 'new' then
    update public.participants set last_seen = now() where id = v_row.id;
    return jsonb_build_object('ok', true, 'resumed', true,
             'participant', jsonb_build_object('id', v_row.id, 'name', v_row.name));
  end if;

  insert into public.participants (ses, name, norm_name)
  values (p_ses, v_raw, v_norm) returning * into v_row;

  return jsonb_build_object('ok', true, 'created', true,
           'participant', jsonb_build_object('id', v_row.id, 'name', v_row.name));
end $$;

-- ② 재방문 복원
create or replace function public.restore_participant(p_ses text, p_pid text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.participants%rowtype;
begin
  if p_pid = 'ADMIN' then
    return jsonb_build_object('ok', true, 'admin', true,
             'participant', jsonb_build_object('id', 'ADMIN', 'name', '관리자'));
  end if;
  begin
    select * into v_row from public.participants where id = p_pid::uuid and ses = p_ses;
  exception when others then
    return jsonb_build_object('ok', false);
  end;
  if not found then return jsonb_build_object('ok', false); end if;
  update public.participants set last_seen = now() where id = v_row.id;
  return jsonb_build_object('ok', true,
           'participant', jsonb_build_object('id', v_row.id, 'name', v_row.name));
end $$;

-- ③ OX 문항 · 정답은 「정답 공개」가 켜졌을 때만 내려갑니다
create or replace function public.get_ox_questions(p_ses text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_reveal boolean := coalesce(public.cfg(p_ses, 'ox_reveal'), 'N') = 'Y';
begin
  return jsonb_build_object(
    'reveal', v_reveal,
    'questions', coalesce((
      select jsonb_agg(
        case when v_reveal
          then jsonb_build_object('no', q.no, 'body', q.body, 'answer', q.answer, 'label', q.label, 'note', q.note)
          else jsonb_build_object('no', q.no, 'body', q.body)
        end order by q.no)
      from public.ox_questions q), '[]'::jsonb),
    'panel', case when v_reveal then coalesce((
      select jsonb_agg(jsonb_build_object('name', p.name, 'descr', p.descr, 'picks', p.picks, 'score', p.score)
             order by p.ord)
      from public.ox_panel p), '[]'::jsonb) else null end
  );
end $$;

-- ④ OX 제출 · 채점은 서버에서
create or replace function public.submit_ox(p_ses text, p_pid uuid, p_answers text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; v_score int;
begin
  if coalesce(public.cfg(p_ses, 'open_ox'), 'N') <> 'Y' then
    return jsonb_build_object('ok', false, 'msg', '아직 열리지 않은 과제입니다.');
  end if;
  select name into v_name from public.participants where id = p_pid and ses = p_ses;
  if v_name is null then
    return jsonb_build_object('ok', false, 'msg', '참가자 정보를 찾을 수 없습니다. 새로고침해 주세요.');
  end if;
  if coalesce(array_length(p_answers, 1), 0) <> 3 then
    return jsonb_build_object('ok', false, 'msg', '응답이 올바르지 않습니다.');
  end if;

  select count(*)::int into v_score
    from public.ox_questions q
   where q.answer = p_answers[q.no];

  insert into public.ox_responses (ses, pid, name, answers, score)
  values (p_ses, p_pid, v_name, p_answers, v_score)
  on conflict (ses, pid) do update
    set answers = excluded.answers, score = excluded.score, created_at = now();

  update public.participants set last_seen = now() where id = p_pid;
  return jsonb_build_object('ok', true, 'score', v_score);
end $$;

-- ⑤ 실습 제출
create or replace function public.submit_practice(p_ses text, p_pid uuid, p_code text, p_res jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; v_filled int; v_gate text;
begin
  if p_code not in ('A', 'B') then
    return jsonb_build_object('ok', false, 'msg', '실습지 구분이 올바르지 않습니다.');
  end if;
  v_gate := case when p_code = 'A' then 'open_a' else 'open_b' end;
  if coalesce(public.cfg(p_ses, v_gate), 'N') <> 'Y' then
    return jsonb_build_object('ok', false, 'msg', '아직 열리지 않은 과제입니다.');
  end if;
  select name into v_name from public.participants where id = p_pid and ses = p_ses;
  if v_name is null then
    return jsonb_build_object('ok', false, 'msg', '참가자 정보를 찾을 수 없습니다. 새로고침해 주세요.');
  end if;

  select count(*)::int into v_filled
    from jsonb_each(coalesce(p_res, '{}'::jsonb)) as e(k, v)
   where coalesce(v->>'risk', '') <> ''
      or coalesce(v->>'stage', '') <> ''
      or btrim(coalesce(v->>'memo', '')) <> '';

  if v_filled = 0 then
    return jsonb_build_object('ok', false, 'msg', '적어도 한 항목은 채워 주세요.');
  end if;

  insert into public.practice_responses (ses, pid, name, code, res, filled)
  values (p_ses, p_pid, v_name, p_code, p_res, v_filled)
  on conflict (ses, pid, code) do update
    set res = excluded.res, filled = excluded.filled, created_at = now();

  update public.participants set last_seen = now() where id = p_pid;
  return jsonb_build_object('ok', true, 'filled', v_filled);
end $$;

-- ⑥ 한 문장 제출
create or replace function public.submit_sentence(p_ses text, p_pid uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; v_t text := btrim(coalesce(p_body, ''));
begin
  if coalesce(public.cfg(p_ses, 'open_sentence'), 'N') <> 'Y' then
    return jsonb_build_object('ok', false, 'msg', '아직 열리지 않은 과제입니다.');
  end if;
  select name into v_name from public.participants where id = p_pid and ses = p_ses;
  if v_name is null then
    return jsonb_build_object('ok', false, 'msg', '참가자 정보를 찾을 수 없습니다. 새로고침해 주세요.');
  end if;
  if length(v_t) < 2  then return jsonb_build_object('ok', false, 'msg', '조금만 더 구체적으로 적어 주세요.'); end if;
  if length(v_t) > 60 then return jsonb_build_object('ok', false, 'msg', '60자 이내로 적어 주세요.'); end if;

  insert into public.sentences (ses, pid, name, body)
  values (p_ses, p_pid, v_name, v_t)
  on conflict (ses, pid) do update set body = excluded.body, created_at = now();

  update public.participants set last_seen = now() where id = p_pid;
  return jsonb_build_object('ok', true);
end $$;

-- ⑦ 관리자 · 설정 변경
create or replace function public.admin_set(p_ses text, p_key text, p_value text, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tok text;
begin
  select token into v_tok from public.admin_tokens where ses = p_ses;
  if v_tok is null or v_tok <> coalesce(p_token, '') then
    return jsonb_build_object('ok', false, 'msg', '관리자 인증에 실패했습니다.');
  end if;
  if p_key not in ('open_ox','open_a','open_b','open_sentence','ox_reveal','materials_open','require_both') then
    return jsonb_build_object('ok', false, 'msg', '알 수 없는 설정입니다.');
  end if;
  insert into public.settings (ses, key, value) values (p_ses, p_key, p_value)
  on conflict (ses, key) do update set value = excluded.value;
  return jsonb_build_object('ok', true);
end $$;

-- ⑧ 관리자 · 해당 연수 응답 비우기 (리허설 정리용)
create or replace function public.admin_reset(p_ses text, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tok text; v_n int;
begin
  select token into v_tok from public.admin_tokens where ses = p_ses;
  if v_tok is null or v_tok <> coalesce(p_token, '') then
    return jsonb_build_object('ok', false, 'msg', '관리자 인증에 실패했습니다.');
  end if;
  delete from public.participants where ses = p_ses;   -- 응답은 on delete cascade
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'removed', v_n);
end $$;

-- ⑨ 관리자 인증 확인 (닉네임 입력 시 1회)
create or replace function public.admin_check(p_ses text, p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_tok text;
begin
  select token into v_tok from public.admin_tokens where ses = p_ses;
  return jsonb_build_object('ok', v_tok is not null and v_tok = coalesce(p_token, ''));
end $$;

-- 실행 권한
grant execute on function public.cfg(text, text)                              to anon, authenticated;
grant execute on function public.join_session(text, text, text)               to anon, authenticated;
grant execute on function public.restore_participant(text, text)              to anon, authenticated;
grant execute on function public.get_ox_questions(text)                       to anon, authenticated;
grant execute on function public.submit_ox(text, uuid, text[])                to anon, authenticated;
grant execute on function public.submit_practice(text, uuid, text, jsonb)     to anon, authenticated;
grant execute on function public.submit_sentence(text, uuid, text)            to anon, authenticated;
grant execute on function public.admin_set(text, text, text, text)            to anon, authenticated;
grant execute on function public.admin_reset(text, text)                      to anon, authenticated;
grant execute on function public.admin_check(text, text)                      to anon, authenticated;

-- ───────────────────────────────────────────────
--  ⑤ Realtime — 이게 켜져야 현황판이 즉시 반응합니다
-- ───────────────────────────────────────────────

alter publication supabase_realtime add table public.participants;
alter publication supabase_realtime add table public.ox_responses;
alter publication supabase_realtime add table public.practice_responses;
alter publication supabase_realtime add table public.sentences;
alter publication supabase_realtime add table public.settings;

alter table public.participants       replica identity full;
alter table public.ox_responses       replica identity full;
alter table public.practice_responses replica identity full;
alter table public.sentences          replica identity full;
alter table public.settings           replica identity full;
