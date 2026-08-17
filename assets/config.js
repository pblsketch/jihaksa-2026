/* ═══════════════════════════════════════════════
   Supabase 접속 정보
   publishable key 는 브라우저에 공개되는 것이 정상입니다.
   (쓰기는 전부 서버 RPC + RLS 로 막혀 있습니다)
   ═══════════════════════════════════════════════ */

window.SB_URL = 'https://wzvcienycrebfpqjpwzv.supabase.co';
window.SB_KEY = 'sb_publishable_dX5Z2U5P_GoYkauVQ5vCSQ_0JSlq8S-';

window.SESSIONS = [
  { id: '0725', name: '7월 25일 연수', date: '2026.07.25' },
  { id: '0822', name: '8월 22일 연수', date: '2026.08.22' }
];

/* supabase-js v2 클라이언트 (CDN 로드 후 호출) */
window.sb = function () {
  if (!window._sb) {
    window._sb = window.supabase.createClient(window.SB_URL, window.SB_KEY, {
      realtime: { params: { eventsPerSecond: 20 } },
      auth: { persistSession: false }
    });
  }
  return window._sb;
};
