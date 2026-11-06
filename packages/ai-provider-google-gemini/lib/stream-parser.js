'use strict';

module.exports = function createParser() {
  let finishReason;
  return {format: 'sse', parse(raw) {
    const event = JSON.parse(raw), update = {};
    if (event.usageMetadata) {
      const usage = event.usageMetadata;
      update.usage = usage;
      update.resultUsage = {prompt_tokens: usage.promptTokenCount ?? null,
        completion_tokens: usage.candidatesTokenCount ?? null, total_tokens: usage.totalTokenCount ?? null};
    }
    if (event.error || event.promptFeedback?.blockReason) return {...update, error: 'Gemini stream failed'};
    const candidate = event.candidates?.find(item => item.index === 0 || item.index === undefined);
    update.text = (candidate?.content?.parts || []).filter(part => !part.thought && typeof part.text === 'string')
      .map(part => part.text).join('');
    if (candidate?.finishReason && candidate.finishReason !== 'FINISH_REASON_UNSPECIFIED') {
      finishReason = candidate.finishReason;
      // Usage-only frames may follow: mark completion but continue reading until EOF.
      update.done = true;
    }
    return update;
  }, end() {
    if (finishReason && finishReason !== 'STOP') return {error: 'Gemini stream incomplete'};
  }};
};
