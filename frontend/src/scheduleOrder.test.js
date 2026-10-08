import assert from "node:assert/strict";
import test from "node:test";
import { reorderScheduleItems } from "./scheduleOrder.js";

const items = ["a", "b", "c", "d"].map((id) => ({ id }));
const ids = (values) => values.map((item) => item.id);

test("moves a schedule item before an earlier item", () => {
  assert.deepEqual(ids(reorderScheduleItems(items, "d", "b")), ["a", "d", "b", "c"]);
});

test("moves a schedule item after a later item", () => {
  assert.deepEqual(ids(reorderScheduleItems(items, "a", "c", true)), ["b", "c", "a", "d"]);
});

test("returns the same list for missing targets and unchanged positions", () => {
  assert.equal(reorderScheduleItems(items, "a", "missing"), items);
  assert.equal(reorderScheduleItems(items, "b", "a", true), items);
});
