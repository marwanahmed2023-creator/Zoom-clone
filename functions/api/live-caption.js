export async function onRequestPost() {
  return new Response(JSON.stringify({
    error: 'Live captions are disabled in Convo.'
  }), {
    status: 410,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}
