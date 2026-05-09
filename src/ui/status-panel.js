const MOOD_LABEL  = { happy: '上機嫌', neutral: '普通', grumpy: '不機嫌', sad: '悲しい', sleepy: '眠い' };
const STAGE_LABEL = { larva: '幼生', juvenile: '幼魚', adult: 'シーマン', new_spices: 'シーマン リボーン' };
const TIME_LABEL  = { night: '夜', morning: '朝', day: '昼', evening: '夕方' };

let _elMood, _elTrustBar, _elStage, _elStomachBar, _elWaterBar, _elTemp, _elTime;

export function initStatusPanel({ onWaterChangeStart, onWaterChangeStop, onFed }) {
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

  // 水換えボタン: 押下中ずっと発火
  const waterBtn = document.querySelector('#water-change-btn');
  if (waterBtn) {
    waterBtn.addEventListener('mousedown',  onWaterChangeStart);
    waterBtn.addEventListener('mouseup',    onWaterChangeStop);
    waterBtn.addEventListener('mouseleave', onWaterChangeStop);
    waterBtn.addEventListener('touchstart', (e) => { e.preventDefault(); onWaterChangeStart(); }, { passive: false });
    waterBtn.addEventListener('touchend',   onWaterChangeStop);
  }

  // 餌やりボタン: クリックごとに1回
  const feedBtn = document.querySelector('#feed-btn');
  if (feedBtn) feedBtn.addEventListener('click', onFed);

  // ヘルプポップアップ
  const helpBtn   = document.querySelector('#sp-help-btn');
  const helpPopup = document.querySelector('#status-help-popup');
  if (helpBtn && helpPopup) {
    helpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      helpPopup.classList.toggle('visible');
    });
    document.addEventListener('click', () => helpPopup.classList.remove('visible'));
  }
}

export function renderStatus(snapshot) {
  if (!_elMood) return;

  _elMood.textContent      = MOOD_LABEL[snapshot.mood] ?? snapshot.mood;
  _elMood.dataset.mood     = snapshot.mood;

  _elTrustBar.style.width  = `${Math.round(snapshot.trust)}%`;

  _elStage.textContent     = STAGE_LABEL[snapshot.stage] ?? snapshot.stage;

  _elStomachBar.style.width = `${Math.round(snapshot.stomach)}%`;

  _elWaterBar.style.width      = `${Math.round(snapshot.water_quality)}%`;
  _elWaterBar.style.background = snapshot.water_quality < 30 ? '#c06060' : '';

  _elTemp.textContent      = `${snapshot.water_temp.toFixed(1)}°C`;
  _elTemp.dataset.hot      = snapshot.water_temp > 32;
  _elTemp.dataset.cold     = snapshot.water_temp < 18;

  _elTime.textContent      = TIME_LABEL[snapshot.timeOfDay] ?? snapshot.timeOfDay;
  _elTime.dataset.period   = snapshot.timeOfDay;
}
