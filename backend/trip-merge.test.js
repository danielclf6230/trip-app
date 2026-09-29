import assert from "node:assert/strict";
import test from "node:test";
import { mergeTripChanges } from "./trip-merge.js";

function fixture() {
  return {
    tripName: "Shared trip",
    days: [
      {
        id: "day-1",
        date: "2026-10-01",
        completed: false,
        items: [{ id: "stop-1", place: "Cafe", time: "09:00", note: "", checked: false }],
      },
      {
        id: "day-2",
        date: "2026-10-02",
        completed: false,
        items: [{ id: "stop-2", place: "Museum", time: "10:00", note: "", checked: false }],
      },
    ],
  };
}

test("keeps simultaneous edits made on different dates", () => {
  const base = fixture();
  const firstUser = structuredClone(base);
  const secondUserAlreadySaved = structuredClone(base);
  firstUser.days[0].items[0].place = "Breakfast cafe";
  secondUserAlreadySaved.days[1].items[0].note = "Buy tickets first";

  const merged = mergeTripChanges(base, firstUser, secondUserAlreadySaved);
  assert.equal(merged.days[0].items[0].place, "Breakfast cafe");
  assert.equal(merged.days[1].items[0].note, "Buy tickets first");
});

test("keeps simultaneous edits to different fields on the same stop", () => {
  const base = fixture();
  const firstUser = structuredClone(base);
  const secondUserAlreadySaved = structuredClone(base);
  firstUser.days[0].items[0].time = "09:30";
  secondUserAlreadySaved.days[0].items[0].note = "Window seat";

  const merged = mergeTripChanges(base, firstUser, secondUserAlreadySaved);
  assert.equal(merged.days[0].items[0].time, "09:30");
  assert.equal(merged.days[0].items[0].note, "Window seat");
});

test("keeps stops added simultaneously by two users", () => {
  const base = fixture();
  const firstUser = structuredClone(base);
  const secondUserAlreadySaved = structuredClone(base);
  firstUser.days[0].items.push({ id: "stop-a", place: "Lunch", time: "12:00", note: "", checked: false });
  secondUserAlreadySaved.days[0].items.push({ id: "stop-b", place: "Park", time: "14:00", note: "", checked: false });

  const merged = mergeTripChanges(base, firstUser, secondUserAlreadySaved);
  assert.deepEqual(
    merged.days[0].items.map((item) => item.id),
    ["stop-1", "stop-a", "stop-b"],
  );
});

test("uses the latest request when both users change the same field", () => {
  const base = fixture();
  const latestRequest = structuredClone(base);
  const stored = structuredClone(base);
  latestRequest.days[0].items[0].place = "Latest choice";
  stored.days[0].items[0].place = "Earlier choice";

  const merged = mergeTripChanges(base, latestRequest, stored);
  assert.equal(merged.days[0].items[0].place, "Latest choice");
});
