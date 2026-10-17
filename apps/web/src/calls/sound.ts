// Звук входящего звонка: свой короткий двухтональный перелив на WebAudio, без чужих аудиофайлов.
// Повторяется, пока окно вызова открыто. Браузер разрешит звук, только если на странице уже что-то нажимали.
let audio: AudioContext | null = null;

function burst() {
  try {
    audio ??= new AudioContext();
    const now = audio.currentTime;
    [0, 0.32].forEach((offset) => {
      [523.25, 659.25].forEach((freq, i) => {
        const osc = audio!.createOscillator();
        const gain = audio!.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const start = now + offset + i * 0.12;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.07, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
        osc.connect(gain).connect(audio!.destination);
        osc.start(start);
        osc.stop(start + 0.3);
      });
    });
  } catch {
    // без звука — окно вызова всё равно видно
  }
}

export function startRingtone(): () => void {
  burst();
  const timer = setInterval(burst, 2400);
  return () => clearInterval(timer);
}
