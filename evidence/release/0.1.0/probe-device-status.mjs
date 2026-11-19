import assert from "node:assert/strict";
import { createAccountClient } from "tsdm-sdk";

const input = {
  memberId: "42",
  deviceId: "01234567-89ab-4def-8123-456789abcdef",
};
const cases = [
  [
    200,
    { ok: 0, error: "device_revoked", uid: 42, device: input.deviceId },
    "device-revoked",
  ],
  [503, {}, "unavailable"],
];
const observations = [];
for (const [status, data, expected] of cases) {
  const requests = [];
  const client = createAccountClient({
    origin: "https://forum.test",
    session: () => "synthetic-session",
    transport: {
      async request(url, options) {
        requests.push({
          url,
          method: options.method,
          headers: options.headers,
        });
        return {
          url,
          status,
          contentType: "application/json",
          redirect: "none",
          body: JSON.stringify(data),
        };
      },
    },
  });
  const observed = await client.readStoredDeviceStatus(input);
  assert.equal(observed.kind, expected);
  assert.deepEqual(requests, [
    {
      url: "https://forum.test/plugin.php?id=tsdmapp%3Aapi&action=status",
      method: "GET",
      headers: { "X-Tsdmapp-Device": input.deviceId },
    },
  ]);
  observations.push({ status, expected, observed, requests });
}
console.log(JSON.stringify(observations, null, 2));
