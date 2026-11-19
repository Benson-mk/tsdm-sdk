import { integer } from "../notice-transport.js";
import { dataObject, failure } from "./session.js";
import type {
  PokemonBadge,
  PokemonConfig,
  PokemonData,
  PokemonEquipment,
  PokemonEvolution,
  PokemonHeal,
  PokemonInventory,
  PokemonPet,
  PokemonPetDetail,
  PokemonProfile,
  PokemonResult,
  PokemonSkills,
} from "./types.js";
import type { createPokemonWire, PokemonGroup, PokemonQuery } from "./wire.js";

const positive = (value: unknown): value is number => integer(value, 1);
const slot = (value: unknown) => integer(value, 0) && value < 4;
function objects(value: unknown): value is readonly PokemonData[] {
  return Array.isArray(value) && value.every((row) => dataObject(row) !== null);
}
function pet(value: PokemonData): value is PokemonPet {
  return (
    positive(value.id) &&
    (value.name === undefined || typeof value.name === "string") &&
    (value.stats == null || dataObject(value.stats) !== null)
  );
}
const badge = (data: PokemonData): PokemonBadge | null =>
  data.hidden === undefined || typeof data.hidden === "boolean"
    ? (data as PokemonBadge)
    : null;
const healed = (data: PokemonData): PokemonHeal | null =>
  integer(data.current_hp, 0) &&
  integer(data.max_hp, 0) &&
  data.current_hp <= data.max_hp &&
  integer(data.cost, 0)
    ? (data as PokemonHeal)
    : null;
const invalid = <T>(
  endpoint: PokemonGroup,
  action: string,
): Promise<PokemonResult<T>> =>
  Promise.resolve(failure(`${endpoint}/${action}`, "invalid-input"));
const done = () => undefined;

