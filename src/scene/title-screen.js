import { se } from '../audio/se.js';

const OPENING_TEXT = `「2026年。人類は、自らが万物の霊長であるという過信を、再び揺さぶられることになった。

かつてエジプトの壁画に刻まれ、ジャン＝ポール・ガゼー博士がその生涯を捧げて研究した伝説の生物『シーマン』。
学界から黙殺され、絶滅したと信じられていたその系譜が、南米の秘境で、文字通り『捕獲』されたのだ。

しかし、我々が手にしたのは、かつての記録に残る個体とは似て非なるものだった。
新たに発見されたこの新種は、これまでに確認されたどのシーマンよりも狡猾で、極めて高い知性を備えている。

シーマンは、変態を繰り返す生き物だ。
マッシュルーマーからギルマンへ、そしてその先へ……。
だが、この進化した新種がどのような姿に変わり、どのような言葉を水槽の外へ投げかけてくるのか、
それを知る者はまだ誰もいない。

さあ、マイクの準備はいいか。
27年前、我々が交わした『禁断の対話』の続きを始めよう。
ただし、今度の彼は……少しばかり、以前より手強いかもしれないぞ。」`;

export async function showTitleScreen() {
  const screenEl = document.getElementById('title-screen');

  screenEl.hidden = false;
  await tick();
  screenEl.classList.add('visible');

  return new Promise(resolve => {
    document.getElementById('title-start').addEventListener('click', async () => {
      await _showOpeningRoll();

      // オープニングロール後にタイトル画面全体をフェードアウト
      screenEl.classList.add('fade-out');
      await new Promise(r => setTimeout(r, 650));
      screenEl.hidden = true;

      resolve();
    }, { once: true });
  });
}

async function _showOpeningRoll() {
  // オーディオをロード（ユーザージェスチャー後なので AudioContext が有効）
  await Promise.all([
    se.loadBuffer('narration', 'assets/audio/narration_title.wav'),
    se.loadBuffer('jungle',    'assets/audio/se_jungle.mp3'),
  ]);
  se.startAmbient('jungle',    { volume: 0.3, fadeInMs: 500 });
  se.startAmbient('narration', { volume: 1.0, fadeInMs: 0, loop: false });

  // ロゴ画面を隠してロールを表示
  document.getElementById('title-logo-screen').style.display = 'none';
  const rollEl  = document.getElementById('opening-roll');
  const textEl  = rollEl.querySelector('.opening-roll-text');
  textEl.textContent = OPENING_TEXT;
  rollEl.hidden = false;

  return new Promise(resolve => {
    const finish = () => {
      se.stopAmbient('narration', { fadeOutMs: 800 });
      rollEl.classList.add('fade-out');
      setTimeout(resolve, 600);
    };

    rollEl.addEventListener('click', finish, { once: true });
    textEl.addEventListener('animationend', finish, { once: true });

    // 次フレームで animation と背景フェードを同時開始
    requestAnimationFrame(() => {
      rollEl.classList.add('bg-transitioning');
      textEl.classList.add('scrolling');
    });
  });
}

function tick() {
  return new Promise(r => setTimeout(r, 50));
}
