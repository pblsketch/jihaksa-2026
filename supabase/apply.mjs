/**
 * schema.sql 을 Supabase Management API 로 실행합니다.
 *   SUPABASE_PAT=sbp_... node supabase/apply.mjs [파일경로]
 * 토큰은 인자로 받지 않고 환경변수로만 읽습니다 (기록에 남지 않도록).
 */
import { readFileSync } from 'node:fs';

const REF = 'wzvcienycrebfpqjpwzv';
const PAT = process.env.SUPABASE_PAT;
if (!PAT) { console.error('SUPABASE_PAT 환경변수가 없습니다.'); process.exit(1); }

const file = process.argv[2] || new URL('./schema.sql', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sql = readFileSync(file, 'utf8');
console.log(`실행: ${file} (${sql.length.toLocaleString()}자)`);

const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql })
});

const text = await r.text();
console.log(`HTTP ${r.status}`);
console.log(text.slice(0, 4000));
process.exit(r.ok ? 0 : 1);
