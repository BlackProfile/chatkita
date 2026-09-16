"use client";

/**
 * v69 — Konsol Database (Task 85): admin mengedit database lengkap langsung
 * dari aplikasi — browse tabel, edit sel, tambah/hapus baris, SQL bebas.
 *
 * Anti-bocor berlapis:
 * - STEP-UP: password admin diminta lagi khusus untuk membuka konsol
 *   (admin:db_unlock) dan TERKUNCI lagi setiap dialog ditutup (admin:db_lock);
 *   TOTP ikut dituntut bila 2FA aktif (konsisten admin:auth).
 * - Masking kolom sensitif (password/token/hash/secret/…) default AKTIF agar
 *   screenshot tidak membocorkan nilai — bisa dibuka manual per sesi.
 * - Server memvalidasi tabel/kolom ke sqlite_master & PRAGMA table_info,
 *   nilai lewat prepared statement, dan mencatat SEMUA perubahan ke audit log.
 * - Cadangan fisik otomatis (VACUUM INTO) sebelum penulisan pertama tiap
 *   sesi + tombol backup manual.
 */

import { useCallback, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  Database,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Table2,
  Trash2,
  View,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  AckOf,
  DbBackupAck,
  DbRowsAck,
  DbSchemaAck,
  DbSqlAck,
  DbUnlockAck,
  DbWriteAck,
} from "@/lib/chat-types";
import { cn } from "@/lib/utils";

const ROWS_PAGE = 60;

/** Kolom bernama sensitif → nilai ditampilkan •••• selama masking aktif. */
const SENSITIVE_COL_RE =
  /(pass|token|secret|hash|salt|vapid|private|apikey|api_key|credential|otp)/i;

const fmtBytes = (n: number): string => {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
};

const previewOf = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

function ErrText({ res }: { res: { error?: string } }) {
  const code = res?.error ?? "DB_ERROR";
  const map: Record<string, string> = {
    UNAUTHORIZED: "Password salah.",
    RATE_LIMITED: "Terlalu banyak percobaan — tunggu sebentar.",
    TOTP_REQUIRED: "Kode 2FA diperlukan.",
    INVALID_TOTP: "Kode 2FA salah.",
    DB_LOCKED: "Konsol terkunci — buka dengan password admin dulu.",
    INVALID_TABLE: "Tabel tidak dikenal.",
    INVALID_COLUMN: "Kolom tidak dikenal.",
    INVALID_ROW: "Baris tidak valid.",
    NOT_EDITABLE: "Objek ini (view) tidak bisa diedit — gunakan SQL.",
    EMPTY_SQL: "SQL masih kosong.",
    SQL_TOO_LARGE: "SQL terlalu panjang (maks 20.000 karakter).",
    VALUE_TOO_LARGE: "Nilai terlalu besar (maks 100.000 karakter).",
    NO_COLUMNS: "Tidak ada kolom yang diisi.",
  };
  const detail = (res as { detail?: string }).detail;
  return (
    <p className="text-xs text-destructive" role="alert">
      {map[code] ?? `Gagal (${code})`}
      {detail ? <span className="block font-mono text-[10px] opacity-80">{detail}</span> : null}
    </p>
  );
}

