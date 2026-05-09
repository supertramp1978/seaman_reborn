import { loadState, saveState } from './game.js';

// ── 簡易 EventEmitter ────────────────────────────────────────────────────────
class StatusEventEmitter {
  #listeners = new Map();
  on(event, fn)   { (this.#listeners.get(event) ?? this.#listeners.set(event, new Set()).get(event)).add(fn); }
  off(event, fn)  { this.#listeners.get(event)?.delete(fn); }
  emit(event, data) { this.#listeners.get(event)?.forEach(fn => fn(data)); }
}
export const statusEvents = new StatusEventEmitter();

const WATER_DIRTY_RATE_PER_HOUR   = 3;
const STOMACH_DECREASE_PER_HOUR   = 1.5;
const STOMACH_HUNGER_EVENT        = 8;
const TRUST_CONVERSATION_GAIN     = 3;
const TRUST_MAX                   = 100;
const TRUST_CLEAN_WATER_PER_HOUR  = 0.5;
const TRUST_DIRTY_WATER_PER_HOUR  = -1;
const TRUST_BAD_TEMP_PER_HOUR     = -1;
const TRUST_ABSENCE_DECAY_PER_DAY = 3;
const WATER_TEMP_OPTIMAL          = 25.0;
const WATER_TEMP_DRIFT_PER_HOUR   = 0.5;
const WATER_TEMP_OUTDOOR_COEF     = 0.6;
const WATER_TEMP_OUTDOOR_OFFSET   = 10.0;

let _onWaterChangeEffect = () => {};
let _outdoorTemp  = 20;
let _lastTickHour = -1;

// 前回値キャッシュ（閾値エッジ検出用）
let _prevMood          = null;
let _prevTrustBucket   = null; // Math.floor(trust / 20) で 0-5 のバケット
let _prevStage         = null;
let _prevTempZone      = null; // 'high' | 'low' | 'normal'
let _prevQualityZone   = null; // 'bad' | 'normal' | 'good'

export function initStatus({ onWaterChangeEffect = () => {} } = {}) {
  _onWaterChangeEffect = onWaterChangeEffect;
  _outdoorTemp = 20;

  _fetchOutdoorTemp();

  const state = loadState();
  const s = state.seaman;
  const hoursElapsed = Math.max(0, (Date.now() - new Date(s.last_interaction)) / 3_600_000);

  let water_quality  = Math.max(0, s.water_quality - hoursElapsed * WATER_DIRTY_RATE_PER_HOUR);
  let stomach        = Math.max(0, s.stomach        - hoursElapsed * STOMACH_DECREASE_PER_HOUR);
  const daysAbsent   = Math.floor(hoursElapsed / 24);
  let trust          = Math.max(0, Math.min(TRUST_MAX, s.trust - daysAbsent * TRUST_ABSENCE_DECAY_PER_DAY));

  const target       = _waterTempTarget();
  const maxDrift     = hoursElapsed * WATER_TEMP_DRIFT_PER_HOUR;
  const diff         = target - s.water_temp;
  let water_temp     = s.water_temp + Math.sign(diff) * Math.min(Math.abs(diff), maxDrift);
  water_temp         = Math.max(0, Math.min(40, water_temp));

  let growth_points  = Math.max(0, s.growth_points);
  const stage        = _deriveStage(growth_points);
  const seaman_patch = { water_quality, stomach, trust, water_temp, growth_points, stage };
  const updated      = { ...s, ...seaman_patch };
  const mood         = _deriveMood(updated);

  saveState({ seaman: { ...seaman_patch, mood } });

  // 前回値キャッシュを現在のステートで初期化
  _prevMood        = mood;
  _prevTrustBucket = _trustBucket(trust);
  _prevStage       = stage;
  _prevTempZone    = _tempZone(water_temp);
  _prevQualityZone = _qualityZone(water_quality);

  _lastTickHour = new Date().getHours();
  setInterval(_tick, 60_000);
  setInterval(_fetchOutdoorTemp, 3_600_000);
}

export function onConversation() {
  const s = loadState().seaman;
  saveState({ seaman: { trust: Math.min(TRUST_MAX, s.trust + TRUST_CONVERSATION_GAIN) } });
}

const WATER_CHANGE_RATE_PER_TICK = 2; // 100ms ごとに +2%（約5秒で満タン）
let _waterChangeInterval = null;

export function startWaterChange(onTick = null) {
  if (_waterChangeInterval) return;
  _onWaterChangeEffect();
  _waterChangeInterval = setInterval(() => {
    const s = loadState().seaman;
    const newQuality = Math.min(100, s.water_quality + WATER_CHANGE_RATE_PER_TICK);
    saveState({
      seaman: {
        water_quality: newQuality,
        last_water_change: new Date().toISOString(),
        trust: Math.min(TRUST_MAX, s.trust + 0.01),
      },
    });
    onTick?.();
    if (newQuality >= 100) stopWaterChange();
  }, 100);
}

export function stopWaterChange() {
  if (_waterChangeInterval) {
    clearInterval(_waterChangeInterval);
    _waterChangeInterval = null;
  }
}

export function onFed() {
  const s = loadState().seaman;
  saveState({
    seaman: {
      stomach: Math.min(100, s.stomach + 10),
      last_fed: new Date().toISOString(),
    },
  });
}

export function getTimeOfDay() {
  const h = new Date().getHours();
  if (h >= 22 || h < 6) return 'night';
  if (h < 10)           return 'morning';
  if (h < 18)           return 'day';
  return 'evening';
}

export function getStatusSnapshot() {
  const s = loadState().seaman;
  return {
    mood:          s.mood,
    trust:         s.trust,
    stage:         s.stage,
    growth_points: s.growth_points,
    stomach:       s.stomach,
    water_quality: s.water_quality,
    water_temp:    s.water_temp,
    outdoor_temp:  _outdoorTemp,
    timeOfDay:     getTimeOfDay(),
  };
}

function _tick() {
  try {
    const state = loadState();
    const s = { ...state.seaman };

    const perMin = 1 / 60;
    s.water_quality = Math.max(0, s.water_quality - WATER_DIRTY_RATE_PER_HOUR * perMin);
    s.stomach       = Math.max(0, s.stomach - STOMACH_DECREASE_PER_HOUR * perMin);

    // trust: 水質・水温による変動
    if (s.water_quality >= 70) {
      s.trust = Math.min(TRUST_MAX, s.trust + TRUST_CLEAN_WATER_PER_HOUR * perMin);
    } else if (s.water_quality < 30) {
      s.trust = Math.max(0, s.trust + TRUST_DIRTY_WATER_PER_HOUR * perMin);
    }
    if (s.water_temp < 18 || s.water_temp > 32) {
      s.trust = Math.max(0, s.trust + TRUST_BAD_TEMP_PER_HOUR * perMin);
    }

    // 水温を外気温目標へ近づける
    const target = _waterTempTarget();
    const step   = WATER_TEMP_DRIFT_PER_HOUR * perMin;
    s.water_temp += Math.sign(target - s.water_temp) * Math.min(Math.abs(target - s.water_temp), step);
    s.water_temp  = Math.max(0, Math.min(40, s.water_temp));

    // 空腹イベント (7時台・19時台に1度だけ発火)
    const h = new Date().getHours();
    if ((h === 7 || h === 19) && h !== _lastTickHour) {
      s.stomach = Math.max(0, s.stomach - STOMACH_HUNGER_EVENT);
    }
    _lastTickHour = h;

    // 成長ポイント
    if (s.stomach >= 80) s.growth_points += 2 * perMin;
    if (s.stomach < 20)  s.growth_points  = Math.max(0, s.growth_points - 3 * perMin);
    if (s.water_quality >= 70) s.growth_points += 1 * perMin;
    if (s.water_quality < 30)  s.growth_points  = Math.max(0, s.growth_points - 2 * perMin);

    s.age_days     += perMin / 24;
    s.stage         = _deriveStage(s.growth_points);
    s.mood          = _deriveMood(s);

    saveState({ seaman: s });
    _detectAndEmitEvents(s);
  } catch (e) {
    console.warn('[status] tick error:', e.message);
  }
}

async function _fetchOutdoorTemp() {
  try {
    const { coords } = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
    );
    const { latitude: lat, longitude: lon } = coords;
    const res  = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`
    );
    const data = await res.json();
    _outdoorTemp = data.current_weather.temperature;
    console.debug('[status] 外気温:', _outdoorTemp, '°C');
  } catch (e) {
    console.warn('[status] 外気温取得失敗 (デフォルト 20°C 使用):', e.message);
    _outdoorTemp = 20;
  }
}

function _waterTempTarget() {
  return WATER_TEMP_OUTDOOR_COEF * _outdoorTemp + WATER_TEMP_OUTDOOR_OFFSET;
}

// ── 閾値ヘルパー ─────────────────────────────────────────────────────────────
function _tempZone(t)    { return t > 32 ? 'high' : t < 18 ? 'low' : 'normal'; }
function _qualityZone(q) { return q < 30 ? 'bad'  : q >= 70 ? 'good' : 'normal'; }
function _trustBucket(v) { return Math.min(5, Math.floor(v / 20)); } // 0-5

const MOOD_RANK = { happy: 4, neutral: 3, sleepy: 2, sad: 1, grumpy: 0 };

function _detectAndEmitEvents(s) {
  const tempZone    = _tempZone(s.water_temp);
  const qualZone    = _qualityZone(s.water_quality);
  const trustBucket = _trustBucket(s.trust);

  if (tempZone !== _prevTempZone) {
    if (tempZone === 'high') statusEvents.emit('water_temp_high');
    if (tempZone === 'low')  statusEvents.emit('water_temp_low');
    _prevTempZone = tempZone;
  }

  if (qualZone !== _prevQualityZone) {
    if (qualZone === 'bad')  statusEvents.emit('water_quality_bad');
    if (qualZone === 'good') statusEvents.emit('water_quality_good');
    _prevQualityZone = qualZone;
  }

  if (s.mood !== _prevMood) {
    const prev = MOOD_RANK[_prevMood] ?? 3;
    const next = MOOD_RANK[s.mood]   ?? 3;
    if (next > prev) statusEvents.emit('mood_up');
    if (next < prev) statusEvents.emit('mood_down');
    _prevMood = s.mood;
  }

  if (trustBucket !== _prevTrustBucket) {
    if (trustBucket > _prevTrustBucket) statusEvents.emit('trust_up');
    if (trustBucket < _prevTrustBucket) statusEvents.emit('trust_down');
    _prevTrustBucket = trustBucket;
  }

  if (s.stage !== _prevStage) {
    const key = `stage_${_prevStage}_to_${s.stage}`;
    statusEvents.emit(key);
    _prevStage = s.stage;
  }
}

function _deriveStage(gp) {
  if (gp >= 700) return 'new_spices';
  if (gp >= 300) return 'adult';
  if (gp >= 100) return 'juvenile';
  return 'larva';
}

function _deriveMood(s) {
  if (getTimeOfDay() === 'night')            return 'sleepy';
  if (s.trust < 20 || s.stomach < 20)       return 'grumpy';
  if (s.water_quality < 20)                 return 'sad';
  if (s.trust >= 70 && s.stomach >= 60)     return 'happy';
  return 'neutral';
}
