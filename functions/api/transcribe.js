function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.AI || typeof env.AI.run !== 'function') {
    return json({ error: 'Transcription is not configured yet. Add a Workers AI binding named AI to the zoom-clone Pages project and redeploy.' }, 503);
  }

  const url = new URL(request.url);
  const language = url.searchParams.get('language') || 'ar';
  const allowed = new Set(['ar', 'en', 'zh', 'ja']);
  if (!allowed.has(language)) return json({ error: 'Unsupported transcript language.' }, 400);

  const contentType = request.headers.get('content-type') || 'audio/webm';
  if (!/^audio\\//i.test(contentType) && !/webm|mp4|mpeg|wav|ogg/i.test(contentType)) {
    return json({ error: 'The uploaded recording audio format is not supported.' }, 415);
  }

  const audio = await request.arrayBuffer();
  if (!audio.byteLength) return json({ error: 'The recording did not contain audio.' }, 400);
  if (audio.byteLength > 24 * 1024 * 1024) {
    return json({ error: 'This recording audio is too large for one free transcription request. Try a shorter meeting.' }, 413);
  }

  try {
    const bytes = new Uint8Array(audio);
    let binary = '';
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
    }
    const base64 = btoa(binary);

    const originalResult = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
      audio: base64,
      task: 'transcribe',
      language,
      vad_filter: true,
      beam_size: 5,
      condition_on_previous_text: false
    });
    const originalText = String(originalResult?.text || '').trim();
    if (!originalText) return json({ error: 'No clear speech was detected.' }, 422);

    // Whisper's translate task can return text in the source language on some
    // runs. Translate the recognized source-language text with a dedicated
    // text-translation model so the English download is genuinely English.
    let translatedText = originalText;
    if (language !== 'en') {
      const languageNames = { ar: 'arabic', zh: 'chinese', ja: 'japanese' };
      const translationResult = await env.AI.run('@cf/meta/m2m100-1.2b', {
        text: originalText,
        source_lang: languageNames[language],
        target_lang: 'english'
      });
      translatedText = String(translationResult?.translated_text || '').trim();
      if (!translatedText) {
        return json({ error: 'The original transcript was created, but the English translation service returned no text. Please try again.' }, 502);
      }
      // Do not silently offer source-script text as an English translation.
      if (/[\\u0600-\\u06FF\\u4E00-\\u9FFF\\u3040-\\u30FF]/.test(translatedText)) {
        return json({ error: 'The translation service did not return English text. Please try again.' }, 502);
      }
    }

    return json({ originalText, translatedText });
  } catch (error) {
    return json({ error: 'Transcription or translation service error: ' + (error?.message || 'unknown error') }, 502);
  }
}
