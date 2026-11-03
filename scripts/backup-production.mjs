import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.umask(0o077);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = process.env.BACKUP_DIR || path.join(root, 'backups');
const project = process.env.BACKUP_RAILWAY_PROJECT_ID || '16793114-d228-43d9-a257-64cbf4007933';
function binary(name) {
  try { execFileSync(name, ['--version'], { stdio: 'ignore' }); return name; } catch {}
  try {
    const prefix = execFileSync('brew', ['--prefix', 'libpq'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const candidate = path.join(prefix, 'bin', name);
    execFileSync(candidate, ['--version'], { stdio: 'ignore' });
    return candidate;
  } catch { throw new Error(`Chýba ${name}. Nainštalujte PostgreSQL klienta (macOS: brew install libpq).`); }
}
let partial;
try {
  const dump = binary('pg_dump'), restore = binary('pg_restore');
  const variables = JSON.parse(execFileSync('railway', ['variable', 'list', '--project', project, '--environment', process.env.BACKUP_RAILWAY_ENVIRONMENT || 'production', '--service', process.env.BACKUP_RAILWAY_DATABASE_SERVICE || 'Postgres', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  if (variables.RAILWAY_PROJECT_ID !== project) throw new Error('Railway prístup smeruje na iný projekt. Záloha sa nespustila.');
  for (const key of ['RAILWAY_TCP_PROXY_DOMAIN', 'RAILWAY_TCP_PROXY_PORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']) {
    if (!variables[key]) throw new Error(`Databáza nemá nastavenú premennú ${key}.`);
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, `zdravy-shot-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
  partial = filename + '.partial';
  const env = { ...process.env, PGHOST: variables.RAILWAY_TCP_PROXY_DOMAIN, PGPORT: variables.RAILWAY_TCP_PROXY_PORT, PGUSER: variables.PGUSER, PGPASSWORD: variables.PGPASSWORD, PGDATABASE: variables.PGDATABASE, PGCONNECT_TIMEOUT: '20' };
  try {
    execFileSync(dump, ['--format=custom', '--no-owner', '--no-acl', '--file', partial], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    execFileSync(restore, ['--list', partial], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch { throw new Error('Zálohu databázy sa nepodarilo vytvoriť alebo overiť; staršie zálohy zostali zachované.'); }
  fs.chmodSync(partial, 0o600);
  fs.renameSync(partial, filename);
  partial = undefined;
  for (const entry of fs.readdirSync(directory)) {
    if (!/^zdravy-shot-.*\.dump$/.test(entry)) continue;
    const old = path.join(directory, entry);
    if (old !== filename && fs.statSync(old).mtimeMs < Date.now() - 30 * 86400000) fs.unlinkSync(old);
  }
  console.log(`Overená záloha uložená: ${filename}`);
} catch (error) {
  if (partial) fs.rmSync(partial, { force: true });
  // CLI/PostgreSQL errors can contain secrets; never print their captured output.
  console.error(error instanceof Error && !('stderr' in error) ? error.message : 'Railway prístup k databáze zlyhal. Overte CLI prihlásenie.');
  process.exitCode = 1;
}
