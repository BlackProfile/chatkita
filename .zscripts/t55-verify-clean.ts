/**
 * Verifikasi bersih pasca Task 55 — tidak ada sisa uji.
 * Jalankan: bun .zscripts/t55-verify-clean.ts
 */
import { Database } from "bun:sqlite";
import { readdirSync } from "node:fs";

const db = new Database("/home/z/my-project/mini-services/chat-service/chat.db", { readonly: true });
const reg = db.query("SELECT value FROM settings WHERE key='allowRegistration'").get() as { value: string } | undefined;
const users = db.query("SELECT COUNT(*) n FROM users").get() as { n: number };
const uji = db.query("SELECT COUNT(*) n FROM users WHERE name LIKE 'UjiBrowser%'").get() as { n: number };
const msgs = db.query("SELECT COUNT(*) n FROM messages WHERE content LIKE '/api/media/t55-old-%'").get() as { n: number };
const convs = db.query("SELECT COUNT(*) n FROM conversations WHERE user_a_id LIKE 'UjiBrowser55%' OR user_b_id IN (SELECT id FROM users WHERE name='UjiBrowser55')").get() as { n: number };
const files = readdirSync("/home/z/my-project/db/media").filter((f) => f.startsWith("t55-old-")).length;
process.stdout.write(`allowRegistration=${reg?.value ?? "(kosong)"} users=${users.n} sisaUjiBrowser=${uji.n} sisaMsgT55=${msgs.n} sisaConvT55=${convs.n} sisaFileT55=${files}\n`);
