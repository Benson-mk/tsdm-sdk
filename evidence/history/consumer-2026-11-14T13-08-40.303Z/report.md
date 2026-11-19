# Clean public consumer

Passed installation of the exact retained @tsdm/forum-client@0.26.0 tarball, public ESM imports, rejected private subpaths, and strict declarations with no DOM types using an isolated TypeScript 6.0.3 compiler. Existing populated read/search/notices/download/preparation, 2 reply, 1 owned edit, 2 draft, 10 favorite, 2 direct/funded packet and 34 publication cases passed, including account changes, duplicate pending sends, lost responses, later revisions and raw source. No runtime or peer dependencies; no browser globals supplied.

This is synthetic transport evidence for these artifact bytes. This run qualifies the current fully evolved API artifact. Later frozen-release artifacts and installed/live qualification still require their own checks.

## Replay independently

Copy this entire run directory outside the UI checkout. Use Node v24.22.0 and npm 11.21.1, then run:

```sh
npm exec -- node replay-consumer.mjs .
```

The replay validates retained input hashes, installs from the exact local tarball and locked compiler into a new temporary directory, typechecks and reruns the public consumer. npm needs the locked TypeScript package available in its cache or configured registry. The original run installed from the existing cache with scripts disabled. The command writes a distinct sibling replay directory containing its receipt, report and manifest, including when verification fails.

See receipt.json for runtime, package, case and installed-file identities; inputs.json for qualification source identities; manifest.json covers every retained file. This run checks inputs stayed stable during qualification, not that a separate earlier build used those exact source bytes.
