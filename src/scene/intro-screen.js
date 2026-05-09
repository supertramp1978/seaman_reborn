import { se } from '../audio/se.js';

export async function showIntroScreen() {
  const screenEl = document.getElementById('intro-screen');
  screenEl.hidden = false;
  await tick();
  screenEl.classList.add('visible');

  // 注意書き画面の SE をロードして再生
  await se.loadBuffer('caution', 'assets/audio/se_caution.mp3');
  se.startAmbient('caution', { volume: 0.4, fadeInMs: 800, loop: true });

  return new Promise(resolve => {
    document.getElementById('intro-proceed').addEventListener('click', async () => {
      // ジャングル SE と注意書き SE をフェードアウト、泡 SE をフェードイン
      se.stopAmbient('jungle', { fadeOutMs: 2000 });
      await se.loadBuffer('bubble', 'assets/audio/se_bubble_02.mp3');

      screenEl.classList.add('fade-out');
      setTimeout(async () => {
        screenEl.hidden = true;
        // 3D 水槽キャンバス画面移行後に注意書き SE をフェードアウト、泡 SE を開始
        se.stopAmbient('caution', { fadeOutMs: 1000 });
        se.startAmbient('bubble', { volume: 0.25, fadeInMs: 1500 });
        resolve();
      }, 600);
    }, { once: true });
  });
}

function tick() {
  return new Promise(r => setTimeout(r, 50));
}
