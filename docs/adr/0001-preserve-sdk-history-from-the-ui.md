# Preserve SDK history from the UI repository

Import the forum client, its library build and its consumer checks with path-filtered Git history from UI commit `94f68a5558d016d561b2bac417db2f52b5d27510`. Merge that history into the SDK with both parents intact so maintainers can use local blame. Keep a mapping from rewritten commits to their original UI commits so readers can recover the surrounding changes and discussion.

The verified November 14 consumer run anchors the import. Retain it with SDK test evidence and port relevant UI fixes through a named cutoff in subsequent commits. The issue records the selected paths, original archive digest, reproduction commands, bundled notices and transfer checks. [Maintainer decision and verification](https://github.com/Benson-mk/tsdm-sdk/issues/3#issuecomment-6971726334)
