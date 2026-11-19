import { integer } from "./forms.js";
import { attr, hasClass } from "../html.js";
import { bankText, messageNodes, type bankHost } from "./protocol.js";
import type {
  BankEffectResult,
  BankOperation,
  BankServicePage,
} from "./types.js";

const publicReplies = new Set([
  "恭喜您，操作成功。",
  "銀行密碼錯誤，請返回修改。",
  "银行密码错误，请返回修改。",
  "参数传递错误，请返回。",
  "參數傳遞錯誤，請返回。",
]);
export function bankReceipt(
  reply: Awaited<ReturnType<ReturnType<typeof bankHost>["exchange"]>>,
  member: string,
  operation: BankOperation,
  secrets: readonly string[],
): BankEffectResult {
  const uncertain = { kind: "uncertain", operation } as const;
  if (reply.kind !== "answer") return uncertain;
  const { response, page, viewer, uid } = reply;
  if ([401, 403, 429].includes(response.status))
    return {
      kind: "refused",
      code: response.status === 429 ? "rate-limited" : String(response.status),
    };
  const data = page.data;
  if (
    response.status !== 200 ||
    (viewer !== null && viewer !== member) ||
    (uid !== null && uid !== member)
  )
    return uncertain;
  const messages = messageNodes(page.doc).filter(
    (node) => attr(node, "id") === "messagetext",
  );
  const node = messages.length === 1 ? messages[0] : null;
  const structured =
    data?.type === "result" &&
    data.schema === 13 &&
    uid === member &&
    (data.kind === "message" || data.kind === "handle");
  const text = node
    ? bankText(node, (node) => node.tagName === "a")
    : structured && typeof data.message === "string"
      ? data.message
      : "";
  const message =
    publicReplies.has(text) && !secrets.some((secret) => text.includes(secret))
      ? { message: text }
      : {};
  if (
    (node && hasClass(node, "alert_error")) ||
    (structured &&
      (data.ok === 0 || data.alert === "error" || data.login === 1))
  ) {
    return { kind: "refused", code: "bank-rejected", ...message };
  }
  if ((node && text) || (structured && data.ok === 1 && text))
    return { kind: "unconfirmed", operation, ...message };
  return uncertain;
}
export function estimateBankTransferFee(page: BankServicePage, amount: string) {
  const rate = page?.transferFeeRate;
  if (
    page?.kind !== "transfer" ||
    typeof rate !== "string" ||
    !/^\d{1,8}(?:\.\d{1,8})?$/.test(rate) ||
    !integer(amount)
  )
    return null;
  const [whole, fractional = ""] = rate.split(".");
  const denominator = 1000n * 10n ** BigInt(fractional.length);
  const numerator = BigInt(`${whole}${fractional}`) * BigInt(amount);
  return String((numerator + denominator - 1n) / denominator);
}
