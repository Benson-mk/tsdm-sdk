import { checkAcknowledgement, checkPolling, results } from "./consume.mjs";
import { checkIgnore, checkNative } from "./deliberate.mjs";

await checkPolling();
await checkAcknowledgement();
await checkNative();
await checkIgnore();
console.log(JSON.stringify(results));
