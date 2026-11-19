import { integer } from "../notice-transport.js";
import { dataObject, failure } from "./session.js";
import type {
  PokemonBattleItemResult,
  PokemonBattleScene,
  PokemonBattleSkillSelection,
  PokemonData,
  PokemonGameRow,
  PokemonResult,
  PokemonShopItemPurchase,
  PokemonShopPage,
  PokemonShopPetPurchase,
  PokemonShopPetsPage,
} from "./types.js";
import type { PokemonDecode, createPokemonWire } from "./wire.js";

const positive = (value: unknown): value is number => integer(value, 1);
const identifiedRows = (value: unknown): value is readonly PokemonGameRow[] =>
  Array.isArray(value) && value.every((row) => positive(dataObject(row)?.id));
const battleId = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const invalid = <T>(operation: string): Promise<PokemonResult<T>> =>
  Promise.resolve(failure(operation, "invalid-input"));

const statusesWithoutId = new Set(["victory", "defeat", "fled", "captured"]);
function battleScene(
  data: PokemonData,
  expectedId?: string,
  expectedMap?: number,
): PokemonBattleScene | null {
  const id = data.battle_id;
  const status = data.status ?? (battleId(id) ? "active" : undefined);
  if (
    typeof status !== "string" ||
    !status.trim() ||
    (!battleId(id) && !statusesWithoutId.has(status)) ||
    (id != null && id !== "" && !battleId(id)) ||
    (expectedId !== undefined && battleId(id) && id !== expectedId) ||
    (expectedMap !== undefined &&
      data.map_id != null &&
      data.map_id !== expectedMap)
  )
    return null;
  return {
    ...data,
    status,
    ...(typeof id === "string" && { battle_id: id }),
    ...(id === null && { battle_id: null }),
  };
}

function purchaseBalance(data: PokemonData) {
  if (!integer(data.total_cost, 0) || !integer(data.remaining_money, 0))
    return null;
  return { total_cost: data.total_cost, remaining_money: data.remaining_money };
}

export function pokemonGame(wire: ReturnType<typeof createPokemonWire>) {
  const battleWrite = (
    action: string,
    body: PokemonData,
    valid: boolean,
    decode: PokemonDecode<PokemonBattleScene>,
  ) =>
    valid
      ? wire.write("battle", action, {}, body, decode)
      : invalid<PokemonBattleScene>(`battle/${action}`);

  return {
    getShop: ({ page = 1, type }: { page?: number; type?: number } = {}) =>
      positive(page) && (type === undefined || integer(type, 0))
        ? wire.read<PokemonShopPage>(
            "shop",
            "list",
            { page, ...(type !== undefined && { type }) },
            (data) =>
              positive(data.page) && identifiedRows(data.items)
                ? { ...data, page: data.page, items: data.items }
                : null,
          )
        : invalid<PokemonShopPage>("shop/list"),
    getShopPets: ({ page = 1 }: { page?: number } = {}) =>
      positive(page)
        ? wire.read<PokemonShopPetsPage>("shop", "pets", { page }, (data) =>
            positive(data.page) && identifiedRows(data.pets)
              ? { ...data, page: data.page, pets: data.pets }
              : null,
          )
        : invalid<PokemonShopPetsPage>("shop/pets"),
    buyShopItem: (itemId: number, quantity: number) =>
      positive(itemId) && positive(quantity)
        ? wire.write<PokemonShopItemPurchase>(
            "shop",
            "buy",
            {},
            { item_id: itemId, quantity },
            (data) => {
              const balance = purchaseBalance(data);
              return balance &&
                positive(data.items_purchased) &&
                data.items_purchased <= quantity &&
                (data.item_id == null || data.item_id === itemId)
                ? { ...data, ...balance, items_purchased: data.items_purchased }
                : null;
            },
          )
        : invalid<PokemonShopItemPurchase>("shop/buy"),
    buyShopPet: (typeId: number, quantity = 1) =>
      positive(typeId) && positive(quantity)
        ? wire.write<PokemonShopPetPurchase>(
            "shop",
            "buy_pet",
            {},
            { pokemon_type_id: typeId, quantity },
            (data) => {
              const balance = purchaseBalance(data);
              return balance &&
                data.pokemon_type_id === typeId &&
                positive(data.quantity) &&
                data.quantity <= quantity
                ? {
                    ...data,
                    ...balance,
                    pokemon_type_id: typeId,
                    quantity: data.quantity,
                  }
                : null;
            },
          )
        : invalid<PokemonShopPetPurchase>("shop/buy_pet"),
    getBattleMaps: () =>
      wire.read("battle", "maps", {}, (data) =>
        identifiedRows(data.maps) ? data.maps : null,
      ),
    async recoverBattle(): Promise<PokemonResult<PokemonBattleScene | null>> {
      const result = await wire.read("battle", "recover", {}, (data) =>
        battleScene(data),
      );
      return result.kind === "refused" && result.code === 404
        ? { kind: "success", data: null }
        : result;
    },
    getBattleItems: () =>
      wire.read("battle", "get_battle_items", {}, (data) =>
        identifiedRows(data.items) ? data.items : null,
      ),
    startBattle: (mapId: number, bossTypeId?: number) =>
      battleWrite(
        "start",
        {
          map_id: mapId,
          ...(bossTypeId !== undefined && { boss_pokemon_type_id: bossTypeId }),
        },
        positive(mapId) && (bossTypeId === undefined || positive(bossTypeId)),
        (data) => battleScene(data, undefined, mapId),
      ),
    takeBattleTurn: (id: string, skillId: number) =>
      battleWrite(
        "turn",
        { battle_id: id, skill_id: skillId },
        battleId(id) && positive(skillId),
        (data) => battleScene(data, id),
      ),
    fleeBattle: (id: string) =>
      battleWrite("flee", { battle_id: id }, battleId(id), (data) =>
        battleScene(data, id),
      ),
    capturePokemon: (ballId: number) =>
      battleWrite("capture", { ball_id: ballId }, positive(ballId), (data) =>
        battleScene(data),
      ),
    switchBattlePokemon: (id: string, pokemonId?: number) =>
      battleWrite(
        "switch_pokemon",
        {
          battle_id: id,
          ...(pokemonId !== undefined && { pokemon_id: pokemonId }),
        },
        battleId(id) && (pokemonId === undefined || positive(pokemonId)),
        (data) => battleScene(data, id),
      ),
    async useBattleItem(itemId: number): Promise<PokemonBattleItemResult> {
      if (!positive(itemId)) return failure("battle/use_item", "invalid-input");
      const result = await wire.write<PokemonBattleItemResult>(
        "battle",
        "use_item",
        {},
        { item_id: itemId },
        (data) => {
          if (data.requires_skill_selection === true) {
            const skills = data.available_skills;
            if (!identifiedRows(skills) || !skills.length) return null;
            const selection: PokemonBattleSkillSelection = {
              ...data,
              requires_skill_selection: true,
              available_skills: skills,
            };
            return { kind: "skill-selection", data: selection };
          }
          const scene = battleScene(data);
          return scene ? { kind: "success", data: scene } : null;
        },
      );
      return result.kind === "success" ? result.data : result;
    },
    useBattleItemOnSkill: (itemId: number, skillId: number) =>
      battleWrite(
        "use_item_on_skill",
        { item_id: itemId, skill_id: skillId },
        positive(itemId) && positive(skillId),
        (data) => battleScene(data),
      ),
  };
}
