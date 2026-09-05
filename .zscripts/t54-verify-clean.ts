import { Database } from "bun:sqlite";
const db = new Database("/home/z/my-project/mini-services/chat-service/chat.db", { readonly: true });
const reg = db.query("SELECT value FROM settings WHERE key='allowRegistration'").get() as { value: string } | undefined;
const inv = db.query("SELECT COUNT(*) n FROM invite_codes WHERE label LIKE '%t49%'").get() as { n: number };
const aud = db.query("SELECT COUNT(*) n FROM audit_log WHERE detail LIKE '%t49%'").get() as { n: number };
const users = db.query("SELECT COUNT(*) n FROM users").get() as { n: number };
process.stdout.write(`allowRegistration=${reg?.value ?? "(kosong)"} kodeT49=${inv.n} auditT49=${aud.n} users=${users.n}\n`);
