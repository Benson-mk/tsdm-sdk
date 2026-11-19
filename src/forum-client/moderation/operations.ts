export const operations = {
  stick: { group: 1, fields: ["sticklevel", "expirationstick"] },
  digest: { group: 1, fields: ["digestlevel", "expirationdigest"] },
  highlight: {
    group: 1,
    query: true,
    fields: [
      "highlight_color",
      "highlight_style[1]",
      "highlight_style[2]",
      "highlight_style[3]",
      "highlight_bgcolor",
      "expirationhighlight",
    ],
  },
  recommend: {
    group: 1,
    query: true,
    fields: [
      "isrecommend",
      "expirationrecommend",
      "position",
      "selectattach",
      "reducetitle",
    ],
  },
  close: { group: 4, fields: ["expirationclose"] },
  open: { group: 4, fields: ["expirationclose"] },
  move: { group: 2, fields: ["moveto", "threadtypeid", "type"] },
  type: { group: 2, query: true, fields: ["typeid"] },
  delete: { group: 3, query: true, fields: [] },
  bump: { group: 3, fields: ["expirationbump"] },
  down: { group: 3, fields: ["expirationdown"] },
  stamp: { fields: ["stamp"] },
  stamplist: { fields: ["stamplist"] },
  copy: { fields: ["copyto", "threadtypeid"] },
  merge: { fields: ["othertid"] },
  split: { fields: ["subject", "split"] },
  delpost: { post: true, fields: [] },
  warn: { post: true, fields: ["warned"] },
  banpost: { post: true, fields: ["banned"] },
  stickreply: { post: true, fields: ["stickreply"] },
  delcomment: { post: true, fields: [] },
  removerate: { post: true, fields: ["logidarray[]"] },
  removereward: { fields: [] },
  refund: { fields: [] },
  repair: { fields: [] },
  deleteattach: { post: true, fields: [] },
} satisfies Record<
  string,
  { group?: number; query?: boolean; post?: boolean; fields: readonly string[] }
>;

export type ModerationOperation = keyof typeof operations;
export const descriptor = (
  operation: ModerationOperation,
): {
  group?: number;
  query?: boolean;
  post?: boolean;
  fields: readonly string[];
} => operations[operation];
