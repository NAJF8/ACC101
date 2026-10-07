const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const requiredBusinessDate = value => {
  const businessDate = String(value || '').trim();
  if (!DATE_PATTERN.test(businessDate)) {
    const error = new Error('businessDate must be an explicit YYYY-MM-DD value.');
    error.code = 'INVALID_BUSINESS_DATE';
    throw error;
  }
  return businessDate;
};

const sourceTimestamp = (value, name) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Date.parse(value))) return value;
  const error = new Error(`${name} must be supplied by POS.`);
  error.code = 'INVALID_SOURCE_TIMESTAMP';
  throw error;
};

const normalizeSaleStatus = value => {
  const status = String(value || 'completed').trim().toLowerCase();
  if (['voided', 'cancelled', 'canceled'].includes(status)) return status === 'voided' ? 'voided' : 'cancelled';
  if (['completed', 'synced', 'paid', 'closed', ''].includes(status)) return 'completed';
  const error = new Error('Unsupported POS sale status.');
  error.code = 'INVALID_SALE_STATUS';
  throw error;
};

const integrationKeyForSale = saleId => `POS101:sale:${String(saleId || '').trim()}`;

const saleUpsertAction = ({ existing = null, fingerprint = '' } = {}) => {
  if (!existing) return 'create';
  return existing.fingerprint === fingerprint ? 'skip' : 'update';
};

module.exports = { requiredBusinessDate, sourceTimestamp, normalizeSaleStatus, integrationKeyForSale, saleUpsertAction };
