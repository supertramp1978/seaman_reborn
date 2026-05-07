const MOOD_LABEL  = { happy: '上機嫌', neutral: '普通', grumpy: '不機嫌', sad: '悲しい', sleepy: '眠い' };
const STAGE_LABEL = { larva: '幼生', juvenile: '幼魚', adult: 'シーマン', new_spices: 'シーマン リボーン' };
const TIME_LABEL  = { night: '夜', morning: '朝', day: '昼', evening: '夕方' };

let _elMood, _elTrustBar, _elStage, _elStomachBar, _elWaterBar, _elTemp, _elTime;

export function initStatusPanel({ onWaterChange, onFed }) {
  _elMood       = document.querySelector('#sp-mood');
  _elTrustBar   = document.querySelector('#sp-trust-bar');
  _elStage      = document.querySelector('#sp-stage');
  _elStomachBar = document.querySelector('#sp-stomach-bar');
  _elWaterBar   = document.querySelector('#sp-water-bar');
  _elTemp       = document.querySelector('#sp-temp');
  _elTime       = document.querySelector('#sp-time');

  if (!_elMood) {
    console.warn('[status-panel] DOM 要素が見つかりません');
    return;
  }

  const waterBtn = document.querySelector('#water-change-btn');
  const feedBtn  = document.querySelector('#feed-btn');
  if (waterBtn) waterBtn.addEventListener('click', onWaterChange);
  if (feedBtn)  feedBtn.addEventListener('click', onFed);
}

export function renderStatus(snapshot) {
  if (!_elMood) return;

  // 気分
  _elMood.textContent      = MOOD_LABEL[snapshot.mood] ?? snapshot.mood;
  _elMood.dataset.mood     = snapshot.mood;

  // 信頼度バー
  _elTrustBar.style.width  = `${Math.round(snapshot.trust)}%`;

  // 成長段階
  _elStage.textContent     = STAGE_LABEL[snapshot.stage] ?? snapshot.stage;

  // お腹バー
  _elStomachBar.style.width = `${Math.round(snapshot.stomach)}%`;

  // 水質バー（30以下で赤系）
  _elWaterBar.style.width      = `${Math.round(snapshot.water_quality)}%`;
  _elWaterBar.style.background = snapshot.water_quality < 30 ? '#c06060' : '';

  // 水温
  _elTemp.textContent      = `${snapshot.water_temp.toFixed(1)}°C`;
  _elTemp.dataset.hot      = snapshot.water_temp > 32;
  _elTemp.dataset.cold     = snapshot.water_temp < 18;

  // 時刻帯
  _elTime.textContent      = TIME_LABEL[snapshot.timeOfDay] ?? snapshot.timeOfDay;
  _elTime.dataset.period   = snapshot.timeOfDay;
}