export function pokemonRoster(wire: ReturnType<typeof createPokemonWire>) {
  function withId<T>(
    id: number,
    action: string,
    decode: (data: PokemonData) => T | null,
  ) {
    return positive(id)
      ? wire.read("pokemon", action, { pokemon_id: id }, decode)
      : invalid<T>("pokemon", action);
  }
  function change(
    action: string,
    valid: boolean,
    query: PokemonQuery,
    payload: PokemonData,
  ) {
    return valid
      ? wire.write("pokemon", action, query, payload, done)
      : invalid<void>("pokemon", action);
  }
  function healAction(action: "heal" | "heal_and_flee", id: number) {
    return positive(id)
      ? wire.write("user", action, { pokemon_id: id }, {}, healed)
      : invalid<PokemonHeal>("user", action);
  }
  function selected<T>(id: number, action: string, names: readonly string[]) {
    return withId<T>(id, action, (data) =>
      data.pokemon_id === id && names.every((name) => objects(data[name]))
        ? ({ ...data, pokemonId: id } as T)
        : null,
    );
  }
  return {
    getGlobalConfig: () =>
      wire.read<PokemonConfig>("config", "global_config", {}, (data) =>
        typeof data.is_open === "boolean" ||
        typeof data.is_open === "string" ||
        typeof data.is_open === "number"
          ? (data as PokemonConfig)
          : null,
      ),
    getEvolutionPath: (id: number) =>
      positive(id)
        ? wire.read<PokemonEvolution>(
            "evolution",
            "evolution_path",
            { pmid: id },
            (data) =>
              data.pokemon_id === id &&
              objects(data.forward) &&
              objects(data.backward)
                ? {
                    ...data,
                    pokemonId: id,
                    forward: data.forward,
                    backward: data.backward,
                  }
                : null,
          )
        : invalid<PokemonEvolution>("evolution", "evolution_path"),
    getMyPokemon: () =>
      wire.read("pokemon", "list", {}, (data) =>
        objects(data.pokemons) && data.pokemons.every(pet)
          ? data.pokemons
          : null,
      ),
    getPokemonDetail: (id: number) =>
      withId<PokemonPetDetail>(id, "detail", (data) =>
        pet(data) && data.id === id
          ? { ...data, stats: data.stats ?? null }
          : null,
      ),
    getLearnableSkills: (id: number) =>
      selected<PokemonSkills>(id, "learnable_skills", [
        "available_skills",
        "unlocked_skills",
      ]),
    getEquipment: (id: number) =>
      selected<PokemonEquipment>(id, "equipment", [
        "equipment_slots",
        "owned_items",
        "shop_items",
      ]),
    getProfile: () =>
      wire.read<PokemonProfile>("user", "profile", {}, (data, uid) =>
        data.uid === uid ? { ...data, uid } : null,
      ),
    getInventory: ({
      page = 1,
      type,
    }: { page?: number; type?: number } = {}) =>
      positive(page) && (type === undefined || integer(type, 0))
        ? wire.read<PokemonInventory>(
            "user",
            "inventory",
            { page, ...(type !== undefined && { type }) },
            (data) =>
              objects(data.items) && positive(data.page)
                ? { ...data, page: data.page, items: data.items }
                : null,
          )
        : invalid<PokemonInventory>("user", "inventory"),
    badgeStatus: () => wire.read("user", "badge_status", {}, badge),
    setFirst: (id: number) =>
      change("set_first", positive(id), { pokemon_id: id }, {}),
    movePokemon: (id: number, site: number) =>
      change(
        "move_pokemon",
        positive(id) && [1, 2, 3].includes(site),
        { pokemon_id: id, site },
        {},
      ),
    rename: (id: number, name: string) =>
      change(
        "rename",
        positive(id) && typeof name === "string" && Boolean(name.trim()),
        {},
        { id, name },
      ),
    release: (id: number) => change("release", positive(id), {}, { id }),
    learnSkill: (
      id: number,
      skillId: number,
      { slotIndex }: { slotIndex?: number } = {},
    ) =>
      change(
        "learn_skill",
        positive(id) &&
          positive(skillId) &&
          (slotIndex === undefined || slot(slotIndex)),
        {},
        {
          pokemon_id: id,
          skill_id: skillId,
          ...(slotIndex !== undefined && { slot_index: slotIndex }),
        },
      ),
    forgetSkill: (id: number, skillId: number) =>
      change(
        "forget_skill",
        positive(id) && positive(skillId),
        {},
        { pokemon_id: id, skill_id: skillId },
      ),
    equipItem: (
      id: number,
      myitemId: number,
      { slotIndex }: { slotIndex?: number } = {},
    ) =>
      change(
        "equip_item",
        positive(id) &&
          positive(myitemId) &&
          (slotIndex === undefined || slot(slotIndex)),
        {},
        {
          pokemon_id: id,
          myitem_id: myitemId,
          ...(slotIndex !== undefined && { slot_index: slotIndex }),
        },
      ),
    unequipItem: (id: number, slotIndex: number) =>
      change(
        "unequip_item",
        positive(id) && slot(slotIndex),
        {},
        { pokemon_id: id, slot_index: slotIndex },
      ),
    heal: (id: number) => healAction("heal", id),
    healAndFlee: (id: number) => healAction("heal_and_flee", id),
    refreshBadge: ({ hide }: { hide?: boolean } = {}) =>
      hide === undefined || typeof hide === "boolean"
        ? wire.write(
            "user",
            "refresh_badge",
            {},
            hide === undefined ? {} : { hide },
            badge,
          )
        : invalid<PokemonBadge>("user", "refresh_badge"),
    useItem: (itemId: number, { pokemonId }: { pokemonId?: number } = {}) =>
      positive(itemId) && (pokemonId === undefined || positive(pokemonId))
        ? wire.write(
            "user",
            "use_item",
            {},
            {
              item_id: itemId,
              ...(pokemonId !== undefined && { pokemon_id: pokemonId }),
            },
            done,
          )
        : invalid<void>("user", "use_item"),
  };
}
