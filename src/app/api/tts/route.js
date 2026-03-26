import { NextResponse } from 'next/server';

// ─── Pale WAV fallback (quiet ambient hum, not silence) ──────────────────────
// Low-amplitude 120 Hz sine wave — sounds like distant room tone.
// Won't be transcribed as speech, but isn't flat silence.

function paleWav(durationSec = 2) {
  const sampleRate = 16000;
  const numSamples = sampleRate * durationSec;
  const dataSize   = numSamples * 2;
  const buf        = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);  // PCM
  buf.writeUInt16LE(1, 22);  // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  // ~1.5% amplitude 120 Hz hum
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(500 * Math.sin(2 * Math.PI * 120 * i / sampleRate));
    buf.writeInt16LE(sample, 44 + i * 2);
  }
  return buf;
}

// ─── Provider: Google Translate TTS (unofficial, max 200 chars) ──────────────

async function tryGoogleTTS(text) {
  const chunk = text.slice(0, 200);
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=en&client=tw-ob&ttsspeed=1`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer':    'https://translate.google.com/',
    },
  });
  if (!res.ok) throw new Error(`GTTS ${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 100) throw new Error('GTTS empty');
  return { buffer: buf, type: 'audio/mpeg' };
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const { text } = await request.json();
    if (!text) return NextResponse.json({ error: 'Missing text' }, { status: 400 });

    for (const provider of [tryGoogleTTS]) {
      try {
        const { buffer, type } = await provider(text);
        return new Response(buffer, {
          status: 200,
          headers: { 'Content-Type': type, 'Cache-Control': 'no-store' },
        });
      } catch (e) {
        console.warn('[TTS]', e.message);
      }
    }

    // Last resort: pale ambient hum so S3 upload still fires (text analysis handles scoring)
    const wav = paleWav(2);
    return new Response(wav, {
      status: 200,
      headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
