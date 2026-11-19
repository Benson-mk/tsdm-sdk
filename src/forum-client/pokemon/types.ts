import type { HostResponse } from "../types.js";

export interface PokemonAccount {
  readonly memberId: string;
  readonly continuity: string;
}
export type PokemonRequest = {
  readonly fresh: true;
  readonly session: PokemonAccount;
  readonly headers: Readonly<Record<string, string>>;
} & (
  | { readonly method: "GET"; readonly effect: false; readonly body?: never }
  | { readonly method: "POST"; readonly effect: true; readonly body: string }
);
export interface PokemonTransport {
  request(
    url: string,
    request: PokemonRequest,
  ): Promise<HostResponse & { redirect: "none" | "opaque" | "followed" }>;
}
export interface PokemonClientOptions {
  origin: string;
  session(): PokemonAccount | null;
  transport: PokemonTransport;
}
export interface PokemonSession {
  readonly uid: number;
  readonly source: "status" | "game-page";
}
export interface PokemonFailure {
  readonly kind:
    | "session-required"
    | "session-changed"
    | "unsupported"
    | "invalid-input"
    | "invalid-response"
    | "network"
    | "refused"
    | "rate-limited"
    | "uncertain";
  readonly operation: string;
  readonly message?: string;
  readonly code?: number;
}
export type PokemonBootstrapResult =
  { kind: "ready"; session: PokemonSession } | PokemonFailure;
export type PokemonResult<T> = { kind: "success"; data: T } | PokemonFailure;

export type PokemonValue =
  string | number | boolean | null | PokemonData | readonly PokemonValue[];
export interface PokemonData {
  readonly [field: string]: PokemonValue | undefined;
}
export interface PokemonConfig extends PokemonData {
  readonly is_open: boolean | number | string;
}
export interface PokemonPet extends PokemonData {
  readonly id: number;
  readonly name?: string;
  readonly stats?: PokemonData | null;
}
export interface PokemonPetDetail extends PokemonPet {
  readonly stats: PokemonData | null;
}
export interface PokemonEvolution extends PokemonData {
  readonly pokemonId: number;
  readonly forward: readonly PokemonData[];
  readonly backward: readonly PokemonData[];
}
export interface PokemonSkills extends PokemonData {
  readonly pokemonId: number;
  readonly available_skills: readonly PokemonData[];
  readonly unlocked_skills: readonly PokemonData[];
}
export interface PokemonEquipment extends PokemonData {
  readonly pokemonId: number;
  readonly equipment_slots: readonly PokemonData[];
  readonly owned_items: readonly PokemonData[];
  readonly shop_items: readonly PokemonData[];
}
export interface PokemonProfile extends PokemonData {
  readonly uid: number;
}
export interface PokemonInventory extends PokemonData {
  readonly page: number;
  readonly items: readonly PokemonData[];
}
export interface PokemonBadge extends PokemonData {
  readonly hidden?: boolean;
}
export interface PokemonHeal extends PokemonData {
  readonly current_hp: number;
  readonly max_hp: number;
  readonly cost: number;
}
