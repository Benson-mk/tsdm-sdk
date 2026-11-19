import {
  first,
  integer,
  positive,
  record,
  target,
} from "./discovery/shared.js";
import {
  attr,
  byId,
  children,
  content,
  descendants,
  element,
  fragmentFrom,
  hasClass,
  label,
  safeURL,
  text,
  type Element,
  type Node,
} from "./html.js";
import type { MemberProfile, MemberProfileGroup } from "./member-profile-types.js";

const string = (value: unknown) => (typeof value === "string" ? value : "");
const optional = (value: unknown) => string(value).trim() || null;
const identifier = (value: unknown) =>
  integer(value) !== null ? String(value) : optional(value);
const count = (value: string) =>
  integer(/\d+/.test(value) ? Number(/\d+/.exec(value)?.[0]) : null);
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const flag = (value: unknown) =>
  value === 0 || value === 1 ? value === 1 : null;
const seconds = (value: unknown) => integer(value) || null;
const image = (node: Node | undefined, base: string) =>
  node ? safeURL(attr(node, "data-src") || attr(node, "src"), base) : null;
const img = (node: Node) => first(node, (item) => item.tagName === "img");
const classNode = (root: Node, name: string) =>
  first(root, (item) => hasClass(item, name));
const shown = (value: unknown) => label(fragmentFrom(string(value))) || null;

function secondaryTitle(root: Node, base: string) {
  const badges = classNode(root, "tsdmtitle-badges");
  const title = badges && classNode(badges, "tsdmtitle-title");
  return image(title && img(title), base);
}

function managedForum(id: string, name: string, base: string) {
  return {
    id,
    name,
    url: new URL(`/forum.php?mod=forumdisplay&fid=${id}`, base).href,
  };
}

function structuredGroup(
  value: unknown,
  base: string,
): MemberProfileGroup | null {
  const row = record(value);
  return row && optional(row.title)
    ? {
        id: positive(row.gid),
        title: string(row.title),
        iconURL: safeURL(string(row.icon), base),
      }
    : null;
}

function records(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.map(record);
  return rows.every((row) => row !== null) ? rows : null;
}

export function structuredProfile(
  data: Record<string, unknown>,
  base: string,
): MemberProfile | null {
  const user = record(data.user);
  const stats = record(data.stats);
  const credits = records(stats?.extcredits);
  const fields = records(data.profiles);
  const medals = records(data.medals);
  const managed = records(data.manage_forums);
  const groups = record(data.groups);
  const activity = record(data.activity);
  const owner = positive(user?.uid);
  if (
    !user ||
    !owner ||
    !stats ||
    !credits ||
    !fields ||
    !medals ||
    !managed ||
    !groups ||
    !activity
  )
    return null;
  const checkin = record(data.checkin);
  const level = record(checkin?.level);
  const unread = record(data.unread);
  return {
    avatarURL: safeURL(string(user.avatar), base),
    online: flag(user.online),
    emailVerified: flag(user.email_verified),
    videoVerified: null,
    customTitle: shown(user.customstatus),
    signature: content(fragmentFrom(string(user.signature_html)), base),
    secondaryTitleURL: secondaryTitle(
      fragmentFrom(string(data.profile_html)),
      base,
    ),
    fields: fields.map((row) => {
      const value = fragmentFrom(string(row.value));
      return {
        id: optional(row.id),
        title: string(row.title),
        text: label(value),
        content: content(value, base),
      };
    }),
    medals: medals.map((row) => ({
      id: identifier(row.id),
      name: string(row.name),
      imageURL: safeURL(string(row.image), base),
      description: string(row.description),
    })),
    managedForums: managed.flatMap((row) => {
      const id = positive(row.fid);
      const name = optional(row.name);
      return id && name ? [managedForum(id, name, base)] : [];
    }),
    groups: {
      admin: structuredGroup(groups.admin, base),
      member: structuredGroup(groups.member, base),
    },
    activity: {
      onlineHours: integer(activity.oltime),
      registeredAt: seconds(activity.regdate),
      lastVisitedAt: seconds(activity.lastvisit),
      lastActiveAt: seconds(activity.lastactivity),
      lastPostedAt: seconds(activity.lastpost),
      registeredIP: optional(activity.regip),
      lastVisitIP: optional(activity.lastip),
      timezone: optional(activity.timezone_text),
    },
    timeOffsetHours: number(data.timeoffset),
    checkin: checkin
      ? {
          days: integer(checkin.days),
          monthDays: integer(checkin.mdays),
          lastAt: seconds(checkin.last),
          reward: integer(checkin.reward),
          lastReward: integer(checkin.lastreward),
          today: flag(checkin.today),
          level: level
            ? {
                current: optional(
                  `[${string(level.code)}]${string(level.name)}`,
                ),
                next: optional(level.next)
                  ? `[${string(level.next)}]${string(level.next_name)}`
                  : null,
                remainingDays: integer(level.remain),
              }
            : null,
        }
      : null,
    stats: {
      friends: integer(stats.friends),
      friendsURL: new URL(
        `/home.php?mod=space&uid=${owner}&do=friend&view=me&from=space`,
        base,
      ).href,
      points: number(stats.credits),
      credits: credits.map((row) => ({
        id: identifier(row.id),
        title: string(row.title),
        text: [number(row.value), optional(row.unit)]
          .filter((part) => part !== null)
          .join(" "),
        value: number(row.value),
        unit: string(row.unit),
      })),
    },
    unread: {
      notices: integer(unread?.notice),
      privateMessages: flag(unread?.pm),
    },
  };
}

