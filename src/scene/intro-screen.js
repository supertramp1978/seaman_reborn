import { se } from '../audio/se.js';

export async function showIntroScreen() {
  const screenEl = document.getElementById('intro-screen');
  screenEl.hidden = false;
  await tick();
  screenEl.classList.add('visible');

  return new Promise(resolve => {
    document.getElementById('intro-proceed').addEventListener('click', async () => {
      // ジャングル SE をフェードアウトし、泡 SE をフェードイン
      se.stopAmbient('jungle', { fadeOutMs: 2000 });
      await se.loadBuffer('bubble', 'assets/audio/se_bubble.mp3');

      screenEl.classList.add('fade-out');
      setTimeout(async () => {
        screenEl.hidden = true;
        // ゲーム画面移行後に泡 SE を開始
        se.startAmbient('bubble', { volume: 0.25, fadeInMs: 1500 });
        resolve();
      }, 600);
    }, { once: true });
  });
}

function tick() {
  return new Promise(r => setTimeout(r, 50));
}
