async function request(path, options = {}) {
  const response = await fetch(path, {headers: {"Content-Type": "application/json", ...(options.headers || {})}, ...options});
  if (!response.ok) {
    const raw = await response.text();
    let message = raw;
    try {
      const parsed = JSON.parse(raw);
      message = typeof parsed.detail === "string" ? parsed.detail : parsed.detail?.[0]?.msg;
    } catch {
      // The server may return plain text.
    }
    throw new Error(message || `Не удалось выполнить запрос. Код ошибки: ${response.status}`);
  }
  return response.json();
}

export const api = {
  config: () => request("/api/config"),
  start: data => request("/api/sessions", {method: "POST", body: JSON.stringify(data)}),
  session: id => request(`/api/sessions/${encodeURIComponent(id)}`),
  state: (id, state) => request(`/api/sessions/${encodeURIComponent(id)}/state`, {method: "PUT", body: JSON.stringify({state})}),
  record: (id, record_type, record_key, payload) => request(`/api/sessions/${encodeURIComponent(id)}/records`, {method: "PUT", body: JSON.stringify({record_type, record_key, payload})}),
  event: (id, event_code, event_name, details = {}) => request(`/api/sessions/${encodeURIComponent(id)}/events`, {method: "POST", body: JSON.stringify({timestamp_unix_ms: Date.now(), timestamp_monotonic_ms: performance.now(), event_code, event_name, segment_id: details.segment_id || null, condition: details.condition || null, payload: details.payload || {}})}),
  complete: id => request(`/api/sessions/${encodeURIComponent(id)}/complete`, {method: "POST"}),
};
