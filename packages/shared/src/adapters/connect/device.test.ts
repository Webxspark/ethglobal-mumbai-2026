import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Address, PotId, UnixSecs } from "../../types.js";
import { TERMS_VERSION } from "../../connect/terms.js";
import { createDeviceAuthStore } from "./device.js";

const pot = "0xp0t000000000000000000000000000000000001" as PotId;
const owner = "0x0000000000000000000000000000000000000a11" as Address;

describe("device auth", () => {
  it("connect → accept_terms → approve → token", () => {
    let t = 1_700_000_000 as UnixSecs;
    const store = createDeviceAuthStore({ clock: () => t });
    const started = store.start({
      publicAppUrl: "http://127.0.0.1:38471",
      label: "cursor",
    });
    assert.equal(started.termsVersion, TERMS_VERSION);
    assert.match(started.authorizeUrl, /\/connect\/authorize\?code=/);
    assert.equal(started.device.status, "pending_terms");

    assert.throws(() =>
      store.approve({
        deviceCode: started.device.deviceCode,
        nullifierHash: "0xn1",
        potId: pot,
        owner,
      }),
    );

    const accepted = store.acceptTerms({
      deviceCode: started.device.deviceCode,
      agreed: true,
      termsVersion: TERMS_VERSION,
    });
    assert.equal(accepted.status, "pending_user");

    const { token, device } = store.approve({
      deviceCode: started.device.deviceCode,
      nullifierHash: "0xn1",
      potId: pot,
      owner,
    });
    assert.equal(device.status, "authorized");
    assert.match(token.token, /^pwct_/);
    assert.equal(token.nullifierHash, "0xn1");
    assert.equal(token.termsVersion, TERMS_VERSION);

    const polled = store.poll(started.device.deviceCode);
    assert.equal(polled?.token, token.token);
  });

  it("wrong terms_version is rejected", () => {
    const store = createDeviceAuthStore();
    const started = store.start({ publicAppUrl: "http://127.0.0.1:38471" });
    assert.throws(
      () =>
        store.acceptTerms({
          deviceCode: started.device.deviceCode,
          agreed: true,
          termsVersion: "nope",
        }),
      /terms_version/,
    );
  });
});
