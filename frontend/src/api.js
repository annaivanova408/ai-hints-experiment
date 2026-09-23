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
  event: (id, event_code, event_name, details = {}) => {
    const aoi = [...document.querySelectorAll("[data-aoi]")].map(element => {
      const rect = element.getBoundingClientRect();
      return {name: element.dataset.aoi, x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height)};
    });
    const payload = {...(details.payload || {}), aoi, viewport: {width: window.innerWidth, height: window.innerHeight, device_pixel_ratio: window.devicePixelRatio}};
    return request(`/api/sessions/${encodeURIComponent(id)}/events`, {method: "POST", body: JSON.stringify({timestamp_unix_ms: Date.now(), timestamp_monotonic_ms: performance.now(), event_code, event_name, segment_id: details.segment_id || null, condition: details.condition || null, payload})});
  },
  complete: id => request(`/api/sessions/${encodeURIComponent(id)}/complete`, {method: "POST"}),
  adminLogin: password => request("/api/admin/login", {method: "POST", body: JSON.stringify({password})}),
  adminSessions: token => request("/api/admin/sessions", {headers: {Authorization: `Bearer ${token}`}}),
  adminSessionDetail: (token, id) => request(`/api/admin/sessions/${encodeURIComponent(id)}/detail`, {headers: {Authorization: `Bearer ${token}`}}),
  adminDeleteSession: (token, id) => request(`/api/admin/sessions/${encodeURIComponent(id)}`, {method: "DELETE", headers: {Authorization: `Bearer ${token}`}}),
};

export async function downloadAdminExport(path, token, fallbackName) {
  const response = await fetch(path, {headers: {Authorization: `Bearer ${token}`}});
  if (!response.ok) throw new Error(response.status === 401 ? "Сессия администратора истекла" : "Не удалось подготовить выгрузку");
  const disposition = response.headers.get("Content-Disposition") || "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
