import type { NoticeSession } from "../notice-transport.js";

export type MediaSession = NoticeSession;
export interface MediaFile {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}
export type MediaRequest = {
  readonly session: MediaSession;
  readonly fresh: true;
} & (
  | { readonly method: "GET"; readonly effect: boolean }
  | { readonly method: "POST"; readonly effect: true; readonly form: string }
  | {
      readonly method: "POST";
      readonly effect: true;
      readonly multipart: {
        readonly fields: Readonly<Record<string, string>>;
        readonly file: MediaFile & { readonly field: "Filedata" };
      };
    }
);
export interface MediaResponse {
  url: string;
  status: number;
  redirect: "none" | "opaque" | "followed";
  contentType: string;
  headers: Readonly<Record<string, string | undefined>>;
  bytes: Uint8Array;
}
export interface MediaClientOptions {
  origin: string;
  session(): MediaSession | null;
  transport: {
    request(url: string, request: MediaRequest): Promise<MediaResponse>;
  };
}
export type MediaFailure = {
  kind: "invalid" | "refused" | "session-changed" | "unknown";
  message: string;
  code?: string;
};
export type MediaBrowserHandoff = {
  kind: "browser-handoff";
  destination: string;
  reason: "unsupported-editor" | "unsupported-album" | "purchase";
  message: string;
};
export interface PostImageForm {
  readonly editorURL: string;
  readonly extensions: readonly string[];
  readonly maxBytes?: number;
}
export type PostImageOpen =
  | MediaFailure
  | MediaBrowserHandoff
  | { kind: "post-upload"; form: PostImageForm };
export type PostImageUpload =
  MediaFailure | { kind: "uploaded"; attachmentId: string; bbcode: string };

export interface AlbumOption {
  readonly value: string;
  readonly label: string;
}
export interface AlbumUploadForm {
  readonly sourceURL: string;
  readonly extensions: readonly string[];
  readonly maxBytes?: number;
  readonly albums: readonly AlbumOption[];
  readonly privacy: readonly AlbumOption[];
}
export interface AlbumPicture {
  readonly pictureId: string;
  readonly filename: string;
}
export type AlbumTarget =
  | { kind: "existing"; albumId: string }
  | {
      kind: "create";
      name: string;
      privacy: "0" | "1" | "3" | "4";
      password?: string;
    };
export type AlbumOpen =
  | MediaFailure
  | MediaBrowserHandoff
  | { kind: "album-upload"; form: AlbumUploadForm };
export type AlbumUpload =
  MediaFailure | { kind: "uploaded"; picture: AlbumPicture };
export type AlbumFiling =
  | (MediaFailure & { pictureIds?: readonly string[] })
  | {
      kind: "filing-handoff";
      effect: "unknown";
      destination: string;
      pictureIds: readonly string[];
    }
  | {
      kind: "filed";
      albumId: string;
      pictureIds: readonly string[];
      destination: string;
    };

export interface ExternalMediaHandoff {
  kind: "external-handoff";
  destination: string;
  method: "GET";
  credentials: "omit";
  referrerPolicy: "no-referrer";
  redirect: "manual";
}
export interface MediaDelivery {
  kind: "delivered";
  sourceURL: string;
  filename?: string;
  contentType: string;
  bytes: Uint8Array;
}
export interface AttachmentCreditOffer {
  readonly attachmentId: string;
  readonly threadId?: string;
}
export interface AttachmentResume {
  readonly attachmentId: string;
  readonly threadId?: string;
}
export type AttachmentRead =
  | MediaFailure
  | MediaDelivery
  | MediaBrowserHandoff
  | ExternalMediaHandoff
  | { kind: "credit-required"; offer: AttachmentCreditOffer };
export type AttachmentCredit =
  | MediaFailure
  | { kind: "credit-confirmed"; message: string; resume: AttachmentResume };

export interface SmileyGroup {
  id: string;
  name: string;
  directory: string;
}
export interface Smiley {
  id: string;
  groupId: string;
  code: string;
  url: string;
}
export type SmileyCatalogue =
  | MediaFailure
  | {
      kind: "smileys";
      source: "plugin" | "script";
      version?: string;
      groups: SmileyGroup[];
      items: Smiley[];
    };
export type SmileyScript =
  MediaFailure | { kind: "script"; sourceURL: string; script: string };
export type MediaRead = MediaFailure | MediaDelivery | ExternalMediaHandoff;
