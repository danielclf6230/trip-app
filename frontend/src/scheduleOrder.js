export function reorderScheduleItems(items, sourceId, targetId, after = false) {
  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return items;

  const reordered = [...items];
  const [moved] = reordered.splice(sourceIndex, 1);
  let destinationIndex = targetIndex + (after ? 1 : 0);
  if (sourceIndex < destinationIndex) destinationIndex -= 1;
  if (destinationIndex === sourceIndex) return items;

  reordered.splice(destinationIndex, 0, moved);
  return reordered;
}
