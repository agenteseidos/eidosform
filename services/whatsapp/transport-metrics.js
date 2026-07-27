'use strict';

const fs = require('fs');
const fsp = require('fs/promises');

const DEFAULT_TIMEZONE = 'America/Recife';
const MAX_DAYS = 120;

function dateKey(timestamp, timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDateKey(key, days) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function emptyDay() {
  return { total: 0, wacli: 0, wuzapi: 0, fallback: 0, legacy: 0 };
}

function initialState(now, primary) {
  return {
    version: 1,
    initializedAt: new Date(now).toISOString(),
    configuredPrimary: primary,
    active: {
      transport: primary,
      since: new Date(now).toISOString(),
      fallback: false,
      reason: null,
    },
    fallbackIncident: null,
    days: {},
  };
}

function createTransportMetricsStore({
  file,
  now = () => Date.now(),
  timeZone = DEFAULT_TIMEZONE,
  log = () => {},
} = {}) {
  let state = null;
  let saveQueue = Promise.resolve();

  function load(primary = 'wacli') {
    try {
      state = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') log('[metrics] arquivo ilegível; iniciando métricas vazias');
      state = initialState(now(), primary);
    }
    if (!state || state.version !== 1 || typeof state.days !== 'object') {
      state = initialState(now(), primary);
    }
    return state;
  }

  function prune() {
    const keys = Object.keys(state.days).sort();
    while (keys.length > MAX_DAYS) {
      delete state.days[keys.shift()];
    }
  }

  function save() {
    if (!file) return Promise.resolve();
    const snapshot = JSON.stringify(state);
    saveQueue = saveQueue.then(async () => {
      const tmp = `${file}.tmp`;
      await fsp.writeFile(tmp, snapshot, { mode: 0o600 });
      await fsp.rename(tmp, file);
    }).catch(() => log('[metrics] falha ao persistir métricas'));
    return saveQueue;
  }

  async function configure(primary) {
    if (!state) load(primary);
    if (state.configuredPrimary !== primary) {
      state.configuredPrimary = primary;
      state.active = {
        transport: primary,
        since: new Date(now()).toISOString(),
        fallback: false,
        reason: null,
      };
      state.fallbackIncident = null;
      await save();
    }
  }

  async function seedLegacy(entries) {
    if (!state) throw new Error('metrics_not_loaded');
    if (state.legacySeededAt) return;
    for (const value of Object.values(entries || {})) {
      if (!value || !Number.isFinite(value.ts)) continue;
      const key = dateKey(value.ts, timeZone);
      const day = state.days[key] || emptyDay();
      day.total += 1;
      day.legacy += 1;
      state.days[key] = day;
    }
    state.legacySeededAt = new Date(now()).toISOString();
    prune();
    await save();
  }

  async function recordSend({ transport, fallback = false }) {
    const key = dateKey(now(), timeZone);
    const day = state.days[key] || emptyDay();
    day.total += 1;
    if (transport === 'wacli' || transport === 'wuzapi') day[transport] += 1;
    if (fallback) day.fallback += 1;
    state.days[key] = day;
    state.active = {
      transport,
      since: state.active.transport === transport && state.active.fallback === fallback
        ? state.active.since
        : new Date(now()).toISOString(),
      fallback,
      reason: fallback ? state.fallbackIncident?.reason || 'primary_pre_flight_failure' : null,
    };
    if (!fallback) state.fallbackIncident = null;
    prune();
    await save();
  }

  async function beginFallback({ transport, reason }) {
    const isNew = !state.fallbackIncident;
    if (isNew) {
      state.fallbackIncident = {
        transport,
        since: new Date(now()).toISOString(),
        reason,
        alertAttemptAt: null,
        alertSentAt: null,
      };
      await save();
    }
    return { isNew, incident: { ...state.fallbackIncident } };
  }

  async function markFallbackAlert(sent) {
    if (!state.fallbackIncident) return;
    state.fallbackIncident.alertAttemptAt = new Date(now()).toISOString();
    if (sent) state.fallbackIncident.alertSentAt = state.fallbackIncident.alertAttemptAt;
    await save();
  }

  function shouldAttemptFallbackAlert(retryMs = 15 * 60 * 1000) {
    const incident = state.fallbackIncident;
    if (!incident || incident.alertSentAt) return false;
    if (!incident.alertAttemptAt) return true;
    return now() - Date.parse(incident.alertAttemptAt) >= retryMs;
  }

  function snapshot() {
    const todayKey = dateKey(now(), timeZone);
    const today = state.days[todayKey] || emptyDay();
    let previousTotal = 0;
    let coverageDays = 0;
    for (let offset = -1; offset >= -7; offset--) {
      const key = shiftDateKey(todayKey, offset);
      if (state.days[key]) coverageDays += 1;
      previousTotal += state.days[key]?.total || 0;
    }
    const average7Days = previousTotal / 7;
    const elevated = today.total >= 10 && (average7Days === 0 || today.total >= average7Days * 2);
    const totals = { wacli: 0, wuzapi: 0, fallback: 0, legacy: 0 };
    for (const day of Object.values(state.days)) {
      totals.wacli += day.wacli || 0;
      totals.wuzapi += day.wuzapi || 0;
      totals.fallback += day.fallback || 0;
      totals.legacy += day.legacy || 0;
    }
    return {
      active: { ...state.active },
      fallbackIncident: state.fallbackIncident ? { ...state.fallbackIncident } : null,
      volume: {
        today: today.total,
        average7Days: Math.round(average7Days * 10) / 10,
        coverageDays,
        elevated,
      },
      sendsByTransport: totals,
      initializedAt: state.initializedAt,
      legacySeededAt: state.legacySeededAt || null,
    };
  }

  return {
    load,
    configure,
    seedLegacy,
    recordSend,
    beginFallback,
    markFallbackAlert,
    shouldAttemptFallbackAlert,
    snapshot,
    _state: () => state,
  };
}

module.exports = {
  createTransportMetricsStore,
  dateKey,
  shiftDateKey,
};
