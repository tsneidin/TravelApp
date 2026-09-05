const TOKEN_KEY = 'travelapp_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });

  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 200) };
    }
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export const apiGet = <T = unknown>(p: string) => api<T>('GET', p);
export const apiPost = <T = unknown>(p: string, b?: unknown) => api<T>('POST', p, b);
export const apiPatch = <T = unknown>(p: string, b?: unknown) => api<T>('PATCH', p, b);
export const apiDelete = <T = unknown>(p: string) => api<T>('DELETE', p);

export function uploadPhotos(tripId: string, files: File[], placeId?: string, caption?: string) {
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  if (placeId) fd.append('placeId', placeId);
  if (caption) fd.append('caption', caption);
  return api<{ photos: { id: string; url: string }[] }>('POST', `/trips/${tripId}/photos`, fd);
}

export function uploadAiDocument(tripId: string, file: File) {
  const fd = new FormData();
  fd.append('file', file);
  return api<{ ok: boolean; document: import('./types').ParsedDocument }>('POST', `/trips/${tripId}/ai/upload-file`, fd);
}