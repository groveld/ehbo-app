// Alarm in de app: herhalend geluid en trillen zolang er een oproep op reactie wacht.
// Browsers spelen pas geluid na een tik op de pagina; daarom zetten we het geluid aan bij de eerste tik (unlockAudio).
// Stil of Niet storen kan een webapp niet doorbreken (functioneel ontwerp, "Meldingen bij stil of Niet storen").

const REPEAT_MS = 2500;
const VIBRATE = [400, 150, 400, 150, 800];

let ctx: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    // Geen geluid mogelijk; trillen en de pushmelding blijven.
  }
}

/** Twee korte tonen, hoog-laag, zoals een sirene. */
function beep() {
  if (!ctx || ctx.state !== 'running') return;
  const start = ctx.currentTime;
  for (const [i, freq] of [880, 660, 880, 660].entries()) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    const t = start + i * 0.25;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.24);
  }
}

function ring() {
  beep();
  navigator.vibrate?.(VIBRATE);
}

export function startAlarm() {
  if (timer) return;
  ring();
  timer = setInterval(ring, REPEAT_MS);
}

export function stopAlarm() {
  if (timer) clearInterval(timer);
  timer = null;
  navigator.vibrate?.(0);
}
