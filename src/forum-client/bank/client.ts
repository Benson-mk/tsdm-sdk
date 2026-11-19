import {
  recordActions,
  sameWithdrawal,
  type OfferedWithdrawal,
} from "./records.js";
import { bankReceipt, estimateBankTransferFee } from "./effects.js";
import { formBody, readForms, sameForm, type OfferedForm } from "./forms.js";
import type { NoticeSession } from "../notice-transport.js";
import { query } from "../posts/forms.js";
import { bankHost, bankId, bankURL } from "./protocol.js";
import {
  directoryFrom,
  logsFrom,
  serviceFrom,
  services,
  serviceURL,
  validPage,
} from "./reads.js";
import type {
  BankClientOptions,
  BankDirectoryResult,
  BankLogQuery,
  BankLogsResult,
  BankService,
  BankServiceResult,
  BankServicePage,
  BankForm,
  BankValues,
  BankEffectResult,
  BankClient,
  BankConfirmationResult,
  BankWithdrawal,
} from "./types.js";

export function createBankClient(options: BankClientOptions): BankClient {
  const host = bankHost(options);
  const forms = new WeakMap<
    BankForm,
    {
      owner: NoticeSession;
      page: BankServicePage;
      offer: OfferedForm;
      withdrawal?: OfferedWithdrawal;
    }
  >();
  const withdrawals = new WeakMap<
    BankWithdrawal,
    { owner: NoticeSession; page: BankServicePage; offer: OfferedWithdrawal }
  >();
  const pending = new Set<string>();
  async function readBankDirectory(): Promise<BankDirectoryResult> {
    const owner = host.session();
    if (!owner) return { kind: "refused", code: "login" };
    const url = bankURL(host.origin);
    const read = await host.read(url, owner);
    if (read.kind !== "page") return read;
    const banks = directoryFrom(read.doc, url);
    return banks
      ? { kind: "bank-directory", banks }
      : { kind: "invalid-response" };
  }
  async function loadService(
    url: string,
    kind: BankService,
    bank: string | null,
    page: number,
    owner: NoticeSession,
  ) {
    const read = await host.read(url, owner);
    if (read.kind !== "page") return read;
    const parsed = serviceFrom(read.doc, url, kind, bank, page);
    if (!parsed) return { kind: "invalid-response" } as const;
    const { offers, unsupported } = bank
      ? readForms(parsed.table, parsed.service)
      : { offers: [], unsupported: false };
    const records = recordActions(parsed.table, parsed.service);
    const service: BankServicePage = Object.freeze({
      ...parsed.service,
      forms: Object.freeze(offers.map((offer) => offer.form)),
      withdrawals: Object.freeze(
        records.withdrawals.map((offer) => offer.record),
      ),
      handoffs: Object.freeze([
        ...parsed.service.handoffs,
        ...records.handoffs,
      ]),
      unsupportedForms: unsupported || records.unsupported,
    });
    return {
      kind: "service" as const,
      service,
      offers,
      withdrawals: records.withdrawals,
    };
  }
  async function readBankService(
    kind: BankService,
    bank?: string,
    page = 1,
  ): Promise<BankServiceResult> {
    if (
      typeof kind !== "string" ||
      !Object.hasOwn(services, kind) ||
      !validPage(page) ||
      (services[kind].global ? bank !== undefined : !bankId(bank))
    )
      return { kind: "invalid-input" };
    const owner = host.session();
    if (!owner) return { kind: "refused", code: "login" };
    const url = serviceURL(host.origin, kind, bank ?? null, page);
    const read = await loadService(url, kind, bank ?? null, page, owner);
    if (read.kind !== "service") return read;
    for (const offer of read.offers)
      forms.set(offer.form, { owner, page: read.service, offer });
    for (const offer of read.withdrawals)
      withdrawals.set(offer.record, { owner, page: read.service, offer });
    return { kind: "bank-service", service: read.service };
  }
  async function readBankLogs(
    bank: string,
    options: BankLogQuery = {},
  ): Promise<BankLogsResult> {
    if (
      !bankId(bank) ||
      !options ||
      (options.received !== undefined && typeof options.received !== "boolean")
    )
      return { kind: "invalid-input" };
    const { received = false, page = 1 } = options;
    if (!validPage(page)) return { kind: "invalid-input" };
    const owner = host.session();
    if (!owner) return { kind: "refused", code: "login" };
    const url = bankURL(host.origin, {
      bankid: bank,
      action: "log",
      show: received ? "1" : "0",
      page: String(page),
    });
    const read = await host.read(url, owner);
    if (read.kind !== "page") return read;
    const parsed = logsFrom(read.doc, url, page);
    return parsed
      ? { kind: "bank-logs", bankId: bank, received, page, ...parsed }
      : { kind: "invalid-response" };
  }
  async function loadConfirmation(
    withdrawal: OfferedWithdrawal,
    owner: NoticeSession,
  ) {
    const { bankId, recordId } = withdrawal.record;
    const read = await loadService(withdrawal.url, "fixed", bankId, 1, owner);
    if (read.kind !== "service") return read;
    const candidate = read.offers.length === 1 ? read.offers[0] : null;
    if (
      !candidate ||
      candidate.form.operation !== "withdraw-fixed" ||
      candidate.fixed.get("noid") !== recordId ||
      !candidate.form.context ||
      read.service.unsupportedForms
    )
      return { kind: "invalid-response" } as const;
    return {
      kind: "confirmation" as const,
      form: candidate,
      currency: read.service.currency,
    };
  }
  async function prepareBankWithdrawal(
    record: BankWithdrawal,
  ): Promise<BankConfirmationResult> {
    const selected = withdrawals.get(record);
    if (!selected) return { kind: "invalid-input" };
    const loaded = await loadConfirmation(selected.offer, selected.owner);
    if (loaded.kind !== "confirmation") return loaded;
    if (loaded.currency !== selected.page.currency)
      return { kind: "invalid-response" };
    forms.set(loaded.form.form, {
      owner: selected.owner,
      page: selected.page,
      offer: loaded.form,
      withdrawal: selected.offer,
    });
    return {
      kind: "bank-confirmation",
      form: loaded.form.form,
      withdrawal: record,
    };
  }
  function sameTerms(old: BankServicePage, fresh: BankServicePage) {
    const terms = (page: BankServicePage) => [
      page.currency,
      page.walletBalance,
      page.summary,
      page.interest,
      page.notices,
      page.blocks,
      page.transferFeeRate,
    ];
    return JSON.stringify(terms(old)) === JSON.stringify(terms(fresh));
  }
  async function submitBankForm(
    form: BankForm,
    values: BankValues,
    approved: boolean,
  ): Promise<BankEffectResult> {
    const authority = forms.get(form);
    if (!authority) return { kind: "invalid-input" };
    if (approved !== true) return { kind: "not-confirmed" };
    const { owner, page, offer, withdrawal } = authority;
    if (!host.current(owner)) return { kind: "session-changed" };
    const snapshot = values && Object.freeze({ ...values });
    if (!formBody(offer, snapshot)) return { kind: "invalid-input" };
    const key = JSON.stringify([owner.memberId, owner.continuity, form.bankId]);
    if (pending.has(key)) return { kind: "refused", code: "bank-in-flight" };
    forms.delete(form);
    pending.add(key);
    try {
      const read = await loadService(
        page.url,
        page.kind,
        page.bankId,
        page.page,
        owner,
      );
      if (read.kind !== "service") return read;
      if (!sameTerms(page, read.service)) return { kind: "terms-changed" };
      let fresh: OfferedForm;
      if (withdrawal) {
        const matches = read.withdrawals.filter((candidate) =>
          sameWithdrawal(withdrawal, candidate),
        );
        if (matches.length !== 1) return { kind: "terms-changed" };
        const confirmation = await loadConfirmation(matches[0]!, owner);
        if (confirmation.kind !== "confirmation")
          return confirmation.kind === "invalid-response"
            ? { kind: "terms-changed" }
            : confirmation;
        if (
          confirmation.currency !== page.currency ||
          !sameForm(offer, confirmation.form)
        )
          return { kind: "terms-changed" };
        fresh = confirmation.form;
      } else {
        const matches = read.offers.filter((candidate) =>
          sameForm(offer, candidate),
        );
        if (matches.length !== 1) return { kind: "terms-changed" };
        fresh = matches[0]!;
      }
      const body = formBody(fresh, snapshot);
      if (!body) return { kind: "terms-changed" };
      const reply = await host.exchange(
        query(fresh.url, { tsdmapp: "json" }),
        owner,
        body.toString(),
      );
      const secrets = fresh.form.fields.flatMap((field) =>
        field.type === "password" ? [body.get(field.name)!] : [],
      );
      return bankReceipt(reply, owner.memberId, form.operation, secrets);
    } finally {
      pending.delete(key);
    }
  }
  return {
    readBankDirectory,
    readBankService,
    readBankLogs,
    prepareBankWithdrawal,
    estimateBankTransferFee,
    submitBankForm,
  };
}
