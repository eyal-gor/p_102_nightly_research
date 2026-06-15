// The research prompt. Produces the invest-watch "Company template": a header
// block with a 1–10 Score, then What they do / Why interesting / Risks /
// History. On review it carries the prior profile in and APPENDS a dated
// History entry — the score moving across reviews is the signal the digest ranks.

const VOICE =
  "Write in plain English — skeptical, concrete, like a smart friend explaining " +
  "the company. Short paragraphs, no jargon dumps. Be honest about uncertainty; " +
  "do not invent precise figures you're unsure of. Be stingy with high scores " +
  "(10 = exceptional business at a fair setup; 5 = fine but priced/uncertain; low = avoid).";

export function researchPrompt(ticker, prev, today) {
  const isReview = !!(prev && prev.trim());

  if (!isReview) {
    return (
      `You are building a research profile for the public company with ticker ${ticker}.\n${VOICE}\n\n` +
      `Simplicity test: if you cannot summarize this business in ~2 plain-English ` +
      `paragraphs from what you know, say so at the top and keep the rest short.\n\n` +
      `Return ONLY markdown, in EXACTLY this template:\n\n` +
      `# ${ticker} — <company name>\n\n` +
      `**Sector:** <one line>\n` +
      `**Market cap:** ~$<X> (<Month Year>, approximate)\n` +
      `**Added:** ${today}\n` +
      `**Last reviewed:** ${today}\n` +
      `**Score:** <X>/10 — <one line: why this score right now>\n\n` +
      `## What they do\n<2 plain-English paragraphs: what they sell and how they make money>\n\n` +
      `## Why interesting\n<1 paragraph>\n\n` +
      `## Risks\n<1 paragraph>\n\n` +
      `## History\n\n` +
      `### ${today} — first look\n` +
      `<2–4 sentences on what stands out right now and why you scored it where you did>`
    );
  }

  return (
    `You are REVIEWING an existing research profile for ${ticker}. Here is the current file:\n\n` +
    `<<<CURRENT\n${prev.trim()}\nCURRENT>>>\n\n${VOICE}\n\n` +
    `Update it for today (${today}). Keep the SAME template. KEEP the entire existing ` +
    `"## History" section intact and APPEND a new dated entry — never delete past entries. ` +
    `Carry "Added" forward unchanged; set "Last reviewed:" to ${today}; update the top ` +
    `"**Score:**" line only if your view actually changed.\n\n` +
    `Return ONLY the full updated markdown profile. The appended History entry must be:\n\n` +
    `### ${today} — review\n` +
    `**Score:** <X>/10 (was <previous score>/10)\n` +
    `<1–2 sentences on whether the story is improving or deteriorating, and what changed.>`
  );
}
