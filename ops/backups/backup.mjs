import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

process.umask(0o077);
const required = key => { const v = process.env[key]; if (!v) throw new Error(`Missing configuration: ${key}`); return v; };
const storage = prefix => ({
  bucket: required(prefix + '_NAME'),
  client: new S3Client({ endpoint: required(prefix + '_ENDPOINT'), region: process.env[prefix + '_REGION'] || 'auto', forcePathStyle: process.env[prefix + '_URL_STYLE'] === 'path', credentials: { accessKeyId: required(prefix + '_ACCESS_KEY_ID'), secretAccessKey: required(prefix + '_SECRET_ACCESS_KEY') } }),
});
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function uploadVerified(storage, key, bytes, contentType) {
  const digest = hash(bytes);
  await storage.client.send(new PutObjectCommand({ Bucket: storage.bucket, Key: key, Body: bytes, ContentType: contentType, Metadata: { sha256: digest } }));
  const response = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: key }));
  if (hash(await response.Body.transformToByteArray()) !== digest) throw new Error('Remote backup checksum mismatch');
  return { key, sha256: digest, bytes: bytes.length };
}
async function* objects(storage, prefix = '') {
  let token;
  do {
    const page = await storage.client.send(new ListObjectsV2Command({ Bucket: storage.bucket, Prefix: prefix, ContinuationToken: token }));
    yield* page.Contents || [];
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}
let temporary;
try {
  const backup = storage('BACKUP_BUCKET'), documents = storage('DOCUMENT_BUCKET');
  const url = new URL(required('DATABASE_URL'));
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGCONNECT_TIMEOUT: '20' };
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'erp-backup-'));
  const filename = path.join(temporary, 'database.dump');
  try {
    execFileSync('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', filename], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    execFileSync('pg_restore', ['--list', filename], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch { throw new Error('PostgreSQL backup or archive validation failed'); }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const database = await uploadVerified(backup, `database/${stamp}.dump`, await fs.readFile(filename), 'application/octet-stream');
  const manifest = { createdAt: new Date().toISOString(), database, documents: [] };
  for await (const object of objects(documents)) {
    const response = await documents.client.send(new GetObjectCommand({ Bucket: documents.bucket, Key: object.Key }));
    const bytes = await response.Body.transformToByteArray();
    const copy = await uploadVerified(backup, `documents/${hash(bytes)}`, bytes, response.ContentType || 'application/octet-stream');
    manifest.documents.push({ originalKey: object.Key, ...copy });
  }
  await uploadVerified(backup, `manifests/${stamp}.json`, Buffer.from(JSON.stringify(manifest)), 'application/json');
  // Expire database snapshots and manifests only after the new complete backup is verified.
  // Immutable document copies remain available for historical database restores.
  const cutoff = Date.now() - 30 * 86400000;
  for (const prefix of ['database/', 'manifests/']) {
    for await (const object of objects(backup, prefix)) {
      if (object.LastModified?.getTime() < cutoff) await backup.client.send(new DeleteObjectCommand({ Bucket: backup.bucket, Key: object.Key }));
    }
  }
  console.log(JSON.stringify({ status: 'backup_verified', databaseBytes: database.bytes, documentCount: manifest.documents.length, retentionDays: 30 }));
} catch (error) {
  // SDK/CLI error messages can contain credentials or private object names.
  console.error(JSON.stringify({ status: 'backup_failed', errorType: error?.name || 'Error' }));
  process.exitCode = 1;
} finally {
  if (temporary) await fs.rm(temporary, { recursive: true, force: true });
}