export function nativeProfileHeading(doc: Node): {
  root: Element;
  heading: Element;
  user: { uid: string | undefined; username: string };
} | null {
  const root = classNode(doc, "u_profile") ?? byId(doc, "pprl");
  const heading =
    root &&
    first(
      root,
      (node) =>
        node.tagName === "h2" &&
        hasClass(node, "mbn") &&
        /UID[:：]/i.test(label(classNode(node, "xw0"))),
    );
  return root && heading
    ? {
        root,
        heading,
        user: {
          uid: /UID[:：]\s*([1-9]\d*)(?!\d)/i.exec(
            label(classNode(heading, "xw0")),
          )?.[1],
          username: children(heading)
            .filter((node) => node.nodeName === "#text")
            .map(text)
            .join(""),
        },
      }
    : null;
}

function profileRows(root: Node | undefined) {
  const rows = new Map<string, Node>();
  if (!root) return rows;
  for (const row of descendants(root, (node) => node.tagName === "li")) {
    const key = children(row).find(
      (node) => element(node) && node.tagName === "em",
    );
    const title = label(key);
    if (title && !rows.has(title))
      rows.set(title, {
        ...row,
        childNodes: row.childNodes.filter((node) => node !== key),
      });
  }
  return rows;
}

function nativeGroup(
  row: Node | undefined,
  base: string,
): MemberProfileGroup | null {
  if (!row || !label(row)) return null;
  const anchor = first(row, (node) => node.tagName === "a");
  const route =
    anchor && target(attr(anchor, "href"), base, "/home.php", "spacecp");
  return {
    id:
      route?.searchParams.get("ac") === "usergroup"
        ? positive(route.searchParams.get("gid"))
        : null,
    title: label(anchor ?? row),
    iconURL: image(img(row), base),
  };
}

function nativeCheckin(root: Node): MemberProfile["checkin"] {
  const block = first(root, (node) =>
    ["pbm", "mbm", "bbda", "c"].every((name) => hasClass(node, name)),
  );
  const paragraphs = block
    ? descendants(block, (node) => node.tagName === "p")
    : [];
  if (!paragraphs.length) return null;
  if (/从未签到|從未簽到/.test(label(paragraphs[0])))
    return {
      days: 0,
      monthDays: null,
      lastAt: null,
      reward: null,
      lastReward: null,
      today: null,
      level: null,
    };
  const [days, month, last, rewards, levels, today] = paragraphs;
  if (!days || !month || !last || !rewards || !levels || !today) return null;
  const fonts = (node: Node) =>
    descendants(node, (item) => item.tagName === "font");
  const [reward, lastReward] = fonts(rewards);
  const [current, next, remainingDays] = fonts(levels);
  const todayText = label(today);
  return {
    days: count(label(days)),
    monthDays: count(label(month)),
    lastAt: label(fonts(last)[0]) || null,
    reward: count(label(reward)),
    lastReward: count(label(lastReward)),
    today: /今天[已未][签簽]到/.test(todayText)
      ? todayText.includes("已")
      : null,
    level: current
      ? {
          current: label(current),
          next: label(next) || null,
          remainingDays: count(label(remainingDays)),
        }
      : null,
  };
}

