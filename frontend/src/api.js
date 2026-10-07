const productionBase = "https://tools-backend-v3um.onrender.com";
const developmentBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
const base = (import.meta.env.PROD ? productionBase : developmentBase).replace(/\/$/, "");

function getToken() {
  try { return JSON.parse(localStorage.getItem("user"))?.token ?? null; }
  catch { return null; }
}

async function request(path, { method = "GET", body } = {}) {
  const token = getToken();
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
  if (!response.ok) {
    const detail = typeof data.error === "string" ? data.error : JSON.stringify(data.error);
    const error = new Error(data.message || detail || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export function login(name, password) {
  return request("/api/auth/login", { method: "POST", body: { name, password } });
}

export function register(name, password, inviteCode = "") {
  return request("/api/auth/register", { method: "POST", body: { name, password, inviteCode: inviteCode || undefined } });
}

export function changePassword(currentPassword, newPassword, confirmPassword) {
  return request("/api/auth/password", {
    method: "PATCH",
    body: { currentPassword, newPassword, confirmPassword },
  });
}

export function updateAvatar(avatarUrl) {
  return request("/api/auth/avatar", { method: "PATCH", body: { avatarUrl } });
}

export async function loadTrip(tripId) {
  const data = await request(`/api/trip?tripId=${tripId}`);
  return { id: data.id, trip: data.trip, canInvite: Boolean(data.canInvite), membershipRole: data.role };
}

export async function saveTrip(tripId, trip, base) {
  try {
    return await request(`/api/trip?tripId=${tripId}`, {
      method: "PATCH",
      body: { base, trip },
    });
  } catch (error) {
    if (error.status !== 404 || !/Cannot PATCH/i.test(error.message)) throw error;
    const result = await request(`/api/trip?tripId=${tripId}`, {
      method: "PUT",
      body: trip,
    });
    return { ...result, trip };
  }
}

export function loadExchangeRate(from, to) {
  const query = new URLSearchParams({ from, to });
  return request(`/api/exchange-rate?${query}`);
}

export async function loadTrips() {
  const data = await request("/api/trips");
  return { trips: data.trips, canCreate: Boolean(data.canCreate), canManage: Boolean(data.canManage), activeTripId: data.activeTripId ?? null };
}

export function createTrip(trip) {
  return request("/api/trips", { method: "POST", body: trip });
}

export function deleteTrip(tripId) {
  return request(`/api/trips/${tripId}`, { method: "DELETE" });
}

export function selectActiveTrip(tripId) {
  return request("/api/trips/active", { method: "PATCH", body: { tripId } });
}

export async function loadMembers(tripId) {
  const data = await request(`/api/trip/members?tripId=${tripId}`);
  return data.members;
}

export async function createInvite(tripId) {
  return request("/api/trip/invites", { method: "POST", body: { tripId } });
}

export async function loadAdminUsers() {
  const data = await request("/api/admin/users");
  return data.users;
}

export async function loadAdminOverview() {
  const data = await request("/api/manage/overview");
  return { users: data.users, groups: data.groups, isAdmin: Boolean(data.isAdmin) };
}

export function createAdminUser(name, password) {
  return request("/api/admin/users", { method: "POST", body: { name, password } });
}

export function resetUserPassword(id, password) {
  return request(`/api/admin/users/${id}/password`, { method: "PATCH", body: { password } });
}

export function addUserToGroup(userId, groupId) {
  return request(`/api/manage/groups/${groupId}/users/${userId}`, { method: "POST" });
}

export function removeUserFromGroup(userId, groupId) {
  return request(`/api/manage/groups/${groupId}/users/${userId}`, { method: "DELETE" });
}

export function deleteAdminUser(id) {
  return request(`/api/admin/users/${id}`, { method: "DELETE" });
}

export function loadShoppingPhotos(tripId) {
  return request(`/api/trip/photos?tripId=${tripId}`);
}
export function uploadShoppingPhoto(tripId, file) {
  const body = new FormData();
  body.append("image", file);
  return request(`/api/trip/photos?tripId=${tripId}`, { method: "POST", body });
}

export function deleteShoppingItem(tripId, itemId, photoId) {
  return request(`/api/trip/photos/shopping/${encodeURIComponent(itemId)}?tripId=${tripId}`, { method: "DELETE", body: { photoId } });
}
