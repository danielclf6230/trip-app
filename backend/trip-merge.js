const missing = Symbol("missing");

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasStableIds(values) {
  return values.every(
    (value) => isObject(value) && typeof value.id === "string" && value.id,
  );
}

function mergeArray(base, proposed, current) {
  const combined = [...base, ...proposed, ...current];
  if (!hasStableIds(combined)) return proposed;

  const baseById = new Map(base.map((value) => [value.id, value]));
  const proposedById = new Map(proposed.map((value) => [value.id, value]));
  const currentById = new Map(current.map((value) => [value.id, value]));
  const orderedIds = [
    ...proposed.map((value) => value.id),
    ...current
      .map((value) => value.id)
      .filter((id) => !proposedById.has(id) && !baseById.has(id)),
  ];

  return orderedIds.flatMap((id) => {
    const merged = mergeValue(
      baseById.has(id) ? baseById.get(id) : missing,
      proposedById.has(id) ? proposedById.get(id) : missing,
      currentById.has(id) ? currentById.get(id) : missing,
    );
    return merged === missing ? [] : [merged];
  });
}

function mergeValue(base, proposed, current) {
  if (same(proposed, base)) return current;
  if (same(current, base)) return proposed;
  if (proposed === missing || current === missing) return proposed;

  if (Array.isArray(base) && Array.isArray(proposed) && Array.isArray(current)) {
    return mergeArray(base, proposed, current);
  }

  if (isObject(base) && isObject(proposed) && isObject(current)) {
    const result = {};
    const keys = new Set([
      ...Object.keys(base),
      ...Object.keys(proposed),
      ...Object.keys(current),
    ]);
    for (const key of keys) {
      const merged = mergeValue(
        Object.hasOwn(base, key) ? base[key] : missing,
        Object.hasOwn(proposed, key) ? proposed[key] : missing,
        Object.hasOwn(current, key) ? current[key] : missing,
      );
      if (merged !== missing) result[key] = merged;
    }
    return result;
  }

  // Both users changed the exact same primitive field. The latest request wins.
  return proposed;
}

export function mergeTripChanges(base, proposed, current) {
  return mergeValue(base, proposed, current);
}
