export const normalizeAuthEmail = (email) => String(email || '').trim().toLowerCase();

export const authEmailKey = (email) => normalizeAuthEmail(email).replace(/[.#$\[\]/]/g, '_');

export const findAuthorizedRecord = (data, email) => {
  const normalized = normalizeAuthEmail(email);
  if (!normalized || !data || typeof data !== 'object') return null;
  const direct = data[authEmailKey(normalized)];
  if (direct && normalizeAuthEmail(direct.email) === normalized) return direct;
  return Object.values(data).find((record) => normalizeAuthEmail(record?.email) === normalized) || null;
};
