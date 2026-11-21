# 0003. Explainable matching before the LLM

## Context
Each item on the supplier invoice has to be linked to a sales-order item, and the descriptions rarely match.
Getting the match wrong puts the goods on the wrong order. The operator needs to understand the suggestion in order to confirm quickly.

## Decision
The suggestion comes from a deterministic score (`_shared/casamento.ts`): a shared model, token similarity, the listing URL in the marker, memory of confirmed matches, hard exclusions (cost above the sale price, an invoice earlier than the order). Each point becomes a readable reason on the screen. Only when confidence is not high, and only if an LLM is configured, does it break the tie among the best candidates. The LLM comes in through a port (`ProvedorLLM`) with a generic HTTP adapter and a fake for tests; the invoice text goes to the prompt as JSON (data, not an instruction) and the response passes through a strict extractor (balanced JSON, `id` inside the candidate list, valid confidence). An invalid response falls back to the rule.
Every suggestion starts as `sugerido` and the operator confirms; the origin (`regra`, `ia`, `manual`) is stored.

## Consequences
- The system works without an LLM, and the LLM never decides on its own or outside the candidate list.
- The score is testable with small cases, and the weights are visible constants.
- The cost is maintaining the weights by hand; the memory of confirmations makes up for part of that.
