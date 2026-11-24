// Consistent online backup of the SQLite database (safe while the server runs). Usage: DATA_DIR=./data-store node scripts/backup.js [outfile]
import { DatabaseSync } from 'node:sqlite'; import { join, resolve } from 'node:path'; import { existsSync, mkdirSync } from 'node:fs';
const dir = resolve(process.env.DATA_DIR || 'data-store'); const src = join(dir, 'dlp.sqlite');
if (!existsSync(src)) { console.error('No database at ' + src); process.exit(1); }
mkdirSync(join(dir, 'backups'), { recursive: true }); const out = resolve(process.argv[2] || join(dir, 'backups', `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`));
const db = new DatabaseSync(src); db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`); db.close(); console.log('Backup written to ' + out + '\nRemember to back up .keys.json (or your SESSION_SECRET / DB_ENCRYPTION_KEY) separately: the data is unreadable without the key.');
