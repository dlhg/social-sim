/**
 * Shared random selection utilities.
 */

/** Softmax-weighted random pick from scored items.
 *  Returns the item with the selected score. */
export function weightedPick<T>(items: T[], getScore: (item: T) => number): T {
  const scores = items.map(getScore);
  const maxScore = Math.max(...scores);
  const weights = scores.map(s => Math.exp(s - maxScore));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * totalWeight;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
