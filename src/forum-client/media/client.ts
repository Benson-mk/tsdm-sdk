import { createAlbums } from "./albums.js";
import { createAttachmentRetrieval } from "./retrieval.js";
import { createMediaResources } from "./resources.js";
import { mediaHost } from "./host.js";
import { createUploads } from "./uploads.js";
import type { MediaClientOptions } from "./types.js";

export function createMediaClient(options: MediaClientOptions) {
  const host = mediaHost(options);
  return {
    ...createUploads(host),
    ...createAlbums(host),
    ...createAttachmentRetrieval(host),
    ...createMediaResources(host),
  };
}