export function DbConsole({
  open,
  onOpenChange,
  socket,
  onNotice,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Socket admin yang sudah terautentikasi (admin:auth). */
  socket: Socket | null;
  onNotice?: (text: string) => void;
}) {
  /* step-up unlock */
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [totpRequired, setTotpRequired] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<{ error?: string } | null>(null);

  /* skema + browsing */
  const [schema, setSchema] = useState<DbSchemaAck | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [rows, setRows] = useState<DbRowsAck | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<{ error?: string } | null>(null);
  const [whereDraft, setWhereDraft] = useState("");
  const [whereApplied, setWhereApplied] = useState("");
  const [showDdl, setShowDdl] = useState(false);

  /* masking & aksi */
  const [hideSensitive, setHideSensitive] = useState(true);
  const [editTarget, setEditTarget] = useState<{
    rid: number;
    column: string;
    value: string | null;
    sensitive: boolean;
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editNull, setEditNull] = useState(false);
  const [savingCell, setSavingCell] = useState(false);
  const [cellError, setCellError] = useState<string | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const [insertValues, setInsertValues] = useState<Record<string, { v: string; isNull: boolean }>>({});
  const [insertError, setInsertError] = useState<string | null>(null);
  const [inserting, setInserting] = useState(false);

  /* SQL bebas */
  const [sqlText, setSqlText] = useState("SELECT name, type FROM sqlite_master WHERE type IN ('table','view')");
  const [sqlRunning, setSqlRunning] = useState(false);
  const [sqlResult, setSqlResult] = useState<DbSqlAck | null>(null);
  const [sqlError, setSqlError] = useState<{ error?: string } | null>(null);

  const loadSchema = useCallback(
    (thenSelect?: string) => {
      if (!socket?.connected) return;
      setSchemaLoading(true);
      socket.emit("admin:db_schema", {}, (res: AckOf<DbSchemaAck>) => {
        setSchemaLoading(false);
        if (res.ok) {
          setSchema(res);
          if (thenSelect) setActiveTable(thenSelect);
        } else {
          setUnlockError(res);
          setUnlocked(false);
        }
      });
    },
    [socket]
  );

  const loadRows = useCallback(
    (table: string, page: number, where: string) => {
      if (!socket?.connected) return;
      setRowsLoading(true);
      setRowsError(null);
      socket.emit(
        "admin:db_rows",
        { table, page, where: where || undefined },
        (res: AckOf<DbRowsAck>) => {
          setRowsLoading(false);
          if (res.ok) setRows(res);
          else setRowsError(res);
        }
      );
    },
    [socket]
  );

  const selectTable = useCallback(
    (name: string) => {
      setActiveTable(name);
      setWhereDraft("");
      setWhereApplied("");
      setShowDdl(false);
      setRows(null);
      loadRows(name, 0, "");
    },
    [loadRows]
  );

  const lockNow = useCallback(() => {
    socket?.emit("admin:db_lock", {});
    setUnlocked(false);
    setSchema(null);
    setRows(null);
    setActiveTable(null);
    setPassword("");
    setTotp("");
    setTotpRequired(false);
  }, [socket]);

  /** Tutup dialog → kunci kembali konsol di server (step-up tiap kali buka).
   * Komponen di-unmount saat tertutup, jadi state ikut reset total. */
  const handleClose = useCallback(
    (v: boolean) => {
      if (!v) socket?.emit("admin:db_lock", {});
      onOpenChange(v);
    },
    [socket, onOpenChange]
  );

  const submitUnlock = () => {
    if (!socket?.connected || !password) return;
    setUnlocking(true);
    setUnlockError(null);
    socket.emit(
      "admin:db_unlock",
      { password, totp: totpRequired ? totp : undefined },
      (res: AckOf<DbUnlockAck>) => {
        setUnlocking(false);
        if (res.ok) {
          setUnlocked(true);
          setPassword("");
          setTotp("");
          setTotpRequired(false);
          loadSchema();
          onNotice?.("Konsol database terbuka — semua perubahan dicatat di audit log.");
        } else {
          if (res.error === "TOTP_REQUIRED") setTotpRequired(true);
          setUnlockError(res);
        }
      }
    );
  };

  const saveCell = () => {
    if (!socket || !editTarget || !activeTable) return;
    setSavingCell(true);
    setCellError(null);
    socket.emit(
      "admin:db_cell_update",
      {
        table: activeTable,
        rid: editTarget.rid,
        column: editTarget.column,
        value: editNull ? undefined : editValue,
        isNull: editNull,
      },
      (res: AckOf<DbWriteAck>) => {
        setSavingCell(false);
        if (res.ok) {
          setEditTarget(null);
          onNotice?.(
            `Sel tersimpan ✓${res.autoBackup ? ` — cadangan otomatis: ${res.autoBackup}` : ""}`
          );
          loadRows(activeTable, rows?.page ?? 0, whereApplied);
        } else setCellError(res.error ?? "DB_ERROR");
      }
    );
  };

  const deleteRow = (rid: number) => {
    if (!socket || !activeTable) return;
    if (!window.confirm(`Hapus baris rowid=${rid} dari tabel "${activeTable}" secara permanen?`))
      return;
    socket.emit("admin:db_row_delete", { table: activeTable, rid }, (res: AckOf<DbWriteAck>) => {
      if (res.ok) {
        onNotice?.(
          `Baris dihapus ✓${res.autoBackup ? ` — cadangan otomatis: ${res.autoBackup}` : ""}`
        );
        loadRows(activeTable, rows?.page ?? 0, whereApplied);
      } else onNotice?.(`Hapus gagal (${res.error})`);
    });
  };

  const openInsert = () => {
    if (!rows) return;
    const init: Record<string, { v: string; isNull: boolean }> = {};
    for (const c of rows.columns) {
      const autoPk = c.pk && /int/i.test(c.type);
      init[c.name] = { v: autoPk ? "(otomatis)" : (c.dflt ?? ""), isNull: false };
    }
    setInsertValues(init);
    setInsertError(null);
    setInsertOpen(true);
  };

  const submitInsert = () => {
    if (!socket || !activeTable || !rows) return;
    setInserting(true);
    setInsertError(null);
    const values: Record<string, string | null> = {};
    for (const c of rows.columns) {
      if (c.pk && /int/i.test(c.type)) continue;
      const it = insertValues[c.name];
      if (!it) continue;
      values[c.name] = it.isNull ? null : it.v;
    }
    socket.emit(
      "admin:db_row_insert",
      { table: activeTable, values },
      (res: AckOf<DbWriteAck>) => {
        setInserting(false);
        if (res.ok) {
          setInsertOpen(false);
          onNotice?.(
            `Baris ditambahkan (rowid ${res.lastInsertRowid}) ✓${
              res.autoBackup ? ` — cadangan otomatis: ${res.autoBackup}` : ""
            }`
          );
          loadRows(activeTable, 0, whereApplied);
        } else setInsertError(res.error ?? "DB_ERROR");
      }
    );
  };

  const runSql = useCallback(() => {
    if (!socket?.connected || !sqlText.trim()) return;
    setSqlRunning(true);
    setSqlError(null);
    socket.emit("admin:db_sql", { sql: sqlText }, (res: AckOf<DbSqlAck>) => {
      setSqlRunning(false);
      if (res.ok) {
        setSqlResult(res);
        if (res.autoBackup) onNotice?.(`Cadangan otomatis: ${res.autoBackup}`);
        // DDL/DML bisa mengubah daftar tabel → segarkan skema diam-diam.
        loadSchema(activeTable ?? undefined);
      } else setSqlError(res);
    });
  }, [socket, sqlText, onNotice, loadSchema, activeTable]);

  const manualBackup = () => {
    if (!socket?.connected) return;
    socket.emit("admin:db_backup", {}, (res: AckOf<DbBackupAck>) => {
      if (res.ok) {
        setSchema((s) => (s ? { ...s, backups: res.backups } : s));
        onNotice?.(`Cadangan dibuat: ${res.file}`);
      } else onNotice?.(`Backup gagal (${res.error})`);
    });
  };

  const cellClass = (v: unknown, colName: string): string => {
    const sensitive = hideSensitive && SENSITIVE_COL_RE.test(colName);
    if (sensitive && v !== null && v !== "") return "text-muted-foreground";
    if (v === null) return "italic text-muted-foreground/60";
    return "";
  };

  const cellText = (v: unknown, colName: string): string => {
    const raw = previewOf(v);
    const sensitive = hideSensitive && SENSITIVE_COL_RE.test(colName);
    if (sensitive && v !== null && v !== "") return "••••••••";
    return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
  };

  const totalPages = rows ? Math.max(1, Math.ceil(rows.total / ROWS_PAGE)) : 1;
  const activeDdl = schema?.tables.find((t) => t.name === activeTable)?.ddl ?? "";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      {/* v70 — konsol kini FULLSCREEN: tabel data memakai sisa tinggi layar,
          langkah unlock dipusatkan di kanvas penuh. */}
      <DialogContent fullscreen>
        {!unlocked ? (
          <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col justify-center gap-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Database className="size-4 text-emerald-600" aria-hidden="true" />
                Konsol database
              </DialogTitle>
              <DialogDescription>
                Akses penuh baca &amp; tulis ke database (SQLite). Konsol meminta password admin
                sekali lagi (step-up) dan terkunci otomatis setiap dialog ditutup.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
              <p className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  Di dalam konsol Anda bisa mengubah/menghapus data apa pun. Sebelum penulisan
                  pertama, <strong>cadangan otomatis</strong> dibuat (backups/dbconsole-*.db) dan{" "}
                  <strong>semua perintah dicatat di audit log</strong>. Nilai kolom sensitif
                  (password/token/hash) disembunyikan agar tidak bocor lewat screenshot.
                </span>
              </p>
            </div>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                submitUnlock();
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="dbconsole-pass">Password admin</Label>
                <Input
                  id="dbconsole-pass"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password admin"
                  autoFocus
                />
              </div>
              {totpRequired ? (
                <div className="space-y-1">
                  <Label htmlFor="dbconsole-totp">Kode 2FA (TOTP)</Label>
                  <Input
                    id="dbconsole-totp"
                    inputMode="numeric"
                    value={totp}
                    onChange={(e) => setTotp(e.target.value)}
                    placeholder="6 digit"
                    maxLength={6}
                  />
                </div>
              ) : null}
              {unlockError ? <ErrText res={unlockError} /> : null}
              <Button type="submit" className="w-full" disabled={unlocking || !password}>
                {unlocking ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Lock className="size-4" aria-hidden="true" />
                )}
                Buka konsol
              </Button>
            </form>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Database className="size-4 text-emerald-600" aria-hidden="true" />
                Konsol database
                <Badge variant="outline" className="font-mono text-[10px]">
                  {fmtBytes(schema?.dbBytes ?? 0)}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {schema?.tables.length ?? 0} objek
                </Badge>
              </DialogTitle>
              <DialogDescription>
                Klik sel untuk mengedit · perubahan masuk audit log · cadangan otomatis sebelum
                tulisan pertama.
              </DialogDescription>
            </DialogHeader>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => loadSchema(activeTable ?? undefined)}
                disabled={schemaLoading}
              >
                {schemaLoading ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                )}
                Muat ulang
              </Button>
              <Button size="sm" variant="outline" className="h-8" onClick={manualBackup}>
                Cadangkan
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => setHideSensitive((v) => !v)}
                title={
                  hideSensitive
                    ? "Nilai sensitif disembunyikan — klik untuk menampilkan"
                    : "Nilai sensitif tampil — klik untuk menyembunyikan"
                }
              >
                {hideSensitive ? (
                  <EyeOff className="size-3.5" aria-hidden="true" />
                ) : (
                  <Eye className="size-3.5" aria-hidden="true" />
                )}
                {hideSensitive ? "Sembunyikan nilai sensitif" : "Tampilkan nilai sensitif"}
              </Button>
              <span className="text-[10px] text-muted-foreground">
                {schema?.backups.length ?? 0} backup konsol
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-8 text-destructive hover:text-destructive"
                onClick={lockNow}
              >
                <Lock className="size-3.5" aria-hidden="true" />
                Kunci konsol
              </Button>
            </div>

            {/* Skema + browser — v70: isi sisa tinggi layar (fullscreen),
                daftar tabel & tabel data menggulir internal tanpa cap max-h. */}
            <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 md:grid-cols-[14rem_1fr] md:grid-rows-1">
              <div className="max-h-44 min-h-0 overflow-y-auto rounded-xl border md:max-h-none">
                {schema === null ? (
                  <p className="flex items-center justify-center gap-2 p-4 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    Memuat skema…
                  </p>
                ) : (
                  <ul className="p-1">
                    {schema.tables.map((t) => (
                      <li key={t.name}>
                        <button
                          type="button"
                          className={cn(
                            "flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                            activeTable === t.name && "bg-accent"
                          )}
                          onClick={() => selectTable(t.name)}
                          title={t.type === "view" ? "View (baca saja)" : t.name}
                        >
                          {t.type === "view" ? (
                            <View className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          ) : (
                            <Table2 className="size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                          )}
                          <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                            {t.rows >= 0 ? t.rows : "?"}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex min-h-0 min-w-0 flex-col gap-2">
                {!activeTable ? (
                  <p className="flex h-32 items-center justify-center rounded-xl border text-xs text-muted-foreground">
                    Pilih tabel di kiri untuk menjelajah isinya.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold">{activeTable}</span>
                      {rows && !rows.editable ? (
                        <Badge variant="outline" className="text-[10px]">
                          baca-saja (view) — pakai SQL
                        </Badge>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto h-7 text-xs"
                        onClick={() => setShowDdl((v) => !v)}
                      >
                        {showDdl ? "Sembunyikan DDL" : "Lihat DDL"}
                      </Button>
                      {rows?.editable ? (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openInsert}>
                          <Plus className="size-3.5" aria-hidden="true" />
                          Tambah baris
                        </Button>
                      ) : null}
                    </div>

                    {showDdl ? (
                      <pre className="max-h-32 overflow-auto rounded-lg border bg-muted/40 p-2 font-mono text-[10px] leading-relaxed">
                        {activeDdl || "—"}
                      </pre>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Input
                        value={whereDraft}
                        onChange={(e) => setWhereDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && activeTable) {
                            setWhereApplied(whereDraft.trim());
                            loadRows(activeTable, 0, whereDraft.trim());
                          }
                        }}
                        placeholder="Filter WHERE (mis. id > 5)"
                        className="h-8 flex-1 font-mono text-xs"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={!activeTable}
                        onClick={() => {
                          setWhereApplied(whereDraft.trim());
                          loadRows(activeTable, 0, whereDraft.trim());
                        }}
                      >
                        Terapkan
                      </Button>
                      {whereApplied ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8"
                          onClick={() => {
                            setWhereDraft("");
                            setWhereApplied("");
                            if (activeTable) loadRows(activeTable, 0, "");
                          }}
                        >
                          Bersihkan
                        </Button>
                      ) : null}
                    </div>

                    {rowsError ? <ErrText res={rowsError} /> : null}

                    <div className="min-h-0 flex-1 overflow-auto rounded-xl border">
                      {rowsLoading && !rows ? (
                        <p className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          Memuat baris…
                        </p>
                      ) : !rows || rows.rows.length === 0 ? (
                        <p className="p-6 text-center text-xs text-muted-foreground">
                          Tidak ada baris{whereApplied ? ` untuk filter "${whereApplied}"` : ""}.
                        </p>
                      ) : (
                        <table className="w-full border-collapse text-xs">
                          <thead>
                            <tr className="sticky top-0 z-10 bg-muted">
                              <th className="border-b px-2 py-1.5 text-left font-mono text-[10px] font-semibold uppercase text-muted-foreground">
                                rowid
                              </th>
                              {rows.columns.map((c) => (
                                <th
                                  key={c.name}
                                  className="border-b px-2 py-1.5 text-left font-mono text-[10px] font-semibold uppercase text-muted-foreground"
                                  title={`${c.type || "afinitas bebas"}${c.notnull ? " NOT NULL" : ""}${c.pk ? " · PK" : ""}`}
                                >
                                  {c.name}
                                  {c.pk ? " 🔑" : ""}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.rows.map((r, i) => {
                              const rid = Number(r.__rid);
                              return (
                                <tr key={rid ?? i} className="hover:bg-accent/40">
                                  <td className="border-b px-2 py-1 font-mono text-[10px] text-muted-foreground">
                                    {Number.isFinite(rid) ? rid : "—"}
                                  </td>
                                  {rows.columns.map((c) => (
                                    <td key={c.name} className="max-w-[16rem] border-b px-2 py-1">
                                      {rows.editable ? (
                                        <button
                                          type="button"
                                          className={cn(
                                            "block w-full truncate text-left font-mono hover:underline",
                                            cellClass(r[c.name], c.name)
                                          )}
                                          title={`${c.name} = ${previewOf(r[c.name])} — klik untuk edit`}
                                          onClick={() => {
                                            const sensitive = SENSITIVE_COL_RE.test(c.name);
                                            setEditTarget({
                                              rid,
                                              column: c.name,
                                              value: r[c.name] === null || r[c.name] === undefined ? null : previewOf(r[c.name]),
                                              sensitive,
                                            });
                                            setEditValue(
                                              r[c.name] === null || r[c.name] === undefined ? "" : previewOf(r[c.name])
                                            );
                                            setEditNull(r[c.name] === null || r[c.name] === undefined);
                                            setCellError(null);
                                          }}
                                        >
                                          {cellText(r[c.name], c.name)}
                                        </button>
                                      ) : (
                                        <span
                                          className={cn("block truncate font-mono", cellClass(r[c.name], c.name))}
                                          title={previewOf(r[c.name])}
                                        >
                                          {cellText(r[c.name], c.name)}
                                        </span>
                                      )}
                                    </td>
                                  ))}
                                  {rows.editable ? (
                                    <td className="whitespace-nowrap border-b px-1 py-1 text-right">
                                      <button
                                        type="button"
                                        className="inline-flex size-6 items-center justify-center rounded hover:bg-accent"
                                        title="Edit baris (buka sel pertama yang bisa diedit)"
                                        aria-label={`Edit baris ${rid}`}
                                        onClick={() => {
                                          const first = rows.columns[0];
                                          if (!first) return;
                                          setEditTarget({
                                            rid,
                                            column: first.name,
                                            value:
                                              r[first.name] === null || r[first.name] === undefined
                                                ? null
                                                : previewOf(r[first.name]),
                                            sensitive: SENSITIVE_COL_RE.test(first.name),
                                          });
                                          setEditValue(
                                            r[first.name] === null || r[first.name] === undefined
                                              ? ""
                                              : previewOf(r[first.name])
                                          );
                                          setEditNull(r[first.name] === null || r[first.name] === undefined);
                                          setCellError(null);
                                        }}
                                      >
                                        <Pencil className="size-3" aria-hidden="true" />
                                      </button>
                                      <button
                                        type="button"
                                        className="inline-flex size-6 items-center justify-center rounded text-destructive hover:bg-destructive/10"
                                        title="Hapus baris"
                                        aria-label={`Hapus baris ${rid}`}
                                        onClick={() => deleteRow(rid)}
                                      >
                                        <Trash2 className="size-3" aria-hidden="true" />
                                      </button>
                                    </td>
                                  ) : null}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>
                        Hal {rows ? rows.page + 1 : 1}/{totalPages} · {rows?.total ?? 0} baris
                        {whereApplied ? ` (difilter)` : ""}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto h-7 text-xs"
                        disabled={!rows || rowsLoading || (rows?.page ?? 0) <= 0}
                        onClick={() => activeTable && loadRows(activeTable, (rows?.page ?? 0) - 1, whereApplied)}
                      >
                        ‹ Sebelumnya
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={
                          !rows ||
                          rowsLoading ||
                          (rows?.page ?? 0) >= totalPages - 1
                        }
                        onClick={() => activeTable && loadRows(activeTable, (rows?.page ?? 0) + 1, whereApplied)}
                      >
                        Berikutnya ›
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* SQL bebas */}
            <div className="space-y-2 rounded-xl border p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold">SQL bebas</span>
                <span className="text-[10px] text-muted-foreground">
                  Ctrl/⌘+Enter untuk menjalankan · SELECT → hasil, lainnya dieksekusi
                </span>
              </div>
              <Textarea
                value={sqlText}
                onChange={(e) => setSqlText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    runSql();
                  }
                }}
                className="h-20 resize-y font-mono text-xs"
                spellCheck={false}
                aria-label="Perintah SQL"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" className="h-8" onClick={runSql} disabled={sqlRunning || !sqlText.trim()}>
                  {sqlRunning ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                  )}
                  Jalankan
                </Button>
                {sqlError ? <ErrText res={sqlError} /> : null}
              </div>
              {sqlResult ? (
                sqlResult.kind === "rows" ? (
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground">
                      {sqlResult.rows?.length ?? 0} baris
                      {sqlResult.truncated ? " (dipotong 400)" : ""} · {sqlResult.executed} statement
                    </p>
                    <div className="max-h-64 overflow-auto rounded-lg border">
                      {sqlResult.rows && sqlResult.rows.length > 0 ? (
                        <table className="w-full border-collapse text-xs">
                          <thead>
                            <tr className="sticky top-0 bg-muted">
                              {sqlResult.columns.map((c) => (
                                <th
                                  key={c}
                                  className="border-b px-2 py-1 text-left font-mono text-[10px] font-semibold uppercase text-muted-foreground"
                                >
                                  {c}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sqlResult.rows.map((r, i) => (
                              <tr key={i} className="hover:bg-accent/40">
                                {sqlResult.columns!.map((c) => (
                                  <td
                                    key={c}
                                    className={cn(
                                      "max-w-[16rem] truncate border-b px-2 py-1 font-mono",
                                      cellClass(r[c], c)
                                    )}
                                    title={previewOf(r[c])}
                                  >
                                    {cellText(r[c], c)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="p-3 text-center text-xs text-muted-foreground">0 baris.</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="rounded-lg bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                    Berhasil: {sqlResult.changes ?? 0} baris terpengaruh
                    {sqlResult.lastInsertRowid ? ` · rowid terakhir ${sqlResult.lastInsertRowid}` : ""} ·{" "}
                    {sqlResult.executed} statement
                    {sqlResult.autoBackup ? ` · cadangan: ${sqlResult.autoBackup}` : ""}
                  </p>
                )
              ) : null}
            </div>
          </>
        )}
      </DialogContent>

      {/* Dialog edit satu sel */}
      <Dialog open={!!editTarget} onOpenChange={(v) => !v && setEditTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Edit {activeTable}.{editTarget?.column} · rowid {editTarget?.rid}
            </DialogTitle>
            <DialogDescription>
              {editTarget?.sensitive
                ? "Kolom sensitif — nilai asli tampil hanya di sini karena Anda membuka editor."
                : "Nilai disimpan apa adanya (teks); kolom angka ikut afinitas SQLite."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="dbconsole-null"
                checked={editNull}
                onCheckedChange={(v) => setEditNull(v === true)}
              />
              <Label htmlFor="dbconsole-null" className="text-xs">
                Simpan sebagai NULL
              </Label>
            </div>
            <Textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              disabled={editNull}
              className="h-28 resize-y font-mono text-xs"
              spellCheck={false}
              aria-label="Nilai sel"
            />
            {cellError ? <ErrText res={{ error: cellError }} /> : null}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditTarget(null)}>
                Batal
              </Button>
              <Button size="sm" onClick={saveCell} disabled={savingCell}>
                {savingCell ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : null}
                Simpan
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog tambah baris */}
      <Dialog open={insertOpen} onOpenChange={setInsertOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">Tambah baris · {activeTable}</DialogTitle>
            <DialogDescription>
              Kolom bertanda 🔑 (INTEGER) diisi otomatis. Kosongkan atau centang NULL sesuai
              kebutuhan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {rows?.columns.map((c) => {
              const autoPk = c.pk && /int/i.test(c.type);
              const it = insertValues[c.name] ?? { v: "", isNull: false };
              return (
                <div key={c.name} className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <div className="min-w-0">
                    <Label className="font-mono text-[10px] text-muted-foreground" htmlFor={`ins-${c.name}`}>
                      {c.name} {c.pk ? "🔑" : ""} · {c.type || "bebas"}
                      {c.notnull ? " · NOT NULL" : ""}
                      {autoPk ? " · otomatis" : ""}
                    </Label>
                    <Input
                      id={`ins-${c.name}`}
                      value={autoPk ? "(otomatis)" : it.isNull ? "" : it.v}
                      disabled={autoPk || it.isNull}
                      onChange={(e) =>
                        setInsertValues((s) => ({ ...s, [c.name]: { ...it, v: e.target.value } }))
                      }
                      className="h-8 font-mono text-xs"
                      placeholder={c.dflt ?? (autoPk ? "(otomatis)" : "")}
                    />
                  </div>
                  {!autoPk ? (
                    <Checkbox
                      aria-label={`NULL untuk ${c.name}`}
                      checked={it.isNull}
                      onCheckedChange={(v) =>
                        setInsertValues((s) => ({ ...s, [c.name]: { ...it, isNull: v === true } }))
                      }
                    />
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
            {insertError ? <ErrText res={{ error: insertError }} /> : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => setInsertOpen(false)}>
                Batal
              </Button>
              <Button size="sm" onClick={submitInsert} disabled={inserting}>
                {inserting ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                Tambahkan
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
