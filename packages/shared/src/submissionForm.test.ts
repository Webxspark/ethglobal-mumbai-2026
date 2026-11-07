import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXAMPLE_SUBMISSION_FORM,
  parseSubmissionForm,
  validateFormResponse,
} from "./submissionForm.js";

describe("submissionForm", () => {
  it("parses the example form", () => {
    const form = parseSubmissionForm(EXAMPLE_SUBMISSION_FORM);
    assert.equal(form.fields.length, EXAMPLE_SUBMISSION_FORM.fields.length);
  });

  it("rejects more than 20 fields", () => {
    const fields = Array.from({ length: 21 }, (_, i) => ({
      id: `f${i}`,
      label: `Field ${i}`,
      type: "short_text" as const,
    }));
    assert.throws(() => parseSubmissionForm({ fields }));
  });

  it("rejects select without options", () => {
    assert.throws(() =>
      parseSubmissionForm({
        fields: [{ id: "cond", label: "Cond", type: "select" }],
      }),
    );
  });

  it("validates a complete response", () => {
    const hit = validateFormResponse(EXAMPLE_SUBMISSION_FORM, {
      store_name: "Reliance Fresh",
      shelf_photo: { attachmentId: "att-1", filename: "shelf.jpg" },
      sku_count: 12,
      condition: "clean",
      notes: "ok",
      check_in: { lat: 19.07, lng: 72.87 },
    });
    assert.equal(hit.ok, true);
    if (hit.ok) {
      assert.equal(hit.card.length, 6);
      assert.equal(hit.response.sku_count, 12);
    }
  });

  it("rejects missing required fields", () => {
    const hit = validateFormResponse(EXAMPLE_SUBMISSION_FORM, {
      store_name: "X",
    });
    assert.equal(hit.ok, false);
    if (!hit.ok) assert.match(hit.error, /required|missing/i);
  });

  it("rejects invalid select option", () => {
    const hit = validateFormResponse(EXAMPLE_SUBMISSION_FORM, {
      store_name: "X",
      shelf_photo: "att-1",
      sku_count: 1,
      condition: "nope",
      check_in: { lat: 1, lng: 2 },
    });
    assert.equal(hit.ok, false);
  });
});
