# SDK #27 qualification

The combined candidate includes #25 at `cdaca1d53ccc173d4930f63d9597658920a972bb`. `tsdm-sdk-0.1.0.tgz` has SHA-256 `33861d31f1deece3568a719f32eb27cbabbb65271a6cb44b53fa264dcb350e46`.

- [Installed SDK receipt](0.1.0-installed.json) records 39 expected and actual observations using nine hash-verified upstream files. The installed TypeScript example also exercises a declined credit approval.
- [Direct HTTP receipt](0.1.0-direct.json) records 19 expected and actual HTTP checks, including credential separation and delivered bytes on the storage origin.
- [Combined regression receipt](0.1.0-regressions.json) records 18 passing regression suites against the combined archive and rebuilt historical bundle. The #25 special-thread installed and direct checks record 33 and 24 observation groups respectively.

The media consumer installs the packed `tsdm-sdk` in an external clean Node 26 project, checks the resolved lockfile against the tarball, verifies the packaged README and media guide links, and compiles and runs the TypeScript example without DOM types. The HTTP guide check extracts the Python and curl examples from that tarball and traces requests against two disposable HTTPS loopback origins. The storage server observes complete media bytes and the absence of cookies, authorization, referrer, device and app session headers.

[Fixture pins](pins.json) identify nine inputs under `test/data` from `Carinoasd/tsdm_client` v1.59.0 at `02df67e39ded906def5b868e8f8311ba735b316c`. Original fixtures stay in that tree. The consumer replays the schema 16 post editor, original native album uploader, restricted attachment notices, exact credit continuation, binary JPEG, smiley catalogue and script, and the signed avatar handoff. For the structured smiley catalogue, it uses the fixture's guest viewer and aligns its origin with the controlled host. The upstream album filing regression supplies the response shape for synthetic success, refusal and unknown inputs. IDs and signed routes sent by the independent HTTP loopback test are fictional. SDK host traces and the direct HTTP test establish request behavior for these inputs. Production availability, deployment permissions, storage behavior and account effects remain unobserved.

## Replay

Use Node.js 26.x, npm with a writable cache and available locked dependencies, Python 3 with `requests`, curl, OpenSSL, and the pinned source tree. The HTTP script binds two disposable listeners on `127.0.0.1`, creates an ephemeral test certificate, and verifies the TLS connections using that certificate.

```sh
# Set UPSTREAM to the pinned tsdm_client checkout.
npm ci --offline
npm run pack:sdk
archive=dist/tsdm-sdk-0.1.0.tgz
shasum -a 256 "$archive"
TSDM_MEDIA_UPSTREAM="$UPSTREAM" node scripts/check-installed-media.mjs "$archive"
python3 evidence/media/check-direct-guide.py "$archive"
# Run the combined special-thread, activity, package and historical regressions.
sh evidence/special-threads/check-candidate.sh "$UPSTREAM" "$archive" "$OUTPUT"
```

The first installed probe failed at the `createMediaClient` export. Successive probes reached the missing album preparation, attachment download, and smiley operations before those paths were implemented. A later installed probe exposed a native album acknowledgement left unknown. The installed check retains every passing expected and actual observation for those paths.

## Trade-offs

- A dedicated media client keeps bytes and multipart requests separate from the existing text transport. Hosts implement multipart, manual redirects and effect-aware request handling. This version buffers files as `Uint8Array` and hands off external storage for host-managed transfers.
- The SDK qualifies post image upload from the schema 16 editor and reuses the standalone profile client's signed avatar handoff. Native editors without a supported post upload form need the browser. A post upload acknowledgement supplies an aid and BBCode. Association and publication stay separate from upload.
- Album upload acknowledges each picture independently. Opaque picture receipts allow explicit filing of a successful subset while preserving IDs on refusal, redirect or lost filing responses. The SDK consumes those receipts on dispatch. Recovery of a lost filing and named-friend privacy use the native interface.
- Attachment routes accept the forum's signed links and validate recognizable token members and targets. Known HTTP and `www` aliases are normalized to the configured HTTPS origin. A manual same-origin redirect chain is bounded and must keep the attachment identity. This stops unsupported intermediaries and can leave some deployments at a handoff or an incomplete result.
- Credit confirmation is an explicit one-shot effect. The charged continuation can be reused within the session and cannot start another charge. An ambiguous acknowledgement leaves the effect unknown. The user opens the verified purchase page separately.
- Typed external handoffs carry the destination and credentialless request contract. The SDK never calls its forum transport for another origin. Hosts decide whether to follow the handoff and verify any resulting bytes.
- The script parser reads literal groups and items without executing JavaScript. The SDK recognizes supported media routes and MIME types and checks delivered bytes against applicable headers. Hosts own display and file saving. Unexpected script layouts or storage representations can require native handling.
- Controlled fixtures and loopback traffic make rare cases and credential isolation repeatable. They limit the evidence to these inputs and leave production behavior for release qualification.
