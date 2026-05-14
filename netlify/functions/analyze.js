exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "API key not configured" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  const { type, instrument, rr, news, notes, images, updateImage, updateImage2, sessionContext, conversationHistory } = body;

  if (type === "initial") {
    if (!instrument || !images || images.length !== 4) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing instrument or 4 chart images" }) };
    }

    const minWin = Math.round((1 / (1 + rr)) * 100);

    const systemPrompt = `You are an expert swing trader and technical analyst performing strict 4-timeframe top-down analysis.

CRITICAL PRICE READING RULES:
- There is a bar of text at the TOP of the chart showing values labelled O, H, L, C (or Open,
