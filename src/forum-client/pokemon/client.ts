import { pokemonRoster } from "./roster.js";
import type { PokemonClientOptions } from "./types.js";
import { createPokemonWire } from "./wire.js";

export function createPokemonClient(options: PokemonClientOptions) {
  const wire = createPokemonWire(options);
  return {
    bootstrap: () => wire.bootstrap(),
    bootstrapFromStatus: () => wire.bootstrap("status"),
    bootstrapFromGamePage: () => wire.bootstrap("game-page"),
    ...pokemonRoster(wire),
  };
}
export type PokemonClient = ReturnType<typeof createPokemonClient>;
