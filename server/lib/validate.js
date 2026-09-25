'use strict';
// Tiny validation helpers. Each returns a cleaned value or throws a 400-able error.
class ValidationError extends Error { constructor(msg) { super(msg); this.status = 400; } }

const str = (v, { min = 0, max = 500, name = 'value', trim = true, required = true } = {}) => {
  if (v === undefined || v === null) { if (required) throw new ValidationError(`${name} is required`); return ''; }
  if (typeof v !== 'string') throw new ValidationError(`${name} must be a string`);
  const s = trim ? v.trim() : v;
  if (s.length < min) throw new ValidationError(`${name} must be at least ${min} characters`);
  if (s.length > max) throw new ValidationError(`${name} must be at most ${max} characters`);
  return s;
};
const int = (v, { min = -1e9, max = 1e9, name = 'value', required = true, fallback = 0 } = {}) => {
  if (v === undefined || v === null || v === '') { if (required) throw new ValidationError(`${name} is required`); return fallback; }
  const n = Number(v);
  if (!Number.isFinite(n) || Math.floor(n) !== n) throw new ValidationError(`${name} must be an integer`);
  if (n < min || n > max) throw new ValidationError(`${name} must be between ${min} and ${max}`);
  return n;
};
const bool = (v, { fallback = false } = {}) => {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true') return true;
  if (v === 0 || v === '0' || v === 'false') return false;
  throw new ValidationError('expected a boolean');
};
const oneOf = (v, list, name = 'value') => {
  if (!list.includes(v)) throw new ValidationError(`${name} must be one of: ${list.join(', ')}`);
  return v;
};
const strArray = (v, { max = 20, itemMax = 40, name = 'list' } = {}) => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ValidationError(`${name} must be an array`);
  if (v.length > max) throw new ValidationError(`${name} has too many items`);
  return v.map(x => str(x, { max: itemMax, name: `${name} item` }));
};
const smallObject = (v, { maxKeys = 20, maxLen = 2000 } = {}) => {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new ValidationError('expected an object');
  const s = JSON.stringify(v);
  if (Object.keys(v).length > maxKeys || s.length > maxLen) throw new ValidationError('object too large');
  return v;
};
const filename = (v, name = 'file') => {
  const s = str(v, { min: 1, max: 120, name });
  if (!/^[A-Za-z0-9._-]+$/.test(s) || s.includes('..')) throw new ValidationError(`${name} contains invalid characters`);
  return s;
};

module.exports = { ValidationError, str, int, bool, oneOf, strArray, smallObject, filename };