export function nativeProfile(
  doc: Node,
  root: Element,
  heading: Element,
  owner: string,
  base: string,
): MemberProfile | null {
  const basic = profileRows(classNode(root, "pbm"));
  const statistics = profileRows(byId(root, "psts"));
  const activityNode = byId(root, "pbbs");
  const activity = profileRows(activityNode);
  if (!basic.size && !statistics.size && !activity.size) return null;
  const groups = profileRows(activityNode?.parentNode ?? undefined);
  const friendRow = basic.get("统计信息");
  const friendsLink =
    friendRow &&
    first(
      friendRow,
      (node) => node.tagName === "a" && /好友数/.test(label(node)),
    );
  const friendsURL =
    friendsLink &&
    target(attr(friendsLink, "href"), base, "/home.php", "space");
  const signature = basic.get("个人签名");
  const excluded = new Set([
    "邮箱状态",
    "视频认证",
    "自定义头衔",
    "个人签名",
    "统计信息",
  ]);
  const avatarHeader = byId(doc, "uhd");
  const avatar =
    (avatarHeader && classNode(avatarHeader, "avt")) ??
    classNode(root, "tsdm_upf_avt");
  const sidebar = classNode(byId(doc, "ct") ?? doc, "sd");
  const avatarImage = avatar
    ? img(avatar)
    : sidebar && first(sidebar, (node) => hasClass(node, "hm"));
  const medals = descendants(
    root,
    (node) => node.tagName === "p" && hasClass(node, "md_ctrl"),
  ).flatMap((block) =>
    descendants(block, (node) => node.tagName === "img").map((node) => {
      const tip =
        (attr(node, "id") && byId(doc, `${attr(node, "id")}_menu`)) ||
        fragmentFrom(attr(node, "tip"));
      return {
        id: null,
        name:
          label(first(tip, (part) => part.tagName === "h4")) ||
          attr(node, "alt"),
        imageURL: image(node, base),
        description: label(first(tip, (part) => part.tagName === "p")),
      };
    }),
  );
  const management = first(
    root,
    (node) =>
      node.tagName === "h2" &&
      /^(管理以下版块|管理以下版塊)$/.test(label(node)),
  )?.parentNode;
  const status = (key: string) => {
    const value = label(basic.get(key));
    return /^(已|未)[验驗][证證]$/.test(value) ? value.startsWith("已") : null;
  };
  const detail = (key: string) => label(activity.get(key)) || null;
  const notice = first(
    doc,
    (node) => attr(node, "id") === "myprompt" && hasClass(node, "new"),
  );
  const unreadPM = first(
    doc,
    (node) => attr(node, "id") === "pm_ntc" && hasClass(node, "new"),
  );
  const promptMenu = byId(doc, "myprompt_menu");
  return {
    avatarURL: image(
      avatar ? avatarImage : avatarImage && img(avatarImage),
      base,
    ),
    online: !!first(
      heading,
      (node) =>
        hasClass(node, "olicon") ||
        (node.tagName === "img" && attr(node, "alt") === "online"),
    ),
    emailVerified: status("邮箱状态"),
    videoVerified: status("视频认证"),
    customTitle: label(basic.get("自定义头衔")) || null,
    signature: signature ? content(signature, base) : [],
    secondaryTitleURL: secondaryTitle(byId(doc, "ct") ?? root, base),
    fields: [...basic]
      .filter(([title]) => !excluded.has(title))
      .map(([title, row]) => ({
        id: null,
        title,
        text: label(row),
        content: content(row, base),
      })),
    medals,
    managedForums: management
      ? descendants(management, (node) => node.tagName === "a").flatMap(
          (node) => {
            const route = target(
              attr(node, "href"),
              base,
              "/forum.php",
              "forumdisplay",
            );
            const id =
              positive(route?.searchParams.get("fid")) ??
              /^forum-([1-9]\d*)-\d+\.html$/.exec(attr(node, "href"))?.[1];
            return id && label(node)
              ? [managedForum(id, label(node), base)]
              : [];
          },
        )
      : [],
    groups: {
      admin: nativeGroup(groups.get("管理组"), base),
      member: nativeGroup(groups.get("用户组"), base),
    },
    activity: {
      onlineHours: count(label(activity.get("在线时间"))),
      registeredAt: detail("注册时间"),
      lastVisitedAt: detail("最后访问"),
      lastActiveAt: detail("上次活动时间"),
      lastPostedAt: detail("上次发表时间"),
      registeredIP: detail("注册 IP"),
      lastVisitIP: detail("上次访问 IP"),
      timezone: detail("所在时区"),
    },
    timeOffsetHours: null,
    checkin: nativeCheckin(root),
    stats: {
      friends: count(label(friendsLink)),
      friendsURL:
        friendsURL &&
        friendsURL.searchParams.get("uid") === owner &&
        friendsURL.searchParams.get("do") === "friend"
          ? friendsURL.href
          : null,
      points: numberLabel(label(statistics.get("积分"))).value,
      credits: [...statistics]
        .filter(([title]) => title !== "积分" && title !== "已用空间")
        .map(([title, row]) => {
          const text = label(row);
          return { id: null, title, text, ...numberLabel(text) };
        }),
    },
    unread: {
      notices: notice ? count(label(notice)) : byId(doc, "myprompt") ? 0 : null,
      privateMessages:
        unreadPM || (promptMenu && classNode(promptMenu, "prompt_news"))
          ? true
          : byId(doc, "pm_ntc")
            ? false
            : null,
    },
  };
}

function numberLabel(text: string) {
  const match = /^(-?\d+(?:\.\d+)?)(?:\s*(.*))$/.exec(text);
  return {
    value: match ? number(Number(match[1])) : null,
    unit: match?.[2] ?? "",
  };
}
