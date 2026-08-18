-- ═══════════════════════════════════════════════════════════
--  8월 22일 연수 · 자료 2종 추가
--
--  Supabase 대시보드 → SQL Editor → New query 에 붙여넣고 Run.
--  schema.sql 과 달리 이 파일은 기존 응답을 지우지 않습니다.
--  여러 번 실행해도 중복이 생기지 않도록 먼저 지우고 넣습니다.
--
--  선행 조건: materials/rubric.html · materials/purposes.html 이
--  GitHub Pages(pblsketch/jihaksa-2026)에 올라가 있어야 합니다.
-- ═══════════════════════════════════════════════════════════

delete from public.materials
 where ses = '0822'
   and title in ('AI·에듀테크 9가지 교육적 목적', 'AI 활용 수업 설계 루브릭 · 8준거');

insert into public.materials (ses, kind, ord, title, descr, url) values
('0822', '자료', 2,
 'AI·에듀테크 9가지 교육적 목적',
 '실습 2번째 칸이 막힐 때 · AI가 맡는 일이 목적인가 수단인가',
 'https://pblsketch.github.io/jihaksa-2026/materials/purposes.html'),

('0822', '자료', 3,
 'AI 활용 수업 설계 루브릭 · 8준거',
 '수업 하나를 통째로 볼 때 · 교과 협의회용',
 'https://pblsketch.github.io/jihaksa-2026/materials/rubric.html');

-- 확인
select ord, title, descr, url
  from public.materials
 where ses = '0822'
 order by ord;
