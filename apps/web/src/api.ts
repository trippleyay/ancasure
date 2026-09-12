const API = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export async function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  const r = await fetch(API + path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? j.reason ?? JSON.stringify(j));
  return j as T;
}

export function shortAddr(a?: string | null) {
  return a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
}

export function fmtEth(wei?: string | number | bigint) {
  try {
    return Number(BigInt(wei ?? 0)) / 1e18;
  } catch {
    return 0;
  }
}
