import { Database } from "bun:sqlite";
const db = new Database("/home/z/my-project/mini-services/chat-service/chat.db", { readonly: true });
const reg = db.query("SELECT value FROM settings WHERE key='allowRegistration'").get() as { value: string } | undefined;
const users = db.query("SELECT COUNT(*) n FROM users").get() as { n: number };
const uji = db.query("SELECT COUNT(*) n FROM users WHERE name LIKE 'UjiBrowser%'").get() as { n: number };
const conv = db.query("SELECT COUNT(*) n FROM conversations WHERE user_b_id IN (SELECT id FROM users WHERE name LIKE 'Uji%') OR user_a_id IN (SELECT id FROM users WHERE name LIKE 'Uji%')").get() as { n: number };
const rx = db.query("SELECT COUNT(*) n FROM message_reactions r JOIN messages m ON m.id=r.message_id JOIN conversations c ON c.id=m.conversation_id WHERE c.user_a_id LIKE 'Uji%' OR c.user_b_id LIKE 'Uji%'").get() as { n: number };
process.stdout.write(`allowRegistration=${reg?.value ?? "(kosong)"} users=${users.n} sisaUji=${uji.n} sisaConv=${conv.n} sisaReaksi=${rx.n}\n`);
