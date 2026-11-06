function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function generatedText(result) {
  if (typeof result === 'string') return result.trim();
  const direct = result?.response ?? result?.output_text ?? result?.text;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const choiceText = result?.choices?.[0]?.message?.content;
  if (typeof choiceText === 'string' && choiceText.trim()) return choiceText.trim();
  if (Array.isArray(result?.output)) {
    return result.output
      .flatMap(item => Array.isArray(item.content) ? item.content : [])
      .filter(item => item.type === 'output_text' || item.type === 'text')
      .map(item => item.text || '')
      .join('\n')
      .trim();
  }
  return '';
}

async function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
  }
  return btoa(binary);
}

export async function onRequestPost({ request, env }) {
  if (!env.AI || typeof env.AI.run !== 'function') {
    return json({ error: 'Transcription is not configured yet. Add a Workers AI binding named AI to the zoom-clone Pages project and redeploy.' }, 503);
  }

  const contentType = request.headers.get('content-type') || 'audio/webm';
  if (!/^audio\//i.test(contentType) && !/webm|mp4|mpeg|wav|ogg/i.test(contentType)) {
    return json({ error: 'The uploaded recording audio format is not supported.' }, 415);
  }

  const audio = await request.arrayBuffer();
  if (!audio.byteLength) return json({ error: 'The recording did not contain audio.' }, 400);
  if (audio.byteLength > 24 * 1024 * 1024) {
    return json({ error: 'This recording audio is too large for one free transcription request. Try a shorter meeting.' }, 413);
  }

  try {
    const base64 = await toBase64(audio);
    const originalResult = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
      audio: base64,
      task: 'transcribe',
      vad_filter: true,
      beam_size: 5,
      condition_on_previous_text: false
    });
    const originalText = String(originalResult?.text || '').trim();
    if (!originalText) return json({ error: 'No clear speech was detected.' }, 422);

    let translatedText = originalText;
    {
      // Translate from the original audio itself, not from the imperfect ASR text.
      // This is especially important for code-switching (e.g. Arabic + English).
      const directTranslationResult = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
        audio: base64,
        task: 'translate',
        vad_filter: true,
        beam_size: 5,
        condition_on_previous_text: false
      });
      const directAudioTranslation = String(directTranslationResult?.text || '').trim();
      if (!directAudioTranslation) {
        return json({ error: 'The original transcript was created, but direct audio translation returned no text. Please try again.' }, 502);
      }

      const translationResult = await env.AI.run('@cf/openai/gpt-oss-120b', {
        messages: [
          {
            role: 'system',
            content: [
              'You are an expert human meeting interpreter and transcript editor.',
              'Produce a faithful, natural English translation of the meeting.',
              'The source may be Arabic, English, or a mixture of languages; detect the actual spoken language from the audio.',
              'The first reference is a translation generated directly from the original audio. Treat it as the primary evidence for what was spoken.',
              'The second reference is an automatic transcript in the source language. Use it only to clarify context and names, not to override clear English phrases from the audio translation.',
              'The speakers may switch between Arabic and English within the same sentence.',
              'Keep words and phrases that were spoken in English as English; do not translate, transliterate, or replace them with guesses.',
              'Preserve each language as spoken in the original transcript and translate the meaning faithfully into English.',
              'Do not summarize, add information, or invent words that are not supported by the references.',
              'Preserve names, numbers, technical terms, speaker order, and meaning.',
              'If a phrase is unclear, keep the uncertainty rather than guessing.',
              'Return only the final English transcript, with no explanation or labels.'
            ].join(' ')
          },
          {
            role: 'user',
            content: 'DIRECT TRANSLATION FROM AUDIO:\n' + directAudioTranslation + '\n\nSOURCE-LANGUAGE TRANSCRIPT FOR CONTEXT ONLY:\n' + originalText
          }
        ],
        temperature: 0.1,
        max_tokens: 12000
      });
      translatedText = generatedText(translationResult) || directAudioTranslation;
      if (/[\u0600-\u06FF\u4E00-\u9FFF\u3040-\u30FF]/.test(translatedText)) {
        translatedText = directAudioTranslation;
      }
      if (!translatedText) {
        return json({ error: 'The original transcript was created, but the English translation returned no text. Please try again.' }, 502);
      }
    }

    return json({ originalText, translatedText });
  } catch (error) {
    return json({ error: 'Transcription or translation service error: ' + (error?.message || 'unknown error') }, 502);
  }
}
